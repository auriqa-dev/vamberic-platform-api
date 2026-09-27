import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BILLING_TREATMENTS,
  ProductSchema,
  CrmWorkspaceSchema,
  CapabilitySchema,
  CapabilityInstanceSchema,
  CommercialPackageSchema,
  CommercialChargeSchema,
  EntitlementSchema,
  EntitlementInsertSchema,
  SubscriptionSchema,
  ExternalReferenceSchema,
  generatePlatformId,
  hasCapabilityInstanceEntitlement,
  validateCommercialModel,
  type Capability,
  type CapabilityInstance,
  type CommercialModel,
} from "../src/domain";

const now = new Date("2026-09-27T12:00:00Z");
const dates = { createdAt: now, updatedAt: now };
function fixture() {
  const workspace = CrmWorkspaceSchema.parse({
    ...dates,
    id: generatePlatformId("workspace"),
    kind: "client",
    name: "Example",
    clientOrganisationId: generatePlatformId("org"),
  });
  const product = (name: string) =>
    ProductSchema.parse({
      ...dates,
      id: generatePlatformId("product"),
      workspaceId: workspace.id,
      name,
      slug: `product-${name.toLowerCase()}`,
      productType: "software",
      lifecycleStatus: "idea",
    });
  const a = product("A"),
    b = product("B");
  const capability = (
    name: string,
    supportedScopeTypes: ("workspace" | "product")[],
  ) =>
    CapabilitySchema.parse({
      ...dates,
      id: generatePlatformId("capability"),
      name,
      supportedScopeTypes,
    });
  const mission = capability("Mission", ["workspace"]),
    offer = capability("Offer", ["product"]),
    strategy = capability("Strategy", ["product"]);
  const lead = CapabilitySchema.parse({
    ...capability("Lead", ["product"]),
    dependencies: [{ capabilityId: strategy.id, scope: "same_scope" }],
  });
  const instance = (c: Capability, p?: typeof a, deps: string[] = []) =>
    CapabilityInstanceSchema.parse({
      ...dates,
      id: generatePlatformId("capinstance"),
      workspaceId: workspace.id,
      capabilityId: c.id,
      scopeType: p ? "product" : "workspace",
      ...(p ? { scopeProductId: p.id } : {}),
      status: "enabled",
      dependencyInstanceIds: deps,
    });
  const missionI = instance(mission),
    offerA = instance(offer, a),
    offerB = instance(offer, b),
    strategyA = instance(strategy, a),
    strategyB = instance(strategy, b);
  const leadA = instance(lead, a, [strategyA.id]);
  const model: CommercialModel = {
    workspaces: [workspace],
    products: [a, b],
    capabilities: [mission, offer, strategy, lead],
    instances: [missionI, offerA, offerB, strategyA, strategyB, leadA],
  };
  const grant = (i: CapabilityInstance, extra: Record<string, unknown> = {}) =>
    EntitlementSchema.parse({
      ...dates,
      id: generatePlatformId("entitlement"),
      workspaceId: workspace.id,
      capabilityInstanceId: i.id,
      entitlementType: "permanent",
      status: "active",
      activeFrom: now,
      ...extra,
    });
  return {
    model,
    workspace,
    a,
    b,
    mission,
    offer,
    strategy,
    lead,
    missionI,
    offerA,
    offerB,
    strategyA,
    strategyB,
    leadA,
    instance,
    grant,
  };
}

for (const billingTreatment of BILLING_TREATMENTS)
  test(`${billingTreatment} retains identical scoped instance access without payments`, () => {
    const f = fixture();
    assert.equal(
      hasCapabilityInstanceEntitlement(
        f.model,
        [f.grant(f.offerA, { billingTreatment })],
        f.offerA.id,
        f.workspace.id,
        now,
      ),
      true,
    );
  });

