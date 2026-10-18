import assert from "node:assert/strict";
import { test } from "node:test";
import { digest } from "@workspace/agent-runtime-protocol";
import { generatePlatformId } from "../src/domain/ids";
import {
  ClientOnboardingIntakeSchema,
  ClientOnboardingBindingSchema,
  PreclientExemptionSchema,
  requireCurrentPreclientExemption,
  preclientWorkspaceExemption,
} from "../src/domain/client-onboarding";
import {
  WorkspaceBillingExemptionSchema,
  effectiveWorkspaceBilling,
} from "../src/domain/workspace-billing";
const binding = {
  onboardingId: "clientonboarding_01aaaaaaaaaaaaaaaaaaaaaaaa",
  partnerId: generatePlatformId("partner"),
  intakeRevision: 1,
  intakeDigest: digest({ name: "Fictional" }),
  quoteRevision: 1,
  quoteDigest: digest({ quote: "fixture only, no tariff" }),
};
const now = new Date("2026-10-05T12:00:00Z");
const approval = {
  version: 1,
  revision: 1,
  status: "active",
  binding,
  treatment: "internal",
  scope: "hvm_platform_and_agent_services",
  reason: "Fictional test",
  approvedBy: { type: "human", issuer: "https://auth.invalid", id: "empress" },
  approvedAt: new Date("2026-10-05T11:00:00Z"),
  validUntil: new Date("2026-10-05T13:00:00Z"),
};
test("pre-client binding transfers exact exemption without payment or execution authority", () => {
  assert.deepEqual(
    requireCurrentPreclientExemption(approval, binding, now),
    approval,
  );
  const workspace = WorkspaceBillingExemptionSchema.parse(
    preclientWorkspaceExemption(approval, binding, now),
  );
  assert.deepEqual(workspace.approvedBy, approval.approvedBy);
  assert.equal(
    workspace.approvedAt.toISOString(),
    approval.approvedAt.toISOString(),
  );
  const billed = effectiveWorkspaceBilling(workspace, 1234);
  assert.equal(billed.grossAmountMinor, 1234);
  assert.equal(billed.billedAmountMinor, 0);
  assert.equal(billed.executionAuthority, false);
  assert.equal(billed.providerCostsRetained, true);
});
for (const [key, value] of Object.entries({
  onboardingId: "clientonboarding_02aaaaaaaaaaaaaaaaaaaaaaaa",
  partnerId: generatePlatformId("partner"),
  intakeRevision: 2,
  intakeDigest: digest("changed intake"),
  quoteRevision: 2,
  quoteDigest: digest("changed quote"),
}))
  test(`changed ${key} cannot reuse exemption`, () => {
    assert.throws(() =>
      requireCurrentPreclientExemption(
        approval,
        { ...binding, [key]: value },
        now,
      ),
    );
  });
test("revoked and future approvals fail closed; active exemptions have no expiry", () => {
  assert.throws(() =>
    requireCurrentPreclientExemption(
      { ...approval, status: "revoked" },
      binding,
      now,
    ),
  );
  for (const time of [new Date("2026-10-05T10:00:00Z")]) {
    assert.throws(() =>
      requireCurrentPreclientExemption(approval, binding, time),
    );
  }
  assert.equal(
    PreclientExemptionSchema.safeParse({
      ...approval,
      validUntil: approval.approvedAt,
    }).success,
    false,
  );
});
test("strict contracts reject authority, payment claims and widened exemptions", () => {
  for (const field of [
    "workspaceId",
    "executionAuthority",
    "paid",
    "grant",
    "billingExempt",
  ]) {
    assert.equal(
      PreclientExemptionSchema.safeParse({ ...approval, [field]: true })
        .success,
      false,
    );
    assert.equal(
      ClientOnboardingBindingSchema.safeParse({ ...binding, [field]: true })
        .success,
      false,
    );
  }
  assert.equal(
    PreclientExemptionSchema.safeParse({ ...approval, scope: "all_charges" })
      .success,
    false,
  );
});
test("prospect intake is bounded declaration and does not accept hidden approvals", () => {
  const intake = {
    organisationName: "Fictional",
    websiteUrl: "https://fictional.invalid",
    otherTools: [],
    currentContactCount: 0,
  };
  assert.equal(ClientOnboardingIntakeSchema.safeParse(intake).success, true);
  for (const patch of [
    { currentContactCount: -1 },
    { currentContactCount: 1.5 },
    { currentContactCount: Number.MAX_SAFE_INTEGER + 1 },
    { paid: true },
    { otherTools: Array(41).fill("tool") },
  ]) {
    assert.equal(
      ClientOnboardingIntakeSchema.safeParse({ ...intake, ...patch }).success,
      false,
    );
  }
});

test("active exemptions remain valid years later, including legacy dated approvals", () => {
  const later = new Date("2036-10-05T12:00:00Z");
  assert.equal(
    requireCurrentPreclientExemption(approval, binding, later).status,
    "active",
  );
  const { validUntil, ...permanent } = approval;
  void validUntil;
  assert.equal(
    requireCurrentPreclientExemption(permanent, binding, later).status,
    "active",
  );
});
