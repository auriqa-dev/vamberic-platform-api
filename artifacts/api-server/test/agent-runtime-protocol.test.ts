import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  KnowledgeGapSchema,
  DispatchSchema,
  ClaimedWorkSchema,
  OutcomeSchema,
  ImplementationManifestSchema,
  UsageObservationSchema,
  EvidenceObservationSchema,
  FindingSchema,
  ProposalSchema,
  digestWithout,
  canonicalJson,
} from "@workspace/agent-runtime-protocol";
const fixture = (name: string) =>
  JSON.parse(
    readFileSync(
      new URL(
        `../../../lib/agent-runtime-protocol/fixtures/${name}.json`,
        import.meta.url,
      ),
      "utf8",
    ),
  );
for (const [name, schema] of [
  ["dispatch", DispatchSchema],
  ["claimedWork", ClaimedWorkSchema],
  ["manifest", ImplementationManifestSchema],
  ["usage", UsageObservationSchema],
  ["evidence", EvidenceObservationSchema],
  ["finding", FindingSchema],
  ["proposal", ProposalSchema],
  ...[
    "success",
    "failure",
    "cancelled",
    "needsInput",
    "yield",
    "gapNonBlocking",
    "gapBlocking",
    "gapHuman",
    "gapCapability",
    "gapResearch",
    "gapResearchResolved",
    "gapUnresolved",
  ].map((name) => [name, OutcomeSchema] as const),
] as const)
  test(`Platform consumes actual Runtime golden ${name}`, () =>
    assert.ok(schema.safeParse(fixture(name)).success));
test("unsupported Runtime major and changed payload digest fail closed", () => {
  assert.equal(
    OutcomeSchema.safeParse(fixture("unsupportedMajor")).success,
    false,
  );
  const value = fixture("success");
  assert.equal(value.payloadDigest, digestWithout(value, "payloadDigest"));
  value.traceId = "changed";
  assert.equal(OutcomeSchema.safeParse(value).success, false);
});
test("protocol canonical digest is key-order independent and rejects lossy values", () => {
  assert.equal(canonicalJson({ b: 2, a: 1 }), canonicalJson({ a: 1, b: 2 }));
  for (const v of [NaN, Infinity, -0, undefined, new Date(), { a: undefined }])
    assert.throws(() => canonicalJson(v));
});

for (const name of [
  "invalidCompleteBlocking",
  "invalidMissingCapability",
  "invalidMalformedCapability",
  "invalidEvidenceReference",
  "invalidFindingReference",
  "invalidLineageReference",
]) {
  test(`Runtime 1.1 semantic rejection: ${name}`, () => {
    const value = fixture(name);
    assert.equal(value.payloadDigest, digestWithout(value, "payloadDigest"));
    assert.equal(OutcomeSchema.safeParse(value).success, false);
  });
}
test("exact protocol/result profile rejects historical 1.0 and Result 1 without lossy defaults", () => {
  for (const change of [
    { protocolVersion: "1.0" },
    { resultSchemaVersion: 1 },
  ]) {
    const value = { ...fixture("success"), ...change };
    value.payloadDigest = digestWithout(value, "payloadDigest");
    assert.equal(OutcomeSchema.safeParse(value).success, false);
  }
});
test("Knowledge Gaps preserve bounded inert data and reject executable fields, duplicate support and excess bytes", () => {
  const gap = fixture("gapCapability").outcome.content.knowledgeGaps[0];
  assert.deepEqual(KnowledgeGapSchema.parse(gap), gap);
  for (const change of [
    { route: "/execute" },
    { question: "" },
    { whyRequired: "" },
    { checked: [] },
    { checked: Array(11).fill("checked") },
    { evidenceIds: ["same", "same"] },
    { context: { token: "not allowed" } },
    { resolution: { kind: "research", requiredCapability: "research" } },
    { question: "界".repeat(2000), whyRequired: "界".repeat(2000) },
  ])
    assert.equal(
      KnowledgeGapSchema.safeParse({ ...gap, ...change }).success,
      false,
    );
  const value = fixture("gapCapability");
  value.outcome.content.knowledgeGaps.push(gap);
  value.payloadDigest = digestWithout(value, "payloadDigest");
  assert.equal(OutcomeSchema.safeParse(value).success, false);
});
