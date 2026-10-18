import {
  readContactContext,
  contactActionRestriction,
} from "../contact-context";
import type { ClientSession, Db } from "mongodb";
import {
  EventSchema,
  generatePlatformId,
  partnerHumanSchema,
} from "../../domain";
import { ContactStrategyPolicyV14Schema } from "../../domain/identity-value-v14";
import { withoutMongoId } from "../hvm-context";
import { evaluateContactStrategies, type PolicyContext } from "./evaluate";

/** Internal NBA integration boundary. The caller must authorise the workspace,
 * resolve fresh subject/product/channel evidence and hold the workspace lock in
 * this transaction. Never expose caller-supplied assessments over public HTTP.
 * This records a decision trace, not an execution grant. */
export async function recordContactStrategyAssessment(
  db: Db,
  session: ClientSession,
  context: PolicyContext & { target: NonNullable<PolicyContext["target"]> },
  actor: unknown,
) {
  const human = partnerHumanSchema.parse(actor);
  const rows = await db
    .collection("contact_strategy_policies")
    .find({ workspaceId: context.workspaceId }, { session })
    .toArray();
  const policies = rows.map((p) =>
    ContactStrategyPolicyV14Schema.parse(withoutMongoId(p)),
  );
  const approvals = await db
    .collection("events")
    .find(
      {
        workspaceId: context.workspaceId,
        eventType: "contact_strategy_changed",
        "payload.operation": "approve",
      },
      { session },
    )
    .toArray();
  const assessed = { ...context, assessments: { ...context.assessments } };
  // A generic recorded policy is not proof of human approval.
  for (const policy of policies) {
    if (
      !approvals.some(
        (e) =>
          e.payload.policyId === policy.id &&
          e.payload.version === policy.version,
      )
    )
      delete assessed.assessments[policy.id];
  }
  const result = evaluateContactStrategies(policies, assessed);
  const contactEvidence = [];
  for (const id of [
    ...new Set(
      [context.target.personId, context.target.organisationId].filter(
        (id): id is string => !!id,
      ),
    ),
  ]) {
    const current = await readContactContext(
      db,
      context.workspaceId,
      id,
      session,
    );
    const restriction = contactActionRestriction(
      current,
      context.target.intent === "acquisition"
        ? "acquisition"
        : context.target.purpose,
      context.target.personId === id
        ? context.target.contactPointId
        : undefined,
      context.target.productId,
    );
    if (
      context.target.channel === "email" &&
      context.target.personId === id &&
      !context.target.contactPointId
    ) {
      restriction.reasons.push(
        "Select a current email address before assessing outreach",
      );
      restriction.decision = "deferred";
    }
    contactEvidence.push({
      subjectId: id,
      revision: current.revision,
      lifecycle: current.lifecycle,
      reasons: restriction.reasons,
    });
    if (restriction.decision === "deferred" && result.effect === "permitted")
      result.effect = "deferred";
  }
  const event = EventSchema.parse({
    id: generatePlatformId("event"),
    workspaceId: context.workspaceId,
    eventType: "contact_strategy_assessed",
    occurredAt: context.evaluatedAt,
    createdAt: context.evaluatedAt,
    updatedAt: context.evaluatedAt,
    createdBy: human,
    updatedBy: human,
    source: { system: "contact_strategy" },
    payload: {
      ...result,
      contactEvidence,
      evaluatedAt: context.evaluatedAt.toISOString(),
    },
  });
  await db.collection("events").insertOne(event, { session });
  return { eventId: event.id, ...result, contactEvidence };
}
