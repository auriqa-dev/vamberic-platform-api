import test from "node:test";
import assert from "node:assert/strict";
import { releaseDatabaseTarget } from "../src/db/setup";
import { extendOfferSequenceValidators } from "../src/db/offer-sequence-v27";

test("v27 only relaxes offer ICP prerequisites and does not mutate historical release validators", () => {
  const previous = releaseDatabaseTarget(26);
  const before = JSON.stringify(previous);
  const next = releaseDatabaseTarget(27);
  assert.equal(JSON.stringify(previous), before);
  assert.deepEqual(
    Object.keys(next.validators)
      .filter(
        (k) =>
          JSON.stringify(next.validators[k]) !==
          JSON.stringify(previous.validators[k]),
      )
      .sort(),
    [
      "hive_definition_revisions",
      "ideal_customer_profiles",
      "offer_designs",
      "offer_revisions",
      "offers",
    ],
  );
  assert.deepEqual(next.collections, previous.collections);
  assert.match(
    JSON.stringify(next.validators.offer_designs),
    /competitiveAnalysis/,
  );
  assert.doesNotMatch(
    JSON.stringify(next.validators.offer_designs),
    /"\$gt":\[\{"\$size".*work.targetIcpIds/,
  );
  assert.throws(
    () => extendOfferSequenceValidators({}),
    /Unexpected offer validator/,
  );
});
