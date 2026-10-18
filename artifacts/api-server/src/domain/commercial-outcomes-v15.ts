import { z } from "zod";
import { platformIdSchema, EventSchema } from "./schemas";
import { EvidenceReference } from "./reasoning-foundation";
import {
  RelationshipValueSchema,
  ReasoningContextV14Schema,
  StateReferenceV14,
  parseV14,
} from "./identity-value-v14";

const text = z.string().trim().min(1).max(200);
const count = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
const money = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const currency = z.string().regex(/^[A-Z]{3}$/);
const evidence = z.array(EvidenceReference).min(1).max(50);
export const CommercialOfferingV15 =
  RelationshipValueSchema.shape.offerings.element;
export const CommercialReferenceV15 = StateReferenceV14.extend({
  collection: z.enum([
    "transactions",
    "subscriptions",
    "product_relationships",
  ]),
}).strict();
export const TransactionReferenceV15 = CommercialReferenceV15.extend({
  collection: z.literal("transactions"),
  id: platformIdSchema("transaction"),
});
export const SubscriptionReferenceV15 = CommercialReferenceV15.extend({
  collection: z.literal("subscriptions"),
  id: platformIdSchema("subscription"),
});
export const RelationshipReferenceV15 = CommercialReferenceV15.extend({
  collection: z.literal("product_relationships"),
  id: platformIdSchema("prodrel"),
});
/** Provenance, NOT authentication. A future trusted integration must independently verify this assertion. */
export const CommercialProvenanceV15 = z
  .object({
    sourceSystem: text,
    sourceAccount: text,
    externalReference: text,
    sourceRevision: text,
    confirmedAt: z.date(),
    evidence,
  })
  .strict();
const base = z
  .object({
    commercialVersion: z.literal(1),
    workspaceId: platformIdSchema("workspace"),
    organisationId: platformIdSchema("org"),
    // Participant on behalf of the Organisation, never a second economic subject.
    personId: platformIdSchema("person").optional(),
    offering: CommercialOfferingV15,
    createdAt: z.date(),
    updatedAt: z.date(),
  })
  .strict();
/** Offering commercial-fact branch in the existing transactions collection. Legacy Product records remain unchanged. */
export const CommercialTransactionV15Schema = base
  .extend({
    id: platformIdSchema("transaction"),
    type: z.enum([
      "purchase",
      "renewal",
      "refund",
      "reversal",
      "correction",
      "cancellation",
    ]),
    status: z.literal("completed"),
    quantity: count,
    unit: text,
    grossAmountMinor: money,
    currency,
    transactedAt: z.date(),
    commercialKind: z.enum(["one_off", "recurring"]),
    subscription: SubscriptionReferenceV15.optional(),
    originalTransaction: TransactionReferenceV15.optional(),
    provenance: CommercialProvenanceV15,
  })
  .strict();
/** Immutable external commitment assertion, NOT a billing schedule or realised payment. */
export const CommercialSubscriptionV15Schema = base
  .extend({
    id: platformIdSchema("subscription"),
    status: z.enum(["active", "cancelled", "ended"]),
    quantity: count,
    unit: text,
    recurringAmountMinor: money,
    currency,
    billingInterval: z.enum(["day", "week", "month", "year"]),
    effectiveAt: z.date(),
    supersedes: SubscriptionReferenceV15.optional(),
    provenance: CommercialProvenanceV15,
  })
  .strict();
/** Immutable contextual state, in the existing product_relationships collection. No global customer flag. */
export const CommercialRelationshipV15Schema = base
  .extend({
    id: platformIdSchema("prodrel"),
    status: z.enum([
      "unknown",
      "prospect",
      "engaged",
      "trial",
      "customer",
      "former_customer",
      "partner",
    ]),
    effectiveAt: z.date(),
    transactions: z.array(TransactionReferenceV15).max(50),
    evidence,
    supersedes: RelationshipReferenceV15.optional(),
  })
  .strict();