test("workspace Mission and independent Offer instances coexist for two Products", () => {
  const f = fixture();
  assert.doesNotThrow(() => validateCommercialModel(f.model));
  assert.equal(f.missionI.scopeType, "workspace");
  assert.equal(f.missionI.scopeProductId, undefined);
  assert.notEqual(f.offerA.id, f.offerB.id);
  assert.equal(f.offerA.scopeProductId, f.a.id);
  assert.equal(f.offerB.scopeProductId, f.b.id);
  assert.equal(
    f.model.instances.filter((i) => i.capabilityId === f.mission.id).length,
    1,
  );
  assert.equal(
    CapabilityInstanceSchema.safeParse({
      ...f.missionI,
      scopeProductId: f.a.id,
    }).success,
    false,
  );
  assert.equal(
    CapabilityInstanceSchema.safeParse({
      ...f.offerA,
      scopeProductId: undefined,
    }).success,
    false,
  );
  assert.equal(
    CapabilityInstanceSchema.safeParse({
      ...f.offerA,
      scopeType: "offer",
      offerId: "future",
    }).success,
    false,
  );
  assert.equal(
    CapabilitySchema.safeParse({ ...f.offer, workspaceId: f.workspace.id })
      .success,
    false,
  );
});

test("Product B does not inherit Product A entitlement, configuration or Lead Gen state", () => {
  const f = fixture();
  const snapshot = structuredClone(f.offerA);
  const records = [f.grant(f.offerA), f.grant(f.strategyA), f.grant(f.leadA)];
  assert.equal(
    hasCapabilityInstanceEntitlement(
      f.model,
      records,
      f.offerB.id,
      f.workspace.id,
      now,
    ),
    false,
  );
  const leadB = f.instance(f.lead, f.b, [f.strategyB.id]);
  const extended = { ...f.model, instances: [...f.model.instances, leadB] };
  assert.equal(
    hasCapabilityInstanceEntitlement(
      extended,
      records,
      leadB.id,
      f.workspace.id,
      now,
    ),
    false,
  );
  assert.equal(
    hasCapabilityInstanceEntitlement(
      extended,
      records,
      f.leadA.id,
      f.workspace.id,
      now,
    ),
    true,
  );
  assert.deepEqual(f.offerA, snapshot);
  assert.equal(
    hasCapabilityInstanceEntitlement(
      extended,
      [...records, f.grant(leadB)],
      leadB.id,
      f.workspace.id,
      now,
    ),
    false,
  );
  assert.equal(
    hasCapabilityInstanceEntitlement(
      extended,
      [
        ...records,
        f.grant(leadB),
        f.grant(f.strategyB, { billingTreatment: "bundled" }),
      ],
      leadB.id,
      f.workspace.id,
      now,
    ),
    true,
  );
});

test("workspace capability grants cannot become a global Product agent flag", () => {
  const f = fixture();
  const mission = f.grant(f.missionI, {
    capabilityInstanceId: undefined,
    capabilityId: f.mission.id,
  });
  assert.equal(
    hasCapabilityInstanceEntitlement(
      f.model,
      [mission],
      f.missionI.id,
      f.workspace.id,
      now,
    ),
    true,
  );
  const offer = f.grant(f.offerA, {
    capabilityInstanceId: undefined,
    capabilityId: f.offer.id,
  });
  assert.equal(
    hasCapabilityInstanceEntitlement(
      f.model,
      [offer],
      f.offerA.id,
      f.workspace.id,
      now,
    ),
    false,
  );
  assert.throws(() =>
    validateCommercialModel({ ...f.model, entitlements: [offer] }),
  );
});

test("same-scope Strategy dependency is explicit and Offer is not required for Lead Gen", () => {
  const f = fixture();
  assert.equal(
    hasCapabilityInstanceEntitlement(
      f.model,
      [f.grant(f.leadA)],
      f.leadA.id,
      f.workspace.id,
      now,
    ),
    false,
  );
  assert.equal(
    hasCapabilityInstanceEntitlement(
      f.model,
      [f.grant(f.leadA), f.grant(f.strategyA)],
      f.leadA.id,
      f.workspace.id,
      now,
    ),
    true,
  );
  assert.equal(
    hasCapabilityInstanceEntitlement(
      f.model,
      [f.grant(f.strategyA)],
      f.strategyA.id,
      f.workspace.id,
      now,
    ),
    true,
  );
  for (const dep of [
    f.strategyB.id,
    f.offerA.id,
    f.leadA.id,
    generatePlatformId("capinstance"),
  ]) {
    const model = {
      ...f.model,
      instances: f.model.instances.map((i) =>
        i.id === f.leadA.id ? { ...i, dependencyInstanceIds: [dep] } : i,
      ),
    };
    assert.throws(() => validateCommercialModel(model));
    assert.equal(
      hasCapabilityInstanceEntitlement(
        model,
        [f.grant(f.leadA), f.grant(f.strategyA)],
        f.leadA.id,
        f.workspace.id,
        now,
      ),
      false,
    );
  }
  assert.equal(
    hasCapabilityInstanceEntitlement(
      f.model,
      [f.grant(f.leadA), f.grant(f.strategyA, { status: "revoked" })],
      f.leadA.id,
      f.workspace.id,
      now,
    ),
    false,
  );
});

