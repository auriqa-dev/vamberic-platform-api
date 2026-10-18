import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import {
  safeOfferFailure,
  OfferProviderError,
  type OfferDiagnostic,
} from "../src/services/offer-architecture/diagnostics";
import { createOfferGenerator } from "../src/services/offer-architecture/generate";

test("diagnostics retain categories but never exception text or validation values", () => {
  const parsed = z
    .object({ definition: z.string() })
    .safeParse({ definition: { secret: "private" } });
  assert.equal(parsed.success, false);
  if (!parsed.success)
    assert.deepEqual(safeOfferFailure(parsed.error), {
      code: "schema_validation",
      issues: [{ field: "definition", code: "invalid_type" }],
    });
  assert.deepEqual(safeOfferFailure(new OfferProviderError(429)), {
    code: "provider_http_error",
    httpStatus: 429,
  });
  assert.deepEqual(
    safeOfferFailure(new DOMException("private", "TimeoutError")),
    { code: "timeout_or_cancelled" },
  );
  assert.deepEqual(safeOfferFailure(new Error("private key")), {
    code: "unexpected_error",
  });
});

test("recoverable research HTTP failure is reported before offer request failure", async () => {
  const entries: OfferDiagnostic[] = [];
  const generator = createOfferGenerator(
    { apiKey: "fixture", project: "proj_fixture", model: "fixture" },
    async () => new Response("private provider body", { status: 429 }),
  );
  await assert.rejects(
    generator(
      {
        context: {},
        instructions: "",
        sourceUrls: [],
        targetIcpIds: [],
        targetBuyerProfileIds: [],
      },
      AbortSignal.timeout(1000),
      async (entry) => {
        entries.push(entry);
      },
    ),
    OfferProviderError,
  );
  assert.ok(
    entries.some(
      (e) =>
        e.stage === "research" &&
        e.outcome === "warning" &&
        e.httpStatus === 429,
    ),
  );
  assert.equal(entries.at(-1)?.stage, "provider");
  assert.doesNotMatch(JSON.stringify(entries), /private|fixture/);
});
