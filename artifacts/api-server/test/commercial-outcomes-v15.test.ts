import test from "node:test";
import assert from "node:assert/strict";
import type { Document } from "mongodb";
import { generatePlatformId as id } from "../src/domain/ids";
import {
  parseCommercialV15,
  CommercialTransactionV15Schema,
  CommercialSubscriptionV15Schema,
  parseCommercialEventV15,
} from "../src/domain/commercial-outcomes-v15";
import {
  checkCommercialV15References,
  checkCommercialEventV15,
} from "../src/domain/commercial-outcomes-v15-references";
import { reasoningEvidenceDigest as digest } from "../src/domain/reasoning-reference-check";
import {
  TransactionSchema,
  SubscriptionSchema,
  ProductRelationshipSchema,
} from "../src/domain/schemas";
import { crmPatchSchema } from "../src/services/crm-foundation";

const at = new Date("2026-10-04T10:00:00Z"),
  after = new Date("2026-10-04T11:00:00Z");
function fixture() {
  const workspaceId = id("workspace"),
    organisationId = id("org"),
    personId = id("person");
  const evidenceRow = {
    id: id("event"),
    workspaceId,
    createdAt: at,
    updatedAt: at,
    occurredAt: at,
    eventType: "synthetic_commercial_confirmation",
    payload: { fictional: true },
  };
  const evidence = [
    {
      collection: "events",
      id: evidenceRow.id,
      contentHash: digest(evidenceRow),
    },
  ];
  const offering = {
    kind: "offering",
    entityId: id("offering"),
    snapshotId: id("hiverevision"),
    revision: 1,
    contentHash: "a".repeat(64),
  };
  const base = {
    commercialVersion: 1,
    workspaceId,
    organisationId,
    personId,
    offering,
    createdAt: at,
    updatedAt: at,
  };
  const provenance = {
    sourceSystem: "fictional_client",
    sourceAccount: "atlas_test",
    externalReference: "sale_001",
    sourceRevision: "1",
    confirmedAt: at,
    evidence,
  };
  const transaction = {
    ...base,
    id: id("transaction"),
    type: "purchase",
    status: "completed",
    quantity: 1,
    unit: "site",
    grossAmountMinor: 199500,
    currency: "GBP",
    transactedAt: at,
    commercialKind: "one_off",
    provenance,
  };
  const relationship = {
    ...base,
    id: id("prodrel"),
    status: "prospect",
    effectiveAt: at,
    transactions: [],
    evidence,
  };
  const subscription = {
    ...base,
    id: id("subscription"),
    status: "active",
    quantity: 1,
    unit: "site",
    recurringAmountMinor: 29500,
    currency: "GBP",
    billingInterval: "month",
    effectiveAt: at,
    provenance: { ...provenance, externalReference: "commitment_001" },
  };
  const rows = new Map<string, Document>();
  const put = (collection: string, row: Document) => {
    rows.set(collection + ":" + row.id, row);
    return { collection, id: row.id, digest: digest(row) };
  };
  put("events", evidenceRow);
  put("organisations", {
    id: organisationId,
    workspaceId,
    name: "Atlas Manufacturing",
    createdAt: at,
  });
  put("people", { id: personId, workspaceId, name: "Sarah", createdAt: at });
  put("offerings", { id: offering.entityId, workspaceId, createdAt: at });
  put("hive_definition_revisions", {
    id: offering.snapshotId,
    workspaceId,
    createdAt: at,
    entityId: offering.entityId,
    entityType: "offerings",
    revision: 1,
    snapshot: { contentHash: offering.contentHash },
  });
  const resolve = async (collection: string, id: string) =>
    rows.get(collection + ":" + id) ?? null;
  // Test-only verifier; production integration/authentication is deliberately not implemented.
  const confirm = async () => true;
  return {
    workspaceId,
    organisationId,
    personId,
    evidence,
    offering,
    transaction,
    relationship,
    subscription,
    rows,
    put,
    resolve,
    confirm,
  };
}
test("Atlas: purchase fact, distinct Event, contextual customer, potential, additional sites and recurring commitment", async () => {
  const f = fixture();
  await checkCommercialV15References(
    "product_relationships",
    f.relationship,
    f.workspaceId,
    f.resolve,
  );
  const prospect = f.put("product_relationships", f.relationship);
  await checkCommercialV15References(
    "transactions",
    f.transaction,
    f.workspaceId,
    f.resolve,
    f.confirm,
  );
  const purchase = f.put("transactions", f.transaction);
  const customer = {
    ...f.relationship,
    id: id("prodrel"),
    createdAt: after,
    updatedAt: after,
    effectiveAt: after,
    status: "customer",
    transactions: [purchase],
    supersedes: prospect,
  };
  await checkCommercialV15References(
    "product_relationships",
    customer,
    f.workspaceId,
    f.resolve,
  );
  const customerRef = f.put("product_relationships", customer);
  const event = await checkCommercialEventV15(
    {
      record: {
        id: id("event"),
        workspaceId: f.workspaceId,
        organisationId: f.organisationId,
        personId: f.personId,
        createdAt: after,
        updatedAt: after,
        occurredAt: at,
        eventType: "purchase_completed",
      },
      commercialTransaction: purchase,
    },
    f.workspaceId,
    f.resolve,
  );
  assert.equal(event.commercialTransaction.id, f.transaction.id);
  assert.equal("grossAmountMinor" in event, false);
  const value = {
    workspaceId: f.workspaceId,
    id: id("relationshipvalue"),
    createdAt: after,
    updatedAt: after,
    source: { kind: "platform", reference: "synthetic" },
    key: "account",
    version: 1,
    subject: { kind: "organisation", organisationId: f.organisationId },
    influencingPersonIds: [f.personId],
    offerings: [f.offering],
    dimensions: [
      {
        key: "potential",
        basis: "estimated_potential",
        statement: "Additional sites remain an opportunity",
        measurement: { value: 50000, unit: "gbp", currency: "GBP" },
        evidence: f.evidence,
        assumptions: [],
        confidence: 0.7,
      },
    ],
    methodologies: [],
    validFrom: at,
    realisedTransactions: [purchase],
  };
  await checkCommercialV15References(
    "relationship_value_assessments",
    value,
    f.workspaceId,
    f.resolve,
  );
  const more = {
    ...f.transaction,
    id: id("transaction"),
    quantity: 3,
    grossAmountMinor: 598500,
    provenance: { ...f.transaction.provenance, externalReference: "sale_002" },
  };
  await checkCommercialV15References(
    "transactions",
    more,
    f.workspaceId,
    f.resolve,
    f.confirm,
  );
  await checkCommercialV15References(
    "subscriptions",
    f.subscription,
    f.workspaceId,
    f.resolve,
    f.confirm,
  );
  const recurring = f.put("subscriptions", f.subscription);
  await checkCommercialV15References(
    "transactions",
    {
      ...f.transaction,
      id: id("transaction"),
      commercialKind: "recurring",
      subscription: recurring,
      grossAmountMinor: 29500,
    },
    f.workspaceId,
    f.resolve,
    f.confirm,
  );
  const other = {
    ...f.offering,
    entityId: id("offering"),
    snapshotId: id("hiverevision"),
  };
  f.put("offerings", {
    id: other.entityId,
    workspaceId: f.workspaceId,
    createdAt: at,
  });
  f.put("hive_definition_revisions", {
    id: other.snapshotId,
    workspaceId: f.workspaceId,
    createdAt: at,
    entityId: other.entityId,
    entityType: "offerings",
    revision: 1,
    snapshot: { contentHash: other.contentHash },
  });
  await checkCommercialV15References(
    "product_relationships",
    { ...f.relationship, id: id("prodrel"), offering: other },
    f.workspaceId,
    f.resolve,
  );
  const context = {
    workspaceId: f.workspaceId,
    id: id("reasoningcontext"),
    createdAt: after,
    updatedAt: after,
    source: { kind: "platform", reference: "synthetic" },
    objective:
      "Protect existing customer relationship while considering other propositions",
    organisationIds: [f.organisationId],
    personIds: [f.personId],
    contactPointIds: [],
    campaignIds: [],
    knowledge: [f.offering],
    observationIds: [],
    evidence: [],
    methodologies: [],
    policies: [],
    learningIds: [],
    currentStateEvidence: [],
    commercial: {
      transactions: [purchase],
      relationships: [customerRef],
      commitments: [recurring],
    },
  };
  await checkCommercialV15References(
    "reasoning_contexts",
    context,
    f.workspaceId,
    f.resolve,
  );
  assert.equal(f.transaction.grossAmountMinor, 199500);
  assert.equal(value.dimensions[0].basis, "estimated_potential");
  assert.equal(f.relationship.status, "prospect");
});
for (const field of [
  "workspaceId",
  "organisationId",
  "offering",
  "grossAmountMinor",
  "currency",
  "provenance",
  "quantity",
])
  test(`transaction requires ${field}`, () => {
    const row: Document = fixture().transaction;
    delete row[field];
    assert.throws(() => parseCommercialV15("transactions", row));
  });