test("explicit workspace dependency shares Mission across Product contexts without duplication", () => {
  const f = fixture();
  const model = {
    ...f.model,
    capabilities: f.model.capabilities.map((c) =>
      c.id === f.offer.id
        ? {
            ...c,
            dependencies: [
              { capabilityId: f.mission.id, scope: "workspace" as const },
            ],
          }
        : c,
    ),
    instances: f.model.instances.map((i) =>
      i.capabilityId === f.offer.id
        ? { ...i, dependencyInstanceIds: [f.missionI.id] }
        : i,
    ),
  };
  assert.doesNotThrow(() => validateCommercialModel(model));
  const records = [f.grant(f.offerA), f.grant(f.offerB), f.grant(f.missionI)];
  assert.equal(
    hasCapabilityInstanceEntitlement(
      model,
      records,
      f.offerA.id,
      f.workspace.id,
      now,
    ),
    true,
  );
  assert.equal(
    hasCapabilityInstanceEntitlement(
      model,
      records,
      f.offerB.id,
      f.workspace.id,
      now,
    ),
    true,
  );
});

test("one-off and recurring charges attach to the same Offer instance/package without prices", () => {
  const f = fixture();
  const pack = CommercialPackageSchema.parse({
    ...dates,
    id: generatePlatformId("package"),
    workspaceId: f.workspace.id,
    scopeType: "product",
    scopeProductId: f.a.id,
    name: "Illustrative package",
    status: "draft",
    capabilityIds: [f.offer.id, f.strategy.id, f.lead.id],
    capabilityInstanceIds: [f.offerA.id, f.strategyA.id, f.leadA.id],
  });
  const charge = {
    ...dates,
    workspaceId: f.workspace.id,
    capabilityInstanceId: f.offerA.id,
    commercialPackageId: pack.id,
    name: "Illustrative component",
    status: "draft",
    billingTreatment: "standard",
  };
  const setup = CommercialChargeSchema.parse({
    ...charge,
    id: generatePlatformId("charge"),
    chargeType: "one_off",
  });
  const ongoing = CommercialChargeSchema.parse({
    ...charge,
    id: generatePlatformId("charge"),
    chargeType: "recurring",
    billingInterval: "month",
  });
  const model = {
    ...f.model,
    packages: [pack],
    charges: [setup, ongoing],
    entitlements: [f.grant(f.offerA, { commercialPackageId: pack.id })],
  };
  assert.doesNotThrow(() => validateCommercialModel(model));
  assert.equal(setup.amountMinor, undefined);
  assert.equal(ongoing.amountMinor, undefined);
  assert.equal(
    hasCapabilityInstanceEntitlement(
      model,
      [],
      f.offerA.id,
      f.workspace.id,
      now,
    ),
    false,
  );
  assert.throws(() =>
    validateCommercialModel({
      ...model,
      charges: [{ ...setup, capabilityInstanceId: f.offerB.id }],
    }),
  );
  assert.throws(() =>
    validateCommercialModel({
      ...model,
      packages: [{ ...pack, capabilityInstanceIds: [f.offerB.id] }],
    }),
  );
  assert.throws(() =>
    validateCommercialModel({
      ...model,
      entitlements: [f.grant(f.offerB, { commercialPackageId: pack.id })],
    }),
  );
  for (const patch of [
    { chargeType: "recurring" },
    { billingInterval: "month" },
    { amountMinor: 10 },
    { billingTreatment: "free" },
    { approvedBy: { type: "agent", id: "queen" } },
  ])
    assert.equal(
      CommercialChargeSchema.safeParse({ ...setup, ...patch }).success,
      false,
    );
  assert.equal(
    CommercialChargeSchema.safeParse({
      ...setup,
      chargeType: "usage",
      usageUnit: "request",
    }).success,
    true,
  );
});

