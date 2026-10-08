import { resolve4, resolve6 } from "node:dns/promises";
import { request, type RequestOptions } from "node:https";
import { checkServerIdentity } from "node:tls";
import { parse, type DefaultTreeAdapterMap } from "parse5";
import { abortable } from "./abort";
import {
  requirePublicAddress,
  WEBSITE_LIMITS,
  type WebsiteTransport,
} from "./page-reader";
import { publicPageUrl } from "@workspace/agent-runtime-protocol";

type Node = DefaultTreeAdapterMap["node"];
const excluded = new Set([
  "script",
  "style",
  "noscript",
  "template",
  "iframe",
  "object",
  "embed",
  "svg",
  "canvas",
  "nav",
  "footer",
  "form",
]);
/** Inert HTML parsing: no DOM execution, fetching, link expansion or attributes
 * passed to the model. Oversized evidence fails rather than silently truncating. */
export function extractPublicPage(body: string, contentType: string) {
  let text: string;
  let title = "";
  if (contentType === "text/plain") text = body;
  else if (
    contentType === "text/html" ||
    contentType === "application/xhtml+xml"
  ) {
    const root = parse(body);
    const parts: string[] = [];
    const stack: { node: Node; inTitle: boolean }[] = [
      { node: root, inTitle: false },
    ];
    while (stack.length) {
      const { node, inTitle } = stack.pop()!;
      if (
        "tagName" in node &&
        (excluded.has(node.tagName) ||
          node.attrs.some(
            (a) =>
              a.name === "hidden" ||
              (a.name === "aria-hidden" && a.value === "true"),
          ))
      )
        continue;
      if ("value" in node) {
        if (inTitle) title += node.value;
        else parts.push(node.value);
      }
      if ("childNodes" in node) {
        for (let n = node.childNodes.length - 1; n >= 0; n--)
          stack.push({
            node: node.childNodes[n]!,
            inTitle: inTitle || ("tagName" in node && node.tagName === "title"),
          });
      }
    }
    text = parts.join(" ");
  } else throw new Error("Unsupported public page type");
  text = text.replace(/\s+/gu, " ").trim();
  title = title.replace(/\s+/gu, " ").trim().slice(0, 200);
  if (!text || Buffer.byteLength(text) > WEBSITE_LIMITS.textBytes)
    throw new Error("Public page text unavailable or too large");
  return { text, title };
}
export function pinnedPageOptions(
  r: Parameters<WebsiteTransport["read"]>[0],
): RequestOptions {
  const url = new URL(publicPageUrl(r.url));
  if (url.hostname !== r.servername) throw new Error("TLS hostname mismatch");
  requirePublicAddress(r.address);
  return {
    protocol: "https:",
    hostname: r.address,
    port: 443,
    method: "GET",
    path: url.pathname + url.search,
    servername: r.servername,
    rejectUnauthorized: true,
    checkServerIdentity: (_host, cert) =>
      checkServerIdentity(r.servername, cert),
    agent: false,
    maxHeaderSize: 16384,
    headers: {
      Host: url.host,
      Accept: "text/html, text/plain;q=0.9",
      "Accept-Encoding": "identity",
      "User-Agent": "HVM-PSU/1.0",
    },
    signal: AbortSignal.any([
      r.signal,
      AbortSignal.timeout(Math.min(r.timeoutMs, WEBSITE_LIMITS.pageMs)),
    ]),
  };
}
/** No proxy/env credential discovery, connection pooling, retries or redirects.
 * DNS is validated by the reader; this transport also validates its pinned IP. */
export function publicPageHttp(
  http: typeof request = request,
): WebsiteTransport {
  return {
    async resolve(hostname, signal) {
      const results = await abortable(
        () => Promise.allSettled([resolve4(hostname), resolve6(hostname)]),
        signal,
      );
      const addresses: string[] = [];
      for (const r of results) {
        if (r.status === "fulfilled") addresses.push(...r.value);
        else if (
          !["ENODATA", "ENOTFOUND"].includes(
            (r.reason as NodeJS.ErrnoException)?.code ?? "",
          )
        )
          throw new Error("DNS unavailable");
      }
      return addresses;
    },
    async read(r) {
      const options = pinnedPageOptions(r);
      return new Promise((resolve, reject) => {
        const req = http(options, async (res) => {
          try {
            if ([301, 302, 303, 307, 308].includes(res.statusCode ?? 0)) {
              const redirect = res.headers.location;
              if (!redirect || redirect.length > 2048) throw new Error();
              resolve({
                access: "allowed",
                redirect,
                decodedBytes: 0,
                text: "",
                title: "",
              });
              return;
            }
            if (
              res.statusCode !== 200 ||
              (res.headers["content-encoding"] &&
                res.headers["content-encoding"] !== "identity") ||
              res.headers["content-disposition"]
                ?.toLowerCase()
                .startsWith("attachment")
            )
              throw new Error();
            const type = res.headers["content-type"] ?? "";
            const charset =
              /charset\s*=\s*(?:"([^"]*)"|'([^']*)'|([^;\s]*))/i.exec(type);
            if (
              charset &&
              !["utf-8", "us-ascii"].includes(
                (charset[1] ?? charset[2] ?? charset[3] ?? "").toLowerCase(),
              )
            )
              throw new Error();
            const limit = Math.min(
              r.maximumDecodedBytes,
              WEBSITE_LIMITS.decodedBytes,
            );
            const parts: Buffer[] = [];
            let bytes = 0;
            for await (const part of res) {
              r.signal.throwIfAborted();
              const chunk = Buffer.from(part);
              bytes += chunk.length;
              if (bytes > limit) throw new Error();
              parts.push(chunk);
            }
            const body = new TextDecoder("utf-8", { fatal: true }).decode(
              Buffer.concat(parts),
            );
            resolve({
              access: "allowed",
              decodedBytes: bytes,
              ...extractPublicPage(
                body,
                type.split(";")[0]!.trim().toLowerCase(),
              ),
            });
          } catch {
            reject(new Error("Public page unavailable or unsupported"));
          } finally {
            res.destroy();
          }
        });
        req.on("error", () =>
          reject(new Error("Public page transport unavailable")),
        );
        req.end();
      });
    },
  };
}
