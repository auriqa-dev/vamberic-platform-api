import { z } from "zod";
import { verifyProductSupport } from "./product-service-understanding/support";
import type { ClientSession, Db, Document } from "mongodb";
import type {
  Proposal,
  EvidenceObservation,
} from "@workspace/agent-runtime-protocol";
import type { AppConfig } from "../config";
import type { AuthenticatedUser } from "../middlewares/auth";
import type { MongoService } from "./mongo";
import type { AgentControlPlane } from "../routes/agent-control-plane";
import {
  AgentResultSchema,
  AgentRunSchema,
} from "../domain/agent-control-plane";
import { EventSchema, generatePlatformId } from "../domain/schemas";
import {
  HIVE_CONTENT_SCHEMAS,
  HIVE_KINDS,
  HiveEvidenceInputSchema,
  type HiveKind,
} from "../domain/hive-definitions";
import {
  AuthorizationDenied,
  type ResourceType,
} from "../authorization/policy";
import { resolveHvmContext, withoutMongoId } from "./hvm-context";
import {
  requireAgentControlPlane,
  readOperatingTarget,
  AgentControlPlaneUnavailable,
} from "./agent-operators";
import { AgentRunConflict } from "./agent-control-plane";
import { serializeAgentAuthority } from "./agent-authority-serialization";
import { assertProposalFresh } from "./agent-proposal-freshness";
import { mutateHiveDefinition } from "./hive-definitions";

const ReviewRequest = z
  .object({
    resultId: z.string().min(1).max(100),
    proposalId: z.string().min(1).max(100),
    expectedUpdatedAt: z.string().datetime(),
    evidenceIds: z.array(z.string().min(1).max(100)).max(20).default([]),
    reason: z.string().min(1).max(500).optional(),
  })
  .strict();
export interface AgentProposalHandler {
  resource: ResourceType;
  /** Canonical domain service only; returned identity is linked after success. */
  apply(context: {
    mongo: MongoService;
    config: AppConfig;
    identity: AuthenticatedUser;
    workspaceId: string;
    proposal: Proposal;
    evidence: EvidenceObservation[];
    runId: string;
    resultId: string;
  }): Promise<Document>;
}
/** Generic existing Hive draft operations, not an Agent implementation or a
 * Product/Service-specific output contract. Registered server-side only. */
