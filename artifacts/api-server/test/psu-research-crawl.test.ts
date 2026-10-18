import { test } from "node:test";
import assert from "node:assert/strict";
import { crawlProfile } from "../src/services/psu/research-crawl";
import type { WebsiteTransport } from "../src/services/psu/page-reader";
const response = (text: string, links: string[] = []) => ({
  access: "allowed" as const,
  text,
  title: "Page",
  decodedBytes: text.length,
  links,
});
test("research crawls up to 100 distinct pages, prioritises relevant paths, emits early draft and progress", async () => {
  let active = 0,
    peak = 0;
  const visited: string[] = [],
    progress: number[] = [],
    early: number[] = [];
  const transport: WebsiteTransport = {
    resolve: async () => ["93.184.216.34"],
    read: async ({ url }) => {
      active++;
      peak = Math.max(peak, active);
      visited.push(url);
      await Promise.resolve();
      active--;
      return response(
        "Company facts at " + url,
        url.endsWith("/")
          ? [
              "/pricing",
              "/compare",
              ...Array.from({ length: 120 }, (_, i) => `/article/${i}`),
            ]
          : [],
      );
    },
  };
  const meta: WebsiteTransport = {
    resolve: transport.resolve,
    read: async ({ url }) =>
      response(
        url.endsWith("robots.txt")
          ? "User-agent: *\nDisallow: /blocked"
          : "<urlset><url><loc>https://example.com/blocked</loc></url></urlset>",
      ),
  };
  const result = await crawlProfile(
    ["https://example.com/"],
    new AbortController().signal,
    transport,
    {
      progress: async (p) => {
        progress.push(p.pagesRead);
      },
      early: async (p) => {
        early.push(p.length);
      },
    },
    meta,
  );
  assert.equal(result.pages.length, 100);
  assert.equal(result.limited, true);
  assert.equal(peak, 2);
  assert.ok(visited.slice(0, 4).includes("https://example.com/pricing"));
  assert.ok(!visited.some((u) => u.endsWith("blocked")));
  assert.equal(early.length, 1);
  assert.ok(early[0]! < 100);
  assert.equal(progress.at(-1), 100);
});
test("unknown robots fail closed, nested sitemap discovery and canonical redirects respect robots", async () => {
  const visited: string[] = [];
  const transport: WebsiteTransport = {
    resolve: async () => ["93.184.216.34"],
    read: async ({ url }) => {
      visited.push(url);
      return response(url);
    },
  };
  const meta: WebsiteTransport = {
    resolve: transport.resolve,
    read: async ({ url }) => {
      if (url.startsWith("https://unknown.com")) throw Error("offline");
      return response(
        url.endsWith("robots.txt")
          ? "User-agent: *\nDisallow: /private"
          : url.endsWith("sitemap.xml")
            ? "<sitemapindex><loc>https://example.com/child.xml</loc></sitemapindex>"
            : "<urlset><loc>https://example.com/pricing</loc><loc>https://evil.com/x</loc><loc>https://example.com/private</loc></urlset>",
      );
    },
  };
  const result = await crawlProfile(
    ["https://example.com/", "https://unknown.com/"],
    new AbortController().signal,
    transport,
    {},
    meta,
  );
  assert.deepEqual(
    result.pages.map((p) => p.url),
    ["https://example.com/", "https://example.com/pricing"],
  );
  assert.deepEqual(result.unavailable, ["https://unknown.com/"]);
  assert.equal(visited.length, 2);
});
test("canonical www redirects read the destination robots policy and private redirects never reach transport", async () => {
  const reads: string[] = [];
  const metadata: WebsiteTransport = {
    resolve: async () => ["93.184.216.34"],
    read: async ({ url }) =>
      url === "https://example.com/robots.txt"
        ? { ...response(""), redirect: "https://www.example.com/robots.txt" }
        : response(
            url.endsWith("robots.txt")
              ? "User-agent: *\nDisallow: /private"
              : "",
          ),
  };
  const transport: WebsiteTransport = {
    resolve: metadata.resolve,
    read: async ({ url }) => {
      reads.push(url);
      return url === "https://example.com/"
        ? { ...response(""), redirect: "https://www.example.com/" }
        : response("Facts", ["/private"]);
    },
  };
  const result = await crawlProfile(
    ["https://example.com/"],
    new AbortController().signal,
    transport,
    {},
    metadata,
  );
  assert.equal(result.pages[0]?.url, "https://www.example.com/");
  assert.equal(reads.length, 2);
});
test("large-site excerpts preserve more core-page material than generic articles without exceeding the context bound",async()=>{
 const {sourceExcerpts}=await import("../src/services/psu/source-excerpts");
 const {pageTextDigest}=await import("../src/services/psu/page-reader");
 const pages=Array.from({length:100},(_,i)=>{const text=("Detailed company facts "+i+" ").repeat(1000);return {url:'https://example.com/'+(i===0?'pricing':`insights/${i}`),title:'Page',text,digest:pageTextDigest(text),retrievedAt:new Date().toISOString()};});
 const sources=sourceExcerpts(pages,96000);
 const size=(i:number)=>sources.filter(s=>s.pageDigest===pages[i]!.digest).reduce((n,s)=>n+s.quote.length,0);
 assert.ok(size(0)>size(1)*7);assert.ok(sources.reduce((n,s)=>n+s.quote.length,0)<=96000);
 assert.ok(sources.every(s=>pages.find(p=>p.digest===s.pageDigest)!.text.includes(s.quote)));
});