export const RelationshipValueV15Schema = RelationshipValueSchema.extend({
  // No asserted aggregate: realised amounts remain on the exact referenced facts.
  realisedTransactions: z
    .array(TransactionReferenceV15)
    .min(1)
    .max(50)
    .optional(),
}).strict();
export const ReasoningContextV15Schema = ReasoningContextV14Schema.extend({
  commercial: z
    .object({
      transactions: z.array(TransactionReferenceV15).max(50),
      relationships: z.array(RelationshipReferenceV15).max(50),
      commitments: z.array(SubscriptionReferenceV15).max(50),
    })
    .strict()
    .optional(),
}).strict();
export const V15_SCHEMAS = {
  transactions: CommercialTransactionV15Schema,
  subscriptions: CommercialSubscriptionV15Schema,
  product_relationships: CommercialRelationshipV15Schema,
  relationship_value_assessments: RelationshipValueV15Schema,
  reasoning_contexts: ReasoningContextV15Schema,
} as const;
export type V15Collection = keyof typeof V15_SCHEMAS;
export type CommercialTransactionV15 = z.infer<
  typeof CommercialTransactionV15Schema
>;
export type CommercialSubscriptionV15 = z.infer<
  typeof CommercialSubscriptionV15Schema
>;
export type CommercialRelationshipV15 = z.infer<
  typeof CommercialRelationshipV15Schema
>;
export type RelationshipValueV15 = z.infer<typeof RelationshipValueV15Schema>;
export type ReasoningContextV15 = z.infer<typeof ReasoningContextV15Schema>;

export function parseCommercialV15<C extends V15Collection>(
  collection: C,
  input: unknown,
): z.infer<(typeof V15_SCHEMAS)[C]> {
  const row = V15_SCHEMAS[collection].parse(input);
  const lists = [
    ...("transactions" in row ? [row.transactions] : []),
    ...("realisedTransactions" in row && row.realisedTransactions
      ? [row.realisedTransactions]
      : []),
    ...("commercial" in row && row.commercial
      ? Object.values(row.commercial)
      : []),
  ];
  for (const refs of lists) {
    const identities = refs.map((ref) => ref.collection + ":" + ref.id);
    if (new Set(identities).size !== identities.length)
      throw new Error("Duplicate commercial fact reference");
  }
  if (row.createdAt.getTime() !== row.updatedAt.getTime())
    throw new Error("Immutable commercial history required");
  if (
    "currency" in row &&
    !Intl.supportedValuesOf("currency").includes(row.currency)
  )
    throw new Error("Unsupported currency");
  if ("provenance" in row && row.provenance.confirmedAt > row.createdAt)
    throw new Error("Future confirmation");
  if ("effectiveAt" in row && row.effectiveAt > row.createdAt)
    throw new Error("Future commercial state");
  if ("supersedes" in row && row.supersedes?.id === row.id)
    throw new Error("Self supersession");
  if ("type" in row) {
    if (row.transactedAt > row.provenance.confirmedAt)
      throw new Error("Confirmation predates transaction");
    if ((row.commercialKind === "recurring") !== Boolean(row.subscription))
      throw new Error(
        "Recurring transaction requires exact commitment; one-off cannot assert one",
      );
    if (
      !["purchase", "renewal"].includes(row.type) !==
      Boolean(row.originalTransaction)
    )
      throw new Error(
        "Correction/refund/reversal/cancellation requires original transaction only",
      );
    if (row.originalTransaction?.id === row.id)
      throw new Error("Self correction");
  }
  if (collection === "product_relationships") {
    const relationship = CommercialRelationshipV15Schema.parse(row);
    if (
      ["customer", "former_customer"].includes(relationship.status) &&
      !relationship.transactions.length
    )
      throw new Error("Customer history requires commercial facts");
  }
  if (collection === "relationship_value_assessments") {
    const { realisedTransactions, ...old } =
      RelationshipValueV15Schema.parse(row);
    parseV14(collection, old);
    if (
      realisedTransactions &&
      (old.subject.kind !== "organisation" || !old.offerings.length)
    )
      throw new Error(
        "Realised value requires Organisation and exact Offering scope",
      );
  }
  if (collection === "reasoning_contexts") {
    const old = ReasoningContextV15Schema.parse(row);
    delete old.commercial;
    parseV14(collection, old);
  }
  return row as z.infer<(typeof V15_SCHEMAS)[C]>;
}
/** Event payload remains the existing contract; only an exact fact reference is added. */
export function parseCommercialEventV15(input: unknown) {
  const envelope = z
    .object({
      record: z.unknown(),
      commercialTransaction: TransactionReferenceV15,
    })
    .strict()
    .parse(input);
  const record = EventSchema.parse(envelope.record);
  if (!record.workspaceId) throw new Error("Workspace required");
  return { ...record, commercialTransaction: envelope.commercialTransaction };
}