export function hiveDraftProposalHandler(kind: HiveKind): AgentProposalHandler {
  return {
    resource: kind,
    async apply(c) {
      const definition = HIVE_CONTENT_SCHEMAS[kind].parse(c.proposal.candidate);
      const target = c.proposal.target;
      if (target.kind === "update" && target.reference.resourceType !== kind)
        throw new AuthorizationDenied();
      const parents: Record<string, string> = {};
      if (target.kind === "create") {
        const allowed =
          kind === "offerings"
            ? { brand: "brands" }
            : kind === "ideal_customer_profiles"
              ? { offering: "offerings" }
              : {
                  offering: "offerings",
                  ideal_customer_profile: "ideal_customer_profiles",
                };
        for (const parent of target.parents) {
          if (
            !(parent.relationship in allowed) ||
            allowed[parent.relationship as keyof typeof allowed] !==
              parent.reference.resourceType ||
            parents[parent.relationship]
          )
            throw new AuthorizationDenied();
          parents[parent.relationship] = parent.reference.id;
        }
      }
      let row = await mutateHiveDefinition(
        c.mongo,
        c.config,
        c.identity,
        c.workspaceId,
        kind,
        target.kind === "update" ? "update" : "create",
        target.kind === "update"
          ? {
              id: target.reference.id,
              expectedUpdatedAt: target.expectedUpdatedAt,
              definition,
            }
          : {
              definition,
              ...(parents.brand ? { brandId: parents.brand } : {}),
              ...(parents.offering ? { offeringId: parents.offering } : {}),
              ...(parents.ideal_customer_profile
                ? { idealCustomerProfileId: parents.ideal_customer_profile }
                : {}),
            },
      );
      for (const evidence of c.evidence) {
        const candidate = z
          .object({
            field: z.string(),
            value: z.union([
              z.string(),
              z.number().finite(),
              z.boolean(),
              z.array(z.string()),
            ]),
          })
          .strict()
          .parse(evidence.candidate);
        const mapped = HiveEvidenceInputSchema.parse({
          ...candidate,
          origin: evidence.origin,
          provider: evidence.provenance.provider,
          sourceReference: `${c.runId}/${c.resultId}/${evidence.id}`,
          observedAt: evidence.observedAt,
          verification: "observed",
          ...(evidence.confidence === undefined
            ? {}
            : { confidence: evidence.confidence }),
        });
        row = await mutateHiveDefinition(
          c.mongo,
          c.config,
          c.identity,
          c.workspaceId,
          kind,
          "observe",
          {
            id: row.id,
            expectedUpdatedAt: row.updatedAt.toISOString(),
            evidence: mapped,
          },
        );
      }
      return row;
    },
  };
}
export function createAgentProposalReview(
  config: AppConfig,
  mongo: MongoService,
  control: AgentControlPlane,
  handlers: ReadonlyMap<string, AgentProposalHandler> = new Map(
    HIVE_KINDS.map((kind) => [kind, hiveDraftProposalHandler(kind)]),
  ),
  clock: () => Date = () => new Date(),
  effectivenessEligible?: (
    db: Db,
    run: import("../domain/agent-control-plane").AgentRun,
    proposalId: string,
    session: ClientSession,
  ) => Promise<boolean>,
) {
  const registered = new Map(handlers);
  async function review(
    identity: AuthenticatedUser,
    runId: string,
    input: unknown,
    apply: boolean,
  ) {
    const body = ReviewRequest.parse(input);
    if (new Set(body.evidenceIds).size !== body.evidenceIds.length)
      throw new AgentRunConflict("Duplicate evidence selection");
    if (!mongo.withTransaction)
      throw new AgentControlPlaneUnavailable("Transactions required");
    // Visibility checked again transactionally below; use the public safe service
    // contract here, never infer Result access from target edit privileges.
    await control.read(identity, runId);
    return mongo.withTransaction(async (db: Db, session: ClientSession) => {
      await requireAgentControlPlane(db, session);
      const raw = await db
        .collection("agent_runs")
        .findOne({ id: runId }, { session });
      if (!raw) throw new AuthorizationDenied();
      const run = AgentRunSchema.parse(withoutMongoId(raw));
      const resolved = await resolveHvmContext(db, config, identity, session);
      const authority = resolved.authority.authorizeAgentOperation(
        resolved.context,
        {
          workspaceId: run.workspaceId,
          target: run.target,
          operation: run.operation,
          action: "read",
          requester: run.requester,
          ...(run.authority.basis === "client"
            ? {
                membershipId: run.authority.membershipId,
                grantId: run.authority.grantId,
              }
            : {}),
        },
        clock(),
      );
      if (!authority) throw new AuthorizationDenied();
      if (authority.basis === "client")
        await readOperatingTarget(db, run.workspaceId, run.target, session);
      const row = await db
        .collection("agent_results")
        .findOne(
          { id: body.resultId, runId, workspaceId: run.workspaceId },
          { session },
        );
      if (!row) throw new AuthorizationDenied();
      const result = AgentResultSchema.parse(withoutMongoId(row));
      const proposal = result.envelope.outcome.content.proposals.find(
        (p) => p.id === body.proposalId,
      );
      const disposition = result.dispositions.find(
        (d) => d.proposalId === body.proposalId,
      );
      if (!proposal || !disposition) throw new AuthorizationDenied();
      const handler = registered.get(proposal.targetKind);
      if (apply) {
        if (!handler)
          throw new AgentRunConflict("No reviewed proposal handler");
        resolved.authority.scopeFilter(
          resolved.context,
          proposal.target.kind === "create" ? "create" : "update",
          { type: handler.resource, workspaceId: run.workspaceId },
        );
      } else
        resolved.authority.scopeFilter(resolved.context, "update", {
          type: "agent_runs",
          workspaceId: run.workspaceId,
        });
      await serializeAgentAuthority(
        db,
        { ...run, requester: resolved.response.human, authority },
        session,
        [],
        authority.basis === "client",
      );
      if (disposition.status === (apply ? "applied_to_draft" : "rejected"))
        return { ...disposition };
      if (
        disposition.status !== "pending" ||
        result.updatedAt.toISOString() !== body.expectedUpdatedAt
      )
        throw new AgentRunConflict("Proposal review changed");
      const expected = result.updatedAt;
      let target: Document | undefined;
      if (apply) {
        if (
          run.effectiveness &&
          (!effectivenessEligible ||
            !(await effectivenessEligible(db, run, proposal.id, session)))
        )
          throw new AuthorizationDenied();
        await assertProposalFresh(
          db,
          run.workspaceId,
          proposal,
          result.envelope.outcome.content.lineage,
          session,
        );
        if (body.evidenceIds.some((id) => !proposal.evidenceIds.includes(id)))
          throw new AuthorizationDenied();
        if (
          run.manifest.implementation.key === "product_service_understanding"
        ) {
          if (!run.effectiveness) throw new AuthorizationDenied();
          await verifyProductSupport(db, run, result.envelope, session);
          if (
            proposal.id !== "offering_understanding" ||
            proposal.evidenceIds.some((id) => !body.evidenceIds.includes(id))
          )
            throw new AuthorizationDenied();
        }
        const nested: MongoService = {
          ...mongo,
          withTransaction: async (work) => work(db, session),
        };
        target = await handler!.apply({
          mongo: nested,
          config,
          identity,
          workspaceId: run.workspaceId,
          proposal,
          evidence: result.envelope.outcome.content.evidence.filter((e) =>
            body.evidenceIds.includes(e.id),
          ),
          runId,
          resultId: result.id,
        });
        if (target.workspaceId !== run.workspaceId || target.status !== "draft")
          throw new AgentRunConflict(
            "Canonical handler did not produce scoped draft",
          );
      }
      const now = new Date(
        Math.max(
          clock().getTime(),
          expected.getTime() + 1,
          target?.updatedAt?.getTime() ?? 0,
        ),
      );
      Object.assign(disposition, {
        status: apply ? "applied_to_draft" : "rejected",
        actor: resolved.response.human,
        at: now,
        ...(body.reason ? { reason: body.reason } : {}),
        ...(target
          ? {
              target: {
                resource: handler!.resource,
                id: target.id,
                updatedAt: target.updatedAt,
                ...(target.revision ? { revision: target.revision } : {}),
                ...(target.contentHash
                  ? { contentHash: target.contentHash }
                  : {}),
              },
            }
          : {}),
      });
      result.updatedAt = now;
      const checked = AgentResultSchema.parse(result);
      const changed = await db
        .collection("agent_results")
        .updateOne(
          { id: result.id, workspaceId: run.workspaceId, updatedAt: expected },
          { $set: { dispositions: checked.dispositions, updatedAt: now } },
          { session },
        );
      if (!changed.matchedCount) throw new AgentRunConflict("Result changed");
      await db.collection("events").insertOne(
        EventSchema.parse({
          id: generatePlatformId("event"),
          workspaceId: run.workspaceId,
          createdAt: now,
          updatedAt: now,
          occurredAt: now,
          eventType: "agent_proposal_reviewed",
          payload: {
            actor: resolved.response.human,
            runId,
            resultId: result.id,
            proposalId: proposal.id,
            action: apply ? "apply_to_draft" : "reject",
          },
        }),
        { session },
      );
      return { ...disposition };
    });
  }
  return {
    apply: (identity: AuthenticatedUser, runId: string, input: unknown) =>
      review(identity, runId, input, true),
    reject: (identity: AuthenticatedUser, runId: string, input: unknown) =>
      review(identity, runId, input, false),
  };
}
