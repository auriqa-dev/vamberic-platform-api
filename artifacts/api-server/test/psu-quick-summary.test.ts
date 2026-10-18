import assert from "node:assert/strict";
import { test } from "node:test";
import { createPsuGenerator } from "../src/services/psu/generate";
import { pageTextDigest } from "../src/services/psu/page-reader";
import {
  QuickSummaryRequestSchema,
  SUMMARY_MODEL,
  SUMMARY_OUTPUT_TOKENS,
  summarySources,
  validateQuickSummary,
} from "../src/services/psu/quick-summary";
const text =
  "Acme provides energy analysis. Acme Energy identifies energy savings for manufacturing customers.";
const page = {
  url: "https://example.com/",
  title: "Acme",
  text,
  digest: pageTextDigest(text),
  retrievedAt: new Date().toISOString(),
};
const payload = () => ({
  company: [
    { field: "name", value: "Acme", sources: [0] },
    { field: "description", value: "Energy analysis company", sources: [0] },
  ],
  product: [
    { field: "name", value: "Acme Energy", sources: [0] },
    { field: "description", value: "Energy savings analysis", sources: [0] },
  ],
  companyCompetitorSuggestions: ["Candidate company"],
  productCompetitorSuggestions: ["Candidate product"],
  unknowns: [],
});
test("quick company summary returns separate unapproved company and main product drafts", () => {
  const result = validateQuickSummary(payload(), [page], true);
  assert.equal(result.companyDraft!.approval, "not_approved");
  assert.equal(result.draft!.approval, "not_approved");
  assert.equal(result.companyDraft!.fields[0]!.support[0]!.quote, text);
  assert.deepEqual(result.competitorSuggestions, ["Candidate company"]);
  assert.deepEqual(result.productCompetitorSuggestions, ["Candidate product"]);
});
test("bad references and duplicates omit affected fields; empty results still fail", () => {
  const data = payload();
  data.company[1]!.sources = [999];
  const result = validateQuickSummary(data, [page], true);
  assert.equal(result.companyDraft!.fields.length, 1);
  assert.match(result.companyDraft!.unknowns.join(" "), /source reference/);
  assert.equal(result.draft!.fields.length, 2);
  data.company.push(data.company[0]!);
  assert.throws(() => validateQuickSummary(data, [page], true), /No usable summary fields/);
  data.company[1]!.sources = [0];
  const partial = validateQuickSummary(data, [page], true);
  assert.deepEqual(partial.companyDraft!.fields.map(f => f.binding.field), ["description"]);
  assert.match(partial.companyDraft!.unknowns.join(" "), /more than one value/);
  assert.equal(partial.draft!.fields.length, 2);
});
test("quick path sends bounded excerpts to the light model without reasoning or copied evidence", async () => {
  const longText = text.repeat(1500);
  const generate = createPsuGenerator(
    { apiKey: "offline", project: "proj_test", model: "deep-model" },
    async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      assert.equal(body.model, SUMMARY_MODEL);
      assert.equal(body.max_output_tokens, SUMMARY_OUTPUT_TOKENS);
      assert.deepEqual(body.reasoning, { effort: "none" });
      const content = JSON.parse(body.input[1].content);
      assert.equal(
        content.sources.reduce(
          (n: number, s: { text: string }) => n + s.text.length,
          0,
        ),
        24000,
      );
      assert.equal(content.pages[0].text, undefined);
      return new Response(
        JSON.stringify({
          model: SUMMARY_MODEL,
          status: "completed",
          usage: { input_tokens: 100, output_tokens: 50 },
          output: [
            {
              type: "message",
              role: "assistant",
              status: "completed",
              content: [
                { type: "output_text", text: JSON.stringify(payload()) },
              ],
            },
          ],
        }),
      );
    },
    {
      resolve: async () => ["93.184.216.34"],
      read: async () => ({
        access: "allowed",
        decodedBytes: Buffer.byteLength(longText),
        text: longText,
        title: "Acme",
      }),
    },
  );
  const result = await generate(
    {
      kind: "company",
      depth: "summary",
      websiteUrls: [page.url],
      workingLabel: "Acme",
      orientation: "",
      context: {},
    },
    new AbortController().signal,
  );
  assert.equal(result.companyDraft!.fields.length, 2);
  assert.equal(result.draft!.fields.length, 2);
  assert.equal(result.usage.model, SUMMARY_MODEL);
  assert.match(
    result.companyDraft!.unknowns.join(" "),
    /selected website excerpts/,
  );
  assert.equal(summarySources([page])[0]!.quote, text);
});

