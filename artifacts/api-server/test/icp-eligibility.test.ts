import test from "node:test";
import assert from "node:assert/strict";
import {
  assessFit,
  assessConsumerFit,
  permittedOffers,
  EligibilityPolicySchema,
} from "../src/services/icp/eligibility";
test("fit distinguishes matching, excluded and missing data without inventing facts", () => {
  const rules = [
    {
      field: "industry" as const,
      effect: "include" as const,
      values: ["Manufacturing"],
    },
    {
      field: "country" as const,
      effect: "exclude" as const,
      values: ["France"],
    },
  ];
  assert.equal(
    assessFit({ industry: "manufacturing", country: "United Kingdom" }, rules)
      .fit,
    "matches",
  );
  assert.equal(
    assessFit({ industry: "Manufacturing" }, rules).fit,
    "needs_review",
  );
  assert.equal(
    assessFit({ industry: "Manufacturing", country: "France" }, rules).fit,
    "not_fit",
  );
  assert.equal(
    EligibilityPolicySchema.safeParse({
      name: "Unspecified",
      exclusivity: "multiple_offers",
      segments: [],
      offerPriority: [],
    }).success,
    false,
  );
});

test("organisation exclusivity retains only the Queen's highest-priority matching offer", () => {
  assert.deepEqual(
    permittedOffers(["enterprise", "selfserve"], "one_offer_per_organisation"),
    ["enterprise"],
  );
  assert.deepEqual(
    permittedOffers(["enterprise", "selfserve"], "multiple_offers"),
    ["enterprise", "selfserve"],
  );
});

test("size matching reads the actual Hive size band and never invents a missing band", () => {
  const rules = [
    { field: "size" as const, effect: "include" as const, values: ["51–200"] },
  ];
  assert.equal(
    assessFit({ size: { band: "51–200", employees: 60 } }, rules).fit,
    "matches",
  );
  assert.equal(
    assessFit({ size: { employees: 60 } }, rules).fit,
    "needs_review",
  );
});
test("contact rules use recorded role data; empty criteria and missing roles remain reviewable", () => {
  const rules = [
    {
      field: "department" as const,
      effect: "include" as const,
      values: ["Marketing"],
    },
    {
      field: "seniority" as const,
      effect: "exclude" as const,
      values: ["Intern"],
    },
  ];
  assert.equal(
    assessFit({ department: "marketing", seniority: "Director" }, rules).fit,
    "matches",
  );
  assert.equal(
    assessFit({ department: "marketing", seniority: "Intern" }, rules).fit,
    "not_fit",
  );
  assert.equal(
    assessFit({ department: "marketing" }, rules).fit,
    "needs_review",
  );
  assert.equal(assessFit({ jobTitle: "CEO" }, []).fit, "needs_review");
});

test("consumer fit only assesses person fields and never borrows business attributes", () => {
  const rules = [
    {
      field: "preferredLanguage" as const,
      effect: "include" as const,
      values: ["en-GB"],
    },
  ];
  assert.equal(
    assessConsumerFit({ preferredLanguage: "en-gb" }, rules).fit,
    "matches",
  );
  assert.equal(
    assessConsumerFit({ preferredLanguage: "fr" }, rules).fit,
    "not_fit",
  );
  assert.equal(
    assessConsumerFit({ timezone: "Europe/London" }, rules).fit,
    "needs_review",
  );
  assert.equal(
    assessConsumerFit({ country: "GB" }, [
      { field: "country", effect: "include", values: ["GB"] },
    ]).fit,
    "needs_review",
  );
  assert.equal(
    assessConsumerFit({ preferredLanguage: "en-GB" }, []).fit,
    "needs_review",
  );
  assert.deepEqual(
    permittedOffers(["first", "second"], "one_offer_per_customer"),
    ["first"],
  );
});
