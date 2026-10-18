import type { Document } from "mongodb";
const id = (prefix: string) => `${prefix}_00000000000000000000000000`;
const at = new Date("2026-10-04T00:00:00Z");
const offering = {
  kind: "offering",
  entityId: id("offering"),
  snapshotId: id("hiverevision"),
  revision: 1,
  contentHash: "a".repeat(64),
};
const evidence = [
  { collection: "events", id: id("event"), contentHash: "b".repeat(64) },
];
const provenance = {
  sourceSystem: "synthetic",
  sourceAccount: "synthetic",
  externalReference: "synthetic",
  sourceRevision: "1",
  confirmedAt: at,
  evidence,
};
const common = { workspaceId: id("workspace"), createdAt: at, updatedAt: at };
const commercial = {
  ...common,
  commercialVersion: 1,
  organisationId: id("org"),
  offering,
};
const ref = {
  collection: "transactions",
  id: id("transaction"),
  digest: "c".repeat(64),
};
export const commercialParityBaselines: Record<string, Document> = {
  transactions: {
    ...commercial,
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
  },
  subscriptions: {
    ...commercial,
    id: id("subscription"),
    status: "active",
    quantity: 1,
    unit: "site",
    recurringAmountMinor: 29500,
    currency: "GBP",
    billingInterval: "month",
    effectiveAt: at,
    provenance,
  },
  product_relationships: {
    ...commercial,
    id: id("prodrel"),
    status: "prospect",
    effectiveAt: at,
    transactions: [],
    evidence,
  },
  events: {
    ...common,
    id: id("event"),
    eventType: "purchase_completed",
    occurredAt: at,
    organisationId: id("org"),
    commercialTransaction: ref,
  },
  relationship_value_assessments: {
    ...common,
    id: id("relationshipvalue"),
    source: { kind: "platform", reference: "synthetic" },
    key: "potential",
    version: 1,
    subject: { kind: "organisation", organisationId: id("org") },
    influencingPersonIds: [],
    offerings: [offering],
    dimensions: [
      {
        key: "potential",
        basis: "estimated_potential",
        statement: "Synthetic potential",
        evidence,
        assumptions: [],
        confidence: 0.5,
      },
    ],
    methodologies: [],
    validFrom: at,
    realisedTransactions: [ref],
  },
  reasoning_contexts: {
    ...common,
    id: id("reasoningcontext"),
    source: { kind: "platform", reference: "synthetic" },
    objective: "Synthetic commercial review",
    organisationIds: [id("org")],
    personIds: [],
    contactPointIds: [],
    campaignIds: [],
    knowledge: [offering],
    observationIds: [],
    evidence: [],
    methodologies: [],
    policies: [],
    learningIds: [],
    currentStateEvidence: [],
    commercial: { transactions: [ref], relationships: [], commitments: [] },
  },
};
export interface CommercialParityCase {
  collection: string;
  name: string;
  document: Document;
  valid: boolean;
  applicationValid?: boolean;
}
export const commercialParityCases: CommercialParityCase[] = [];
function add(
  collection: string,
  name: string,
  mutate: (row: Document) => void,
  valid = false,
  applicationValid = valid,
) {
  const document = structuredClone(commercialParityBaselines[collection]);
  mutate(document);
  commercialParityCases.push({
    collection,
    name,
    document,
    valid,
    applicationValid,
  });
}
for (const collection of Object.keys(commercialParityBaselines)) {
  add(collection, "valid", () => {}, true);
  add(
    collection,
    "Mongo transport identity",
    (r) => {
      r._id = "synthetic";
    },
    true,
  );
  add(collection, "missing workspace", (r) => {
    delete r.workspaceId;
  });
  add(collection, "wrong workspace prefix", (r) => {
    r.workspaceId = id("org");
  });
  if (collection !== "events")
    add(collection, "unknown execution authority", (r) => {
      r.executionGrant = "fabricated";
    });
}
for (const collection of [
  "transactions",
  "subscriptions",
  "product_relationships",
]) {
  add(collection, "missing discriminator cannot use legacy branch", (r) => {
    delete r.commercialVersion;
  });
  add(collection, "null discriminator", (r) => {
    r.commercialVersion = null;
  });
  add(collection, "unsupported discriminator", (r) => {
    r.commercialVersion = 2;
  });
  add(collection, "missing Organisation", (r) => {
    delete r.organisationId;
  });
  add(collection, "wrong Offering revision identity", (r) => {
    r.offering.snapshotId = id("person");
  });
  add(collection, "mutable snapshot", (r) => {
    r.updatedAt = new Date(at.getTime() + 1);
  });
  add(
    collection,
    "optional participating Person",
    (r) => {
      r.personId = id("person");
    },
    true,
  );
}
for (const collection of ["transactions", "subscriptions"]) {
  add(collection, "negative amount", (r) => {
    r[
      collection === "transactions"
        ? "grossAmountMinor"
        : "recurringAmountMinor"
    ] = -1;
  });
  add(collection, "fractional amount", (r) => {
    r[
      collection === "transactions"
        ? "grossAmountMinor"
        : "recurringAmountMinor"
    ] = 0.1;
  });
  add(collection, "unknown currency", (r) => {
    r.currency = "ZZZ";
  });
  add(collection, "zero quantity", (r) => {
    r.quantity = 0;
  });
  add(collection, "missing provenance", (r) => {
    delete r.provenance;
  });
  add(collection, "no source evidence", (r) => {
    r.provenance.evidence = [];
  });
  // Documented application-only semantic checks: Mongo is not the trusted admission service.
  add(
    collection,
    "future confirmation (application-only)",
    (r) => {
      r.provenance.confirmedAt = new Date(at.getTime() + 1);
    },
    true,
    false,
  );
}
add(
  "transactions",
  "refund missing original (application-only)",
  (r) => {
    r.type = "refund";
  },
  true,
  false,
);
add(
  "product_relationships",
  "customer missing purchases (application-only)",
  (r) => {
    r.status = "customer";
  },
  true,
  false,
);
add(
  "reasoning_contexts",
  "duplicate transaction identity (application-only)",
  (r) => {
    r.commercial.transactions.push({ ...r.commercial.transactions[0] });
  },
  true,
  false,
);
add(
  "relationship_value_assessments",
  "duplicate realised fact (application-only)",
  (r) => {
    r.realisedTransactions.push({ ...r.realisedTransactions[0] });
  },
  true,
  false,
);
for (const collection of [
  "transactions",
  "subscriptions",
  "product_relationships",
])
  commercialParityCases.push({
    collection,
    name: "legacy Product branch preserved",
    document: {
      id: id(
        collection === "transactions"
          ? "transaction"
          : collection === "subscriptions"
            ? "subscription"
            : "prodrel",
      ),
      productId: id("product"),
      ...common,
    },
    valid: true,
  });