test("malformed optional summary fields preserve useful company and product details", () => {
  const data = payload();
  (data.company as unknown[]).push({
    field: "regionsServed",
    value: 42,
    sources: [0],
  });
  const result = validateQuickSummary(data, [page], true);
  assert.equal(result.companyDraft!.fields.length, 2);
  assert.match(
    result.companyDraft!.unknowns.join(" "),
    /regionsServed.*review/,
  );
  assert.equal(result.draft!.fields.length, 2);
});
test("source budget includes late-page detail without invented or oversized excerpts", () => {
  const long =
    "Introduction. ".repeat(3000) + "Important delivery terms at the end.";
  const sources = summarySources([
    { ...page, text: long, digest: pageTextDigest(long) },
  ]);
  assert.ok(sources.some((s) => s.quote.includes("Important delivery terms")));
  assert.ok(sources.every((s) => long.includes(s.quote)));
  assert.equal(
    sources.reduce((n, s) => n + s.quote.length, 0),
    24000,
  );
});

test("an unusable optional product does not discard a useful company summary", () => {
  const data = payload();
  data.product.forEach((field) => {
    field.sources = [999];
  });
  const result = validateQuickSummary(data, [page], true);
  assert.equal(result.companyDraft!.fields.length, 2);
  assert.equal(result.draft, undefined);
  assert.equal(result.productUnavailable, true);
});

test("named summary slots require each field to be considered and preserve honest gaps", () => {
  const toSlots = (
    items: { field: string; value: string; sources: number[] }[],
  ) => Object.fromEntries(items.map(({ field, ...value }) => [field, value]));
  const old = payload();
  const schema = QuickSummaryRequestSchema.shape.company.unwrap();
  const company = Object.fromEntries(
    Object.keys(schema.shape).map((key) => [key, null]),
  );
  Object.assign(company, toSlots(old.company));
  const productSchema = QuickSummaryRequestSchema.shape.product.unwrap();
  const product = Object.fromEntries(
    Object.keys(productSchema.shape).map((key) => [key, null]),
  );
  Object.assign(product, toSlots(old.product));
  const raw = { ...old, company, product };
  assert.equal(QuickSummaryRequestSchema.safeParse(raw).success, true);
  const result = validateQuickSummary(raw, [page], true);
  assert.equal(
    result.companyDraft!.fields.find((f) => f.binding.field === "description")!
      .binding.value,
    "Energy analysis company",
  );
  assert.equal(result.draft!.fields.length, 2);
  const missing = { ...company };
  delete missing.description;
  assert.equal(
    QuickSummaryRequestSchema.safeParse({ ...raw, company: missing }).success,
    false,
  );
});
test("progressive generation uses two bounded synthesis stages with retained usage and optional external discovery",async()=>{
 let summaries=0, searches=0; const stages:string[]=[], previews:unknown[]=[];
 const generate=createPsuGenerator({apiKey:"offline",project:"proj_test",model:"unused"},async (_url,init)=>{
   const body=JSON.parse(String(init?.body));
   if(body.tools.length){searches++;return new Response(JSON.stringify({status:"completed",model:"gpt-4.1-mini",usage:{input_tokens:10,output_tokens:5},output:[{type:"web_search_call",action:{sources:[{url:"https://independent.org/acme/comparison"}]}}]}));}
   summaries++;
   return new Response(JSON.stringify({model:SUMMARY_MODEL,status:"completed",usage:{input_tokens:100,output_tokens:50},output:[{type:"message",role:"assistant",status:"completed",content:[{type:"output_text",text:JSON.stringify(payload())}]}]}));
 },{resolve:async()=>["93.184.216.34"],read:async({url})=>({access:"allowed",decodedBytes:100,text:text+url,title:"Acme",links:url.endsWith("/")?Array.from({length:9},(_,i)=>`/product/${i}`):[]})},
 {resolve:async()=>["93.184.216.34"],read:async()=>({access:"allowed",decodedBytes:0,text:"",title:""})});
 const result=await generate({kind:"company",depth:"summary",workingLabel:"Acme",orientation:"",websiteUrls:[page.url],context:{},includeWebResearch:true},new AbortController().signal,async(p,preview)=>{stages.push(p.phase);if(preview)previews.push(preview);});
 assert.equal(summaries,2);assert.equal(searches,1);assert.equal(previews.length,1);assert.ok(stages.includes("refining"));
 assert.equal(result.preliminaryUsage?.inputTokens,100);assert.equal(result.researchUsage?.searchCalls,1);
 assert.deepEqual(result.researchSources,["https://independent.org/acme/comparison"]);assert.equal(result.companyDraft?.approval,"not_approved");
});
test("unknown region placeholders do not become market facts", () => {
  const base = payload();
  const result = validateQuickSummary({...base,
    company: [...base.company, {field:"regionsServed",value:["Not explicitly stated"],sources:[0]}],
    product: [...base.product, {field:"regionsServed",value:["Unknown", "United Kingdom"],sources:[0]}],
  }, [page], true);
  assert.equal(result.companyDraft!.fields.some(f => f.binding.field === "regionsServed"), false);
  assert.deepEqual(result.draft!.fields.find(f => f.binding.field === "regionsServed")!.binding.value, ["United Kingdom"]);
  assert.match(result.companyDraft!.unknowns.join(" "), /Regions served: not established/);
});
