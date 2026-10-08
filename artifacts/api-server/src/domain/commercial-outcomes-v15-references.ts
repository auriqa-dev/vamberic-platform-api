import type { Document } from "mongodb";
import { isDeepStrictEqual } from "node:util";
import { checkV14References } from "./identity-value-v14-references";
import {
  reasoningEvidenceDigest,
  type FoundationReferenceResolver,
} from "./reasoning-reference-check";
import {
  parseCommercialV15,
  parseCommercialEventV15,
  type V15Collection,
  type CommercialTransactionV15,
  type CommercialSubscriptionV15,
} from "./commercial-outcomes-v15";

/** Future server adapter must bind the exact assertion to independently authenticated commercial evidence.
 * A source label, Event, click, or caller-supplied boolean is not such a proof. No implementation is supplied here.
 */
export type CommercialConfirmationVerifier = (
  collection: "transactions" | "subscriptions",
  assertion: CommercialTransactionV15 | CommercialSubscriptionV15,
) => Promise<boolean>;
const clean = (row: Document): Document =>
  Object.fromEntries(Object.entries(row).filter(([key]) => key !== "_id"));

/** Pure bounded reference admission; no persistence or authority grant. Resolver must return admitted canonical records. */
export async function checkCommercialV15References(
  collection: V15Collection,
  input: unknown,
  workspaceId: string,
  resolve: FoundationReferenceResolver,
  verifyConfirmation?: CommercialConfirmationVerifier,
) {
  const root = parseCommercialV15(collection, input);
  if (root.workspaceId !== workspaceId) throw new Error("Workspace mismatch");
  let remaining = 200;
  const get = async (name: string, id: string, at: Date) => {
    if (--remaining < 0)
      throw new Error("Commercial reference budget exceeded");
    const row = await resolve(name, id, workspaceId);
    if (
      !row ||
      row.id !== id ||
      row.workspaceId !== workspaceId ||
      !(row.createdAt instanceof Date) ||
      row.createdAt > at
    )
      throw new Error("Unavailable workspace/time reference");
    return clean(row);
  };
  const exact = async (ref: Document, at: Date) => {
    const row = await get(ref.collection, ref.id, at);
    if (reasoningEvidenceDigest(row) !== ref.digest)
      throw new Error("Exact commercial digest mismatch");
    return row;
  };
  const sameScope = (a: Document, b: Document) => {
    if (
      a.organisationId !== b.organisationId ||
      a.offering.entityId !== b.offering.entityId
    )
      throw new Error("Commercial Organisation/Offering mismatch");
  };
  const seen = new Set<string>();
  async function validate(
    name: V15Collection,
    value: Document,
    depth: number,
  ): Promise<Document> {
    if (depth > 16) throw new Error("Commercial history depth exceeded");
    const row: Document = parseCommercialV15(name, value);
    const key = name + ":" + row.id;
    if (seen.has(key)) return row;
    seen.add(key);
    if (row.organisationId)
      await get("organisations", row.organisationId, row.createdAt);
    if (row.personId) await get("people", row.personId, row.createdAt);
    if (row.offering) {
      const ref = row.offering;
      const offering = await get("offerings", ref.entityId, row.createdAt);
      const rev = await get(
        "hive_definition_revisions",
        ref.snapshotId,
        row.createdAt,
      );
      if (
        offering.id !== ref.entityId ||
        rev.entityId !== ref.entityId ||
        rev.entityType !== "offerings" ||
        rev.revision !== ref.revision ||
        rev.snapshot?.contentHash !== ref.contentHash
      )
        throw new Error("Exact Offering revision mismatch");
    }
    for (const e of row.provenance?.evidence ?? row.evidence ?? []) {
      const target = await get(e.collection, e.id, row.createdAt);
      if (
        reasoningEvidenceDigest(target) !== e.contentHash ||
        (e.evidenceId &&
          !(target.snapshot?.evidence ?? target.evidence)?.some(
            (item: Document) => item.id === e.evidenceId,
          ))
      )
        throw new Error("Exact commercial evidence mismatch");
    }
    async function linked(ref: Document) {
      return validate(
        ref.collection,
        await exact(ref, row.createdAt),
        depth + 1,
      );
    }
    if (row.supersedes) {
      const old = await linked(row.supersedes);
      sameScope(row, old);
      if (old.createdAt >= row.createdAt || old.effectiveAt > row.effectiveAt)
        throw new Error("History must advance without rewriting prior state");
      if (
        name === "subscriptions" &&
        ["sourceSystem", "sourceAccount", "externalReference"].some(
          (key) => old.provenance[key] !== row.provenance[key],
        )
      )
        throw new Error("Commitment source identity changed");
    }
    if (row.originalTransaction) {
      const old = await linked(row.originalTransaction);
      sameScope(row, old);
      if (
        old.createdAt >= row.createdAt ||
        old.transactedAt > row.transactedAt ||
        row.currency !== old.currency ||
        !isDeepStrictEqual(row.offering, old.offering)
      )
        throw new Error(
          "Correction must preserve exact original scope/currency and advance history",
        );
    }
    if (row.subscription) {
      const commitment = await linked(row.subscription);
      sameScope(row, commitment);
      if (
        commitment.currency !== row.currency ||
        commitment.effectiveAt > row.transactedAt
      )
        throw new Error("Commitment currency/time mismatch");
      if (
        ["purchase", "renewal"].includes(row.type) &&
        commitment.status !== "active"
      )
        throw new Error(
          "Recurring purchase requires active commitment assertion",
        );
    }
    if (name === "product_relationships") {
      const facts: Document[] = [];
      for (const ref of row.transactions) {
        const fact = await linked(ref);
        sameScope(row, fact);
        if (fact.transactedAt > row.effectiveAt)
          throw new Error("Future relationship transaction");
        facts.push(fact);
      }
      if (
        ["customer", "former_customer"].includes(row.status) &&
        !facts.some((fact) => ["purchase", "renewal"].includes(fact.type))
      )
        throw new Error(
          "Customer assertion requires completed purchase history",
        );
    }
    if (name === "relationship_value_assessments") {
      const { realisedTransactions, ...old } = row;
      await checkV14References(name, old, workspaceId, resolve);
      for (const ref of realisedTransactions ?? []) {
        const fact = await linked(ref);
        if (
          row.subject.organisationId !== fact.organisationId ||
          !row.offerings.some((o: Document) =>
            isDeepStrictEqual(o, fact.offering),
          )
        )
          throw new Error("Realised value scope mismatch");
      }
    }
    if (name === "reasoning_contexts") {
      const { commercial, ...old } = row;
      await checkV14References(name, old, workspaceId, resolve);
      for (const ref of Object.values(commercial ?? {}).flat() as Document[]) {
        const fact = await linked(ref);
        if (
          !row.organisationIds.includes(fact.organisationId) ||
          !row.knowledge.some((o: Document) =>
            isDeepStrictEqual(o, fact.offering),
          )
        )
          throw new Error("Context commercial subject/Offering missing");
      }
    }
    return row;
  }
  await validate(collection, root, 0);
  if (collection === "transactions" || collection === "subscriptions") {
    if (
      !verifyConfirmation ||
      !(await verifyConfirmation(
        collection,
        root as CommercialTransactionV15 | CommercialSubscriptionV15,
      ))
    )
      throw new Error("Independent commercial confirmation required");
  }
  return root;
}

export async function checkCommercialEventV15(
  input: unknown,
  workspaceId: string,
  resolve: FoundationReferenceResolver,
) {
  const event = parseCommercialEventV15(input);
  const ref = event.commercialTransaction;
  const found = await resolve("transactions", ref.id, workspaceId);
  if (
    event.workspaceId !== workspaceId ||
    !found ||
    found.id !== ref.id ||
    found.workspaceId !== workspaceId ||
    reasoningEvidenceDigest(found) !== ref.digest
  )
    throw new Error("Unavailable exact commercial fact");
  const fact = parseCommercialV15("transactions", clean(found));
  if (
    fact.createdAt > event.createdAt ||
    fact.transactedAt.getTime() !== event.occurredAt.getTime() ||
    event.organisationId !== fact.organisationId ||
    (event.personId && event.personId !== fact.personId) ||
    event.personIds?.some((p) => p !== fact.personId)
  )
    throw new Error("Event/fact identity or time mismatch");
  return event;
}