test("Person is optional and does not replace Organisation", () => {
  const row: Document = fixture().transaction;
  delete row.personId;
  assert.doesNotThrow(() => parseCommercialV15("transactions", row));
  row.personId = id("person");
  delete row.organisationId;
  assert.throws(() => parseCommercialV15("transactions", row));
});
for (const [label, patch] of Object.entries({
  authority: { grant: "execute" },
  tax: { taxAmountMinor: 100 },
  invoice: { invoiceId: "invoice" },
  unknownVersion: { commercialVersion: 2 },
  invalidCurrency: { currency: "ZZZ" },
  fractionalMinor: { grossAmountMinor: 0.5 },
  negativeMoney: { grossAmountMinor: -1 },
  noQuantity: { quantity: 0 },
  pending: { status: "pending" },
  mutable: { updatedAt: after },
  future: { transactedAt: after },
  missingRecurring: { commercialKind: "recurring" },
  missingOriginal: { type: "refund" },
}))
  test(`rejects ${label}`, () =>
    assert.throws(() =>
      parseCommercialV15("transactions", {
        ...fixture().transaction,
        ...patch,
      }),
    ));
test("source labels and click Events do not independently confirm a sale", async () => {
  const f = fixture();
  await assert.rejects(
    checkCommercialV15References(
      "transactions",
      f.transaction,
      f.workspaceId,
      f.resolve,
    ),
    /Independent commercial confirmation/,
  );
  await assert.rejects(
    checkCommercialV15References(
      "transactions",
      f.transaction,
      f.workspaceId,
      f.resolve,
      async () => false,
    ),
    /Independent commercial confirmation/,
  );
});
for (const kind of ["refund", "reversal", "correction", "cancellation"])
  test(`${kind} appends exact original history`, async () => {
    const f = fixture(),
      original = structuredClone(f.transaction);
    const ref = f.put("transactions", f.transaction);
    const change = {
      ...f.transaction,
      id: id("transaction"),
      type: kind,
      createdAt: after,
      updatedAt: after,
      transactedAt: after,
      originalTransaction: ref,
      provenance: {
        ...f.transaction.provenance,
        externalReference: kind + "_001",
        confirmedAt: after,
      },
    };
    await checkCommercialV15References(
      "transactions",
      change,
      f.workspaceId,
      f.resolve,
      f.confirm,
    );
    assert.deepEqual(f.transaction, original);
    await assert.rejects(
      checkCommercialV15References(
        "transactions",
        { ...change, currency: "USD" },
        f.workspaceId,
        f.resolve,
        f.confirm,
      ),
      /scope\/currency/,
    );
  });
