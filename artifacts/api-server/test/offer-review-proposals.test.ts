import { test } from "node:test";
import assert from "node:assert/strict";
import { generationWork } from "../src/services/offer-architecture/application";
import {
  GeneratedOfferSchema,
  briefKeys,
} from "../src/services/offer-architecture/generate";
import { listOfferMethodologies } from "../src/domain/offer-methodologies";
test("generation preserves question proposals and evidence gaps without human sign-off", () => {
  const draft = GeneratedOfferSchema.parse({
    definition: {
      name: "Enterprise",
      targetIcpIds: [],
      targetBuyerProfileIds: [],
      headlineProposition: "Explore options",
      valueProposition: "Understand needs",
      commercialTerms: {
        options: [{ name: "Confirm terms", pricingModel: "custom_quote" }],
      },
      primaryCallToAction: "Discuss",
    },
    stages: listOfferMethodologies()[0]!.stages.map((s) => ({
      stageKey: s.key,
      summary: "Proposed strategy",
      questions: [],
      proposals: [
        {
          question: "Include implementation?",
          answer:
            "Consider separately scoped support, subject to confirmation.",
          basis: "Capability not yet confirmed.",
          kind: "recommendation",
          decision: "human_input",
          gap: "Approval blocker: confirm delivery capability before promising implementation.",
        },
      ],
    })),
    researchBrief: Object.fromEntries(briefKeys.map((k) => [k, []])),
    competitors: [],
  });
  const work = generationWork(
    {
      draft,
      sources: [],
      usage: { model: "test", inputTokens: 0, outputTokens: 0 },
      limitations: ["Research incomplete"],
    },
    {
      offeringId: "offering_00000000000000000000000001",
      targetIcpIds: [],
      targetBuyerProfileIds: [],
    },
  );
  assert.equal(work.stages.length, 14);
  assert.deepEqual(work.completedStageKeys, []);
  for (const stage of work.stages) {
    assert.deepEqual(stage.userInputs, []);
    assert.equal(stage.status, "in_progress");
    assert.ok(stage.unknowns.includes("Include implementation?"));
    assert.ok(stage.groups[0]!.items[5]!.includes("Approval blocker"));
  }
  assert.ok(work.stages[0]!.notes.includes("Research incomplete"));
  assert.ok(!work.stages[0]!.unknowns.includes("Research incomplete"));
});

import {
  recordReviewChanges,
  readReviewHistory,
} from "../src/services/offer-architecture/review-history";
import { EnquiryMemoryDb } from "./helpers/enquiry-db";
import { generatePlatformId } from "../src/domain";
test("review history records before and after answers in tenant-scoped, bounded event parts", async () => {
  const db = new EnquiryMemoryDb(),
    w = generatePlatformId("workspace"),
    offerId = generatePlatformId("offer"),
    designId = generatePlatformId("offerdesign");
  const stage = {
    stageKey: "market_context",
    status: "in_progress",
    userInputs: [{ question: "Priority?", answer: "Earlier answer" }],
    groups: [],
    evidence: [],
    notes: [],
  };
  const after = {
    ...stage,
    userInputs: [{ question: "Priority?", answer: "Updated answer" }],
  };
  await recordReviewChanges(
    await db.mongo.database(),
    undefined,
    w,
    offerId,
    designId,
    { type: "human", id: "tester", issuer: "https://issuer.example" },
    { stages: [stage] },
    { stages: [after] },
  );
  const history = await readReviewHistory(
    await db.mongo.database(),
    w,
    offerId,
  );
  assert.equal(history.length, 1);
  assert.equal(history[0]!.before.userInputs[0].answer, "Earlier answer");
  assert.equal(history[0]!.after.userInputs[0].answer, "Updated answer");
  assert.deepEqual(
    await readReviewHistory(
      await db.mongo.database(),
      generatePlatformId("workspace"),
      offerId,
    ),
    [],
  );
  await recordReviewChanges(
    await db.mongo.database(),
    undefined,
    w,
    offerId,
    designId,
    { type: "human", id: "tester", issuer: "https://issuer.example" },
    { stages: [after] },
    { stages: [after] },
  );
  assert.equal(
    db.rows("events").filter((e) => e.eventType === "offer_review_changed")
      .length,
    1,
  );
});
