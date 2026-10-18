import assert from "node:assert/strict";
import { test } from "node:test";
import { releaseDatabaseTarget } from "../src/db/setup";
import { OfferQualificationShape } from "../src/domain/offers";
import { IcpContentSchema } from "../src/domain/hive-definitions";
import { z } from "zod";
test("v29 adds only optional qualification and ICP fields without rewriting historical targets", () => {
  const before = releaseDatabaseTarget(28),
    snapshot = JSON.stringify(before);
  const after = releaseDatabaseTarget(29);
  assert.equal(JSON.stringify(releaseDatabaseTarget(28)), snapshot);
  assert.deepEqual(
    Object.keys(after.validators)
      .filter(
        (k) =>
          JSON.stringify(after.validators[k]) !==
          JSON.stringify(before.validators[k]),
      )
      .sort(),
    [
      "hive_definition_revisions",
      "ideal_customer_profiles",
      "offer_revisions",
      "offers",
    ],
  );
  assert.deepEqual(after.collections, before.collections);
});
test("qualification permits useful unknowns and validates booking destinations", () => {
  const schema = z.object(OfferQualificationShape).strict();
  assert.ok(schema.safeParse({}).success);
  assert.ok(
    schema.safeParse({
      conversionOutcome: "Request a quote",
      qualificationCriteria: ["A serviceable need"],
      acceptableUnknowns: ["Budget and timing may be unknown"],
      salesReadiness: "The customer requests a consultation",
    }).success,
  );
  assert.equal(
    schema.safeParse({ bookingUrl: "javascript:alert(1)" }).success,
    false,
  );
  assert.ok(
    schema.safeParse({ bookingUrl: "https://booking.example/demo" }).success,
  );
  const profile = {
    name: "Manufacturers",
    description: "Organisations with relevant needs",
    profileType: "b2b",
    essentialFit: ["Relevant operating need"],
    desirableFit: ["An identified sponsor"],
    unknownHandling: ["Missing budget is not failed fit"],
    refreshCriteria: ["Recheck employment after a role change"],
  };
  assert.ok(IcpContentSchema.safeParse(profile).success);
});

test("v29 preserves the exact previously approved ICP recovery", async () => {
  const { withApprovedIcpRecovery } =
    await import("../src/db/nba-preparation-v29");
  const { patchIcpValidator } =
    await import("./fixtures/icp-recovery-20261014.mjs");
  const v28 = releaseDatabaseTarget(28),
    repaired = withApprovedIcpRecovery(v28.validators);
  for (const name of ["ideal_customer_profiles", "hive_definition_revisions"]) {
    assert.deepEqual(
      repaired[name],
      patchIcpValidator(name, v28.validators[name]).validator,
    );
    assert.deepEqual(withApprovedIcpRecovery(repaired)[name], repaired[name]);
    for (const key of [
      "researchCriteria",
      "adoptionReadiness",
      "targetingCoverage",
    ])
      assert.ok(
        JSON.stringify(releaseDatabaseTarget(29).validators[name]).includes(
          '"' + key + '"',
        ),
      );
  }
});