for (const fault of ["workspace", "digest", "offering", "evidence", "future"])
  test(`reference admission fails closed on ${fault}`, async () => {
    const f = fixture();
    if (fault === "workspace")
      f.rows.get("organisations:" + f.organisationId)!.workspaceId =
        id("workspace");
    if (fault === "offering")
      f.rows.get(
        "hive_definition_revisions:" + f.offering.snapshotId,
      )!.revision = 2;
    if (fault === "evidence")
      f.transaction.provenance.evidence[0].contentHash = "b".repeat(64);
    if (fault === "future")
      f.rows.get("people:" + f.personId)!.createdAt = after;
    if (fault === "digest") {
      const ref = f.put("subscriptions", f.subscription);
      ref.digest = "b".repeat(64);
      await assert.rejects(
        checkCommercialV15References(
          "transactions",
          { ...f.transaction, commercialKind: "recurring", subscription: ref },
          f.workspaceId,
          f.resolve,
          f.confirm,
        ),
      );
      return;
    }
    await assert.rejects(
      checkCommercialV15References(
        "transactions",
        f.transaction,
        f.workspaceId,
        f.resolve,
        f.confirm,
      ),
    );
  });
test("subscription cancellation is a new assertion; original active commitment is retained", async () => {
  const f = fixture(),
    before = structuredClone(f.subscription),
    supersedes = f.put("subscriptions", f.subscription);
  const cancelled = {
    ...f.subscription,
    id: id("subscription"),
    status: "cancelled",
    createdAt: after,
    updatedAt: after,
    effectiveAt: after,
    supersedes,
    provenance: {
      ...f.subscription.provenance,
      sourceRevision: "2",
      confirmedAt: after,
    },
  };
  await checkCommercialV15References(
    "subscriptions",
    cancelled,
    f.workspaceId,
    f.resolve,
    f.confirm,
  );
  assert.deepEqual(f.subscription, before);
  await assert.rejects(
    checkCommercialV15References(
      "subscriptions",
      {
        ...cancelled,
        provenance: { ...cancelled.provenance, externalReference: "different" },
      },
      f.workspaceId,
      f.resolve,
      f.confirm,
    ),
    /source identity/,
  );
});
test("customer cannot come from an Event or another Offering's purchase", async () => {
  const f = fixture();
  assert.throws(() =>
    parseCommercialV15("product_relationships", {
      ...f.relationship,
      status: "customer",
    }),
  );
  const ref = f.put("transactions", f.transaction);
  f.transaction.organisationId = id("org");
  await assert.rejects(
    checkCommercialV15References(
      "product_relationships",
      { ...f.relationship, status: "customer", transactions: [ref] },
      f.workspaceId,
      f.resolve,
    ),
  );
});
test("legacy schemas/write contracts remain separate and reject new offering-only records", () => {
  const f = fixture();
  assert.equal(TransactionSchema.safeParse(f.transaction).success, false);
  assert.equal(SubscriptionSchema.safeParse(f.subscription).success, false);
  assert.equal(
    ProductRelationshipSchema.safeParse(f.relationship).success,
    false,
  );
  assert.equal(
    crmPatchSchema("product_relationships").safeParse({
      commercialVersion: 1,
      offering: f.offering,
    }).success,
    false,
  );
  assert.equal(
    CommercialTransactionV15Schema.safeParse({
      ...f.transaction,
      provider: "fabricated",
    }).success,
    false,
  );
  assert.equal(
    CommercialSubscriptionV15Schema.safeParse({
      ...f.subscription,
      externalSubscriptionId: "fabricated",
    }).success,
    false,
  );
  assert.throws(() =>
    parseCommercialEventV15({
      record: {},
      commercialTransaction: f.evidence[0],
    }),
  );
});
test("customer evidence from another Offering fails even with a valid exact digest", async () => {
  const f = fixture(),
    transaction = {
      ...f.transaction,
      offering: {
        ...f.offering,
        entityId: id("offering"),
        snapshotId: id("hiverevision"),
      },
    };
  f.put("offerings", {
    id: transaction.offering.entityId,
    workspaceId: f.workspaceId,
    createdAt: at,
  });
  f.put("hive_definition_revisions", {
    id: transaction.offering.snapshotId,
    workspaceId: f.workspaceId,
    createdAt: at,
    entityType: "offerings",
    entityId: transaction.offering.entityId,
    revision: 1,
    snapshot: { contentHash: f.offering.contentHash },
  });
  const ref = f.put("transactions", transaction);
  await assert.rejects(
    checkCommercialV15References(
      "product_relationships",
      { ...f.relationship, status: "customer", transactions: [ref] },
      f.workspaceId,
      f.resolve,
    ),
    /Organisation\/Offering mismatch/,
  );
});
test("exact commercial Context supports existing Contact Strategy policies without granting execution", async () => {
  const f = fixture(),
    purchase = f.put("transactions", f.transaction);
  const policy = {
    workspaceId: f.workspaceId,
    id: id("contactstrategy"),
    createdAt: at,
    updatedAt: at,
    source: { kind: "human", reference: "synthetic-queen" },
    key: "protect_customer",
    version: 1,
    status: "recorded",
    organisationIds: [f.organisationId],
    personIds: [],
    contactPointIds: [],
    campaignIds: [],
    knowledge: [f.offering],
    clauses: [
      {
        key: "customer",
        category: "contact",
        statement:
          "Review acquisition contact when an admitted purchase exists",
        evidence: f.evidence,
      },
    ],
  };
  f.put("contact_strategy_policies", policy);
  const context = {
    workspaceId: f.workspaceId,
    id: id("reasoningcontext"),
    createdAt: after,
    updatedAt: after,
    source: { kind: "platform", reference: "synthetic" },
    objective: "Consider customer protection",
    organisationIds: [f.organisationId],
    personIds: [],
    contactPointIds: [],
    campaignIds: [],
    knowledge: [f.offering],
    observationIds: [],
    evidence: [],
    methodologies: [],
    policies: [{ id: policy.id, version: 1 }],
    learningIds: [],
    currentStateEvidence: [],
    commercial: {
      transactions: [purchase],
      relationships: [],
      commitments: [],
    },
  };
  await checkCommercialV15References(
    "reasoning_contexts",
    context,
    f.workspaceId,
    f.resolve,
  );
  await assert.rejects(
    checkCommercialV15References(
      "reasoning_contexts",
      { ...context, organisationIds: [] },
      f.workspaceId,
      f.resolve,
    ),
    /subject\/Offering/,
  );
  await assert.rejects(
    checkCommercialV15References(
      "reasoning_contexts",
      context,
      id("workspace"),
      f.resolve,
    ),
    /Workspace mismatch/,
  );
  assert.throws(() =>
    parseCommercialV15("reasoning_contexts", {
      ...context,
      executionAuthority: "allowed",
    }),
  );
});
test("purchase Event rejects changed fact, wrong customer, unrelated time and foreign workspace", async () => {
  const f = fixture(),
    commercialTransaction = f.put("transactions", f.transaction);
  const record = {
    id: id("event"),
    workspaceId: f.workspaceId,
    organisationId: f.organisationId,
    occurredAt: at,
    createdAt: after,
    updatedAt: after,
    eventType: "purchase_completed",
  };
  for (const patch of [
    { organisationId: id("org") },
    { workspaceId: id("workspace") },
    { occurredAt: after },
  ])
    await assert.rejects(
      checkCommercialEventV15(
        { record: { ...record, ...patch }, commercialTransaction },
        f.workspaceId,
        f.resolve,
      ),
    );
  f.transaction.grossAmountMinor = 1;
  await assert.rejects(
    checkCommercialEventV15(
      { record, commercialTransaction },
      f.workspaceId,
      f.resolve,
    ),
    /exact commercial fact/,
  );
});
