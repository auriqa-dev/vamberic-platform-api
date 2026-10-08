import { z } from "zod";
import { platformIdSchema } from "./schemas";
import { EvidenceReference } from "./reasoning-foundation";
import { StateReferenceV14 } from "./identity-value-v14";
import { reasoningEvidenceDigest } from "./reasoning-reference-check";

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const context = z
  .object({ id: platformIdSchema("reasoningcontext"), digest: hash })
  .strict();
const decision = z
  .object({ id: platformIdSchema("reasoningdecision"), digest: hash })
  .strict();
const event = EvidenceReference.extend({
  collection: z.literal("events"),
  id: platformIdSchema("event"),
}).strict();
/** Describes an explicitly supplied scope; never computes or authenticates a session. */
export const ObservationScopeV1Schema = z
  .object({
    workspaceId: platformIdSchema("workspace"),
    correlationKey: z.string().min(1).max(100),
    identity: StateReferenceV14.extend({
      collection: z.literal("interaction_identities"),
      id: platformIdSchema("interactionidentity"),
    }).strict(),
    context,
  })
  .strict();
/** Reference-only input slice. The bound reuses v13's 100-reference envelope.
 * No browser payload, Person inference, consent assertion, readiness or authority.
 * An adapter must independently admit every reference and its permitted use.
 */
export const ObservationEvidenceSliceV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    scope: ObservationScopeV1Schema,
    events: z.array(event).max(100),
  })
  .strict()
  .superRefine((v, c) => {
    if (new Set(v.events.map((e) => e.id)).size !== v.events.length)
      c.addIssue({ code: "custom", message: "Duplicate event reference" });
  });
export type ObservationEvidenceSliceV1 = z.infer<
  typeof ObservationEvidenceSliceV1Schema
>;
/** Exact input order is retained and hashed; it is not a claim of event-time order. */
export const observationSliceDigest = (input: unknown) =>
  reasoningEvidenceDigest(ObservationEvidenceSliceV1Schema.parse(input));

/** Bounded accumulation of caller-admitted references only. No timer or lifecycle.
 * Exact retries are idempotent; changed hashes/embedded selectors fail closed.
 * Callers cannot merge different correlation/context/identity/workspace scopes.
 */
export function appendObservationEvidence(current: unknown, incoming: unknown) {
  const a = ObservationEvidenceSliceV1Schema.parse(current);
  const b = ObservationEvidenceSliceV1Schema.parse(incoming);
  if (reasoningEvidenceDigest(a.scope) !== reasoningEvidenceDigest(b.scope))
    throw new Error("Observation scope mismatch");
  const events = new Map(a.events.map((e) => [e.id, e]));
  for (const item of b.events) {
    const existing = events.get(item.id);
    if (
      existing &&
      reasoningEvidenceDigest(existing) !== reasoningEvidenceDigest(item)
    )
      throw new Error("Conflicting event reference");
    if (!existing) events.set(item.id, item);
  }
  return ObservationEvidenceSliceV1Schema.parse({
    schemaVersion: 1,
    scope: a.scope,
    events: [...events.values()],
  });
}

/** Describes which exact slice a canonical Decision claims to have considered.
 * Parsing/matching is not proof that a Decision exists or evaluation happened.
 */
export const ObservationEvaluationLinkV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    scope: ObservationScopeV1Schema,
    sliceDigest: hash,
    decision,
  })
  .strict();
/** Reference seam for future cooldown policy. It deliberately supplies neither
 * start/end times nor active/expired status, and cannot prove Action completion.
 */
export const ObservationActionLinkV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    evaluation: ObservationEvaluationLinkV1Schema,
    action: StateReferenceV14.extend({
      collection: z.literal("crm_tasks"),
      id: platformIdSchema("task"),
    }).strict(),
    actionEvidence: event,
  })
  .strict();
export function matchObservationEvaluation(slice: unknown, link: unknown) {
  const value = ObservationEvidenceSliceV1Schema.parse(slice);
  const evaluation = ObservationEvaluationLinkV1Schema.parse(link);
  if (
    reasoningEvidenceDigest(value.scope) !==
      reasoningEvidenceDigest(evaluation.scope) ||
    observationSliceDigest(value) !== evaluation.sliceDigest
  )
    throw new Error("Observation evaluation boundary mismatch");
  return evaluation;
}