test("entitlements are independent of subscription state, external IDs and billing components", () => {
  const f = fixture();
  const subscription = SubscriptionSchema.parse({
    ...dates,
    id: generatePlatformId("subscription"),
    productId: f.a.id,
    workspaceId: f.workspace.id,
    organisationId: f.workspace.clientOrganisationId,
    provider: "stripe",
    plan: "illustrative",
    status: "cancelled",
    currency: "GBP",
    recurringAmountMinor: 0,
    billingInterval: "month",
    startedAt: now,
  });
  const record = f.grant(f.offerA, {
    entitlementType: "subscription",
    sourceSubscriptionId: subscription.id,
    billingTreatment: "internal",
  });
  assert.equal(
    hasCapabilityInstanceEntitlement(
      f.model,
      [record],
      f.offerA.id,
      f.workspace.id,
      now,
    ),
    true,
  );
  for (const [entityType, entityId] of [
    ["capability_instances", f.offerA.id],
    ["capabilities", f.offer.id],
    ["commercial_packages", generatePlatformId("package")],
    ["commercial_charges", generatePlatformId("charge")],
    ["subscriptions", subscription.id],
  ] as const) {
    assert.ok(
      ExternalReferenceSchema.safeParse({
        ...dates,
        id: generatePlatformId("externalref"),
        workspaceId: f.workspace.id,
        provider: "stripe",
        providerAccountId: "example",
        objectType: "example",
        externalId: "external-identity",
        entityType,
        entityId,
      }).success,
    );
  }
  assert.equal(
    hasCapabilityInstanceEntitlement(
      f.model,
      [],
      f.offerA.id,
      f.workspace.id,
      now,
    ),
    false,
  );
});

test("workspace isolation rejects references and access across clients, including guessed instance IDs", () => {
  const f = fixture();
  const other = generatePlatformId("workspace");
  assert.equal(
    hasCapabilityInstanceEntitlement(
      f.model,
      [f.grant(f.offerA)],
      f.offerA.id,
      other,
      now,
    ),
    false,
  );
  assert.equal(
    hasCapabilityInstanceEntitlement(
      f.model,
      [f.grant(f.offerA, { workspaceId: other })],
      f.offerA.id,
      f.workspace.id,
      now,
    ),
    false,
  );
  assert.throws(() =>
    validateCommercialModel({
      ...f.model,
      products: [{ ...f.a, workspaceId: other }, f.b],
    }),
  );
  assert.throws(() =>
    validateCommercialModel({
      ...f.model,
      entitlements: [f.grant(f.offerA, { workspaceId: other })],
    }),
  );
  assert.equal(
    hasCapabilityInstanceEntitlement(
      f.model,
      [f.grant(f.offerA)],
      f.offerA.id,
      "",
      now,
    ),
    false,
  );
  assert.equal(
    hasCapabilityInstanceEntitlement(
      { ...f.model, workspaces: [{ ...f.workspace, archived: true }] },
      [f.grant(f.offerA)],
      f.offerA.id,
      f.workspace.id,
      now,
    ),
    false,
  );
});

test("legacy entitlement shape stays valid; new targets are exclusive, workspace-scoped and accountable", () => {
  const f = fixture();
  const record = f.grant(f.offerA);
  assert.equal(record.billingTreatment, undefined);
  assert.equal(
    EntitlementSchema.safeParse({
      ...record,
      capabilityInstanceId: undefined,
      productId: f.a.id,
      workspaceId: undefined,
      organisationId: f.workspace.clientOrganisationId,
    }).success,
    true,
  );
  for (const patch of [
    { productId: f.a.id },
    { capabilityId: f.offer.id },
    { capabilityInstanceId: undefined },
    { workspaceId: undefined },
    { billingTreatment: "free" },
    { approvedBy: { type: "system", id: "root" } },
  ])
    assert.equal(
      EntitlementSchema.safeParse({ ...record, ...patch }).success,
      false,
    );
  const insert = {
    capabilityInstanceId: f.offerA.id,
    workspaceId: f.workspace.id,
    id: generatePlatformId("entitlement"),
    entitlementType: "permanent",
    activeFrom: now,
    status: "active",
  };
  assert.equal(EntitlementInsertSchema.safeParse(insert).success, true);
  assert.equal(
    EntitlementInsertSchema.safeParse({ ...insert, activeUntil: now }).success,
    false,
  );
});

