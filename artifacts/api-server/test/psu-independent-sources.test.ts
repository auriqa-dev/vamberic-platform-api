import test from "node:test";
import assert from "node:assert/strict";
import { independentSources } from "../src/services/psu/independent-sources";
test("outside sources exclude own site, namesakes, assets and unsafe URLs", () => {
 assert.deepEqual(independentSources([
  "https://www.odyssiant.ai/about", "https://blog.odyssiant.ai/compare",
  "https://www.owler.com/company/odysightai/competitors?utm_source=openai",
  "https://reviews.example/odyssiant-logo.png", "http://127.0.0.1/odyssiant",
  "https://reviews.example/compare/odyssiant-vs-other?utm_source=openai",
 ], ["https://www.odyssiant.ai/"], "Odyssiant"), ["https://reviews.example/compare/odyssiant-vs-other"]);
});