test("expiry, disabled state and narrow grants fail closed", () => {
  const f = fixture();
  const until = new Date(now.getTime() + 1000);
  const grant = f.grant(f.offerA, { activeUntil: until });
  assert.equal(
    hasCapabilityInstanceEntitlement(
      f.model,
      [grant],
      f.offerA.id,
      f.workspace.id,
      new Date(now.getTime() - 1),
    ),
    false,
  );
  assert.equal(
    hasCapabilityInstanceEntitlement(
      f.model,
      [grant],
      f.offerA.id,
      f.workspace.id,
      until,
    ),
    false,
  );
  for (const extra of [
    { quantity: 0 },
    { archived: true },
    { status: "revoked" },
    { personId: generatePlatformId("person") },
    { scope: { feature: "narrow" } },
  ])
    assert.equal(
      hasCapabilityInstanceEntitlement(
        f.model,
        [f.grant(f.offerA, extra)],
        f.offerA.id,
        f.workspace.id,
        now,
      ),
      false,
    );
  const model = {
    ...f.model,
    instances: f.model.instances.map((i) =>
      i.id === f.offerA.id ? { ...i, status: "disabled" as const } : i,
    ),
  };
  assert.equal(
    hasCapabilityInstanceEntitlement(
      model,
      [f.grant(f.offerA)],
      f.offerA.id,
      f.workspace.id,
      now,
    ),
    false,
  );
});

test("catalogue dependency cycles and incompatible scope requirements are rejected", () => {
  const f = fixture();
  const cyclic = {
    ...f.strategy,
    dependencies: [{ capabilityId: f.lead.id, scope: "same_scope" as const }],
  };
  assert.throws(
    () =>
      validateCommercialModel({
        ...f.model,
        capabilities: f.model.capabilities.map((c) =>
          c.id === cyclic.id ? cyclic : c,
        ),
      }),
    /cycle/,
  );
  assert.throws(() =>
    validateCommercialModel({
      ...f.model,
      capabilities: f.model.capabilities.map((c) =>
        c.id === f.mission.id
          ? {
              ...c,
              dependencies: [
                { capabilityId: f.offer.id, scope: "same_scope" as const },
              ],
            }
          : c,
      ),
    }),
  );
});

test("instance output/configuration stays attached to its Product and is bounded", () => {
  const f = fixture();
  const configured = CapabilityInstanceSchema.parse({
    ...f.offerB,
    configuration: { objective: "Offer diagnosis" },
    output: { positioning: "Original B2B hypothesis" },
  });
  assert.equal(configured.scopeProductId, f.b.id);
  assert.equal(f.offerA.configuration, undefined);
  assert.equal(f.offerA.output, undefined);
  assert.equal(
    CapabilityInstanceSchema.safeParse({
      ...configured,
      output: { text: "x".repeat(17000) },
    }).success,
    false,
  );
});

test("commercial charge validity and payment state cannot override a valid functional entitlement", () => {
  const f = fixture();
  const unrelatedBilling = {
    ...f.model,
    charges: [
      CommercialChargeSchema.parse({
        ...dates,
        id: generatePlatformId("charge"),
        workspaceId: generatePlatformId("workspace"),
        name: "Unrelated",
        capabilityInstanceId: generatePlatformId("capinstance"),
        chargeType: "one_off",
        billingTreatment: "standard",
        status: "draft",
      }),
    ],
  };
  assert.throws(() => validateCommercialModel(unrelatedBilling));
  assert.equal(
    hasCapabilityInstanceEntitlement(
      unrelatedBilling,
      [f.grant(f.offerA)],
      f.offerA.id,
      f.workspace.id,
      now,
    ),
    true,
  );
});
