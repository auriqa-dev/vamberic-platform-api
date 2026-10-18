import { interactionRegistration } from "./interaction/registration";
import { nbaRegistration } from "./nba/registration";
import { persistMethodologyDefinition } from "./methodology-catalogue";
import { agentDefinitionRemovalReview } from "./agent-definition-removal";
import { effectiveWorkspaceBilling } from "../domain/workspace-billing";
import { z } from "zod";
import { isDeepStrictEqual } from "node:util";
import {
  ApprovalQuery,
  ApprovalRequest,
  ApprovalReview,
  ApprovalPage,
  ApprovalSuccess,
} from "./agreement-approval-contract";
import type { Db, Document, ClientSession } from "mongodb";
import type { AppConfig } from "../config";
import type { AuthenticatedUser } from "../middlewares/auth";
import type { MongoService } from "./mongo";
import { resolveHvmContext, withoutMongoId } from "./hvm-context";
import { AuthorizationDenied, type Action } from "../authorization/policy";
import {
  generatePlatformId,
  platformIdSchema,
  EventSchema,
} from "../domain/schemas";
import { partnerHumanSchema } from "../domain/partners";
import { getOfferMethodology } from "../domain/offer-methodologies";
import {
  OperatingSchemas,
  OperatingDataSchemas,
  OPERATING_PREFIXES,
  PLATFORM_OPERATING_RESOURCES,
  RecommendationInput,
  DecisionInput,
  type OperatingResource,
} from "../domain/operating";
import {
  configurationIssues,
  evaluateSwarmReadiness,
  evaluateCommercialDecision,
} from "../domain/operating-logic";
export class OperatingConflict extends Error {}
const platform = (r: OperatingResource | "agreement_approvals") =>
  r === "agreement_approvals" ||
  (PLATFORM_OPERATING_RESOURCES as readonly string[]).includes(r);
const clean = (v: unknown): unknown =>
  v instanceof Date
    ? v
    : Array.isArray(v)
      ? v.map(clean)
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.entries(v)
              .filter(([, v]) => v !== undefined)
              .map(([k, v]) => [k, clean(v)]),
          )
        : v;
async function access(
  db: Db,
  config: AppConfig,
  identity: AuthenticatedUser,
  r: OperatingResource | "agreement_approvals",
  action: Action,
  workspaceId?: string,
  session?: ClientSession,
) {
  const resolved = await resolveHvmContext(db, config, identity, session);
  if (
    resolved.context.actor.type !== "human" ||
    resolved.context.application !== "hvmapp"
  )
    throw new AuthorizationDenied();
  if (platform(r) !== !workspaceId) throw new AuthorizationDenied();
  if (workspaceId) platformIdSchema("workspace").parse(workspaceId);
  resolved.authority.scopeFilter(resolved.context, action, {
    type: r,
    workspaceId,
  });
  const ledger = await db
    .collection("schema_versions")
    .findOne({ _id: "vapp-v1" } as Document, { session });
  if (
    ![
      9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27,
      28, 29, 30,
    ].includes(ledger?.version)
  )
    throw new Error("Operating foundation requires schema v9 or v10");
  const empress = resolved.authority.authorize(resolved.context, "manage", {
    type: "agent_definitions",
  });
  return {
    ...resolved,
    empress,
    actor: partnerHumanSchema.parse(resolved.context.actor),
  };
}
async function definition(
  db: Db,
  resource: OperatingResource,
  reference: Document,
  session?: ClientSession,
  lock = false,
) {
  const row = await db
    .collection(resource)
    .findOne({ id: reference.id, version: reference.version }, { session });
  if (!row) throw new OperatingConflict("Definition unavailable");
  const parsed = OperatingSchemas[resource].parse(
    withoutMongoId(row),
  ) as Document;
  if (lock)
    await db
      .collection(resource)
      .updateOne(
        { id: row.id },
        { $inc: { referenceVersion: 1 } },
        { session },
      );
  return parsed;
}
function usable(row: Document, empress: boolean) {
  if (
    row.status !== "active" ||
    row.archived ||
    (row.availability !== "queens" && !empress)
  )
    throw new OperatingConflict(
      "Definition not available for new configuration",
    );
}
async function scoped(
  db: Db,
  r: string,
  id: string,
  workspaceId: string,
  session?: ClientSession,
) {
  const row = await db
    .collection(r)
    .findOne({ id, workspaceId, archived: { $ne: true } }, { session });
  if (!row) throw new AuthorizationDenied();
  return withoutMongoId(row);
}
async function model(
  db: Db,
  swarm: Document,
  empress: boolean,
  session?: ClientSession,
  lock = false,
) {
  const agents: Document[] = [],
    definitions: Document[] = [],
    providers: Document[] = [],
    integrations: Document[] = [],
    capabilityInstances: Document[] = [];
  for (const id of swarm.data.agentInstanceIds) {
    const a = await scoped(db, "client_agents", id, swarm.workspaceId, session);
    agents.push(a);
    definitions.push(
      await definition(
        db,
        "agent_definitions",
        a.data.definition,
        session,
        lock,
      ),
    );
    for (const b of a.data.bindings) {
      providers.push(
        await definition(
          db,
          "integration_providers",
          b.provider,
          session,
          lock,
        ),
      );
      integrations.push(
        await scoped(
          db,
          "workspace_integrations",
          b.integrationId,
          swarm.workspaceId,
          session,
        ),
      );
    }
    for (const id of a.data.capabilityInstanceIds)
      capabilityInstances.push(
        await scoped(
          db,
          "capability_instances",
          id,
          swarm.workspaceId,
          session,
        ),
      );
  }
  const template = swarm.data.template
    ? await definition(
        db,
        "swarm_templates",
        swarm.data.template,
        session,
        lock,
      )
    : undefined;
  return {
    swarm,
    agents,
    definitions,
    providers,
    integrations,
    capabilityInstances,
    template,
    allowInternal: empress,
  };
}
function snapshot(m: Awaited<ReturnType<typeof model>>) {
  return {
    swarmId: m.swarm.id,
    swarmRevision: m.swarm.revision,
    swarm: m.swarm.data,
    agents: m.agents.map((a) => ({
      id: a.id,
      revision: a.revision,
      configuration: a.data,
      definition: m.definitions.find((d) => d.id === a.data.definition.id)!
        .data,
      bindings: a.data.bindings.map((b: Document) => {
        const p = m.providers.find((p) => p.id === b.provider.id)!;
        return {
          integrationId: b.integrationId,
          providerKey: p.key,
          provider: p.data,
        };
      }),
    })),
    ...(m.template ? { template: m.template.data } : {}),
  };
}
const pendingApproval = {
  status: "proposed",
  archived: false,
  "data.policyResult": "requires_empress_approval",
};
function reviewable(row: Document): Document {
  const parsed = OperatingSchemas.swarm_agreements.parse(
    withoutMongoId(row),
  ) as Document;
  if (
    parsed.archived ||
    parsed.status !== "proposed" ||
    parsed.data.policyResult !== "requires_empress_approval" ||
    parsed.data.empressApproval
  )
    throw new AuthorizationDenied();
  const d = parsed.data;
  // Revalidate the stored decision against its frozen recommendation/policy,
  // never against current catalogue values or a newly calculated price.
  const expected = evaluateCommercialDecision(
    d.decision,
    d.recommendationSnapshot,
  );
  if (
    expected.policyResult !== "requires_empress_approval" ||
    d.swarmId !== d.recommendationSnapshot.swarmId ||
    d.swarmId !== d.recommendationSnapshot.configurationSnapshot.swarmId ||
    Object.entries(expected).some(([k, v]) => !isDeepStrictEqual(d[k], v))
  )
    throw new OperatingConflict("Commercial snapshot inconsistent");
  return parsed;
}
function approvalProjection(row: Document) {
  const d = row.data,
    r = d.recommendationSnapshot,
    p = r.policySnapshot;
  const {
    treatment,
    adjustment,
    reason,
    onboardingMinor,
    commitment,
    billingFrequency,
    effectiveFrom,
    effectiveUntil,
  } = d.decision;
  return ApprovalReview.parse({
    id: row.id,
    status: row.status,
    updatedAt: row.updatedAt.toISOString(),
    workspaceId: row.workspaceId,
    swarm: {
      id: d.swarmId,
      name: r.configurationSnapshot.swarm.name,
      revision: r.configurationSnapshot.swarmRevision,
    },
    recommendation: {
      id: d.decision.recommendationId,
      currency: r.currency,
      expectedOperatingMonthlyMinor: r.expectedOperatingMonthlyMinor,
      recommendedOnboardingMinor: r.recommendedOnboardingMinor,
      recommendedMonthlyMinor: r.recommendedMonthlyMinor,
      recommendedAnnualMinor: r.recommendedAnnualMinor,
      monthlyMargin: r.monthlyMargin,
    },
    decision: {
      treatment,
      adjustment,
      reason,
      onboardingMinor,
      commitment,
      billingFrequency,
      effectiveFrom,
      ...(effectiveUntil ? { effectiveUntil } : {}),
    },
    recommendedPeriodMinor: d.recommendedPeriodMinor,
    finalRecurringMinor: d.finalRecurringMinor,
    finalMonthlyEquivalentMinor: d.finalMonthlyEquivalentMinor,
    policy: {
      ...r.policy,
      result: d.policyResult,
      reasons: d.policyReasons,
      limits: {
        minimumMargin: p.minimumMargin,
        maximumQueenDiscount: p.maximumQueenDiscount,
        maximumQueenFixedDiscountMinor: p.maximumQueenFixedDiscountMinor,
        minimumMonthlyPriceMinor: p.minimumMonthlyPriceMinor,
        allowCustomPrice: p.allowCustomPrice,
        permittedQueenTreatments: p.permittedQueenTreatments,
      },
    },
  });
}
export async function readAgreementApprovals(
  mongo: MongoService,
  config: AppConfig,
  identity: AuthenticatedUser,
  query: unknown,
  id?: string,
) {
  const db = await mongo.database();
  await access(db, config, identity, "agreement_approvals", "read");
  if (id !== undefined) {
    z.object({}).strict().parse(query);
    platformIdSchema("swarmagreement").parse(id);
    const row = await db
      .collection("swarm_agreements")
      .findOne({ id, ...pendingApproval });
    if (!row) throw new AuthorizationDenied();
    return approvalProjection(reviewable(row));
  }
  const q = ApprovalQuery.parse(query);
  // Existing unique `id` index supplies deterministic ordered traversal. A
  // timeout bounds work until scale justifies a pending-state compound index.
  const rows = await db
    .collection("swarm_agreements")
    .find(pendingApproval, { hint: "id_unique", maxTimeMS: 3000 })
    .sort({ id: 1 })
    .skip(q.offset)
    .limit(q.limit + 1)
    .toArray();
  return ApprovalPage.parse({
    items: rows.slice(0, q.limit).map((r) => approvalProjection(reviewable(r))),
    hasMore: rows.length > q.limit,
    ...q,
  });
}
export async function readOperating(
  mongo: MongoService,
  config: AppConfig,
  identity: AuthenticatedUser,
  r: OperatingResource,
  query: unknown,
  workspaceId?: string,
  id?: string,
  readiness = false,
) {
  const q = z
    .object({
      limit: z.coerce.number().int().min(1).max(100).default(20),
      offset: z.coerce.number().int().min(0).max(10000).default(0),
      key: z.string().optional(),
      archived: z.enum(["active", "archived"]).optional(),
      swarmId: platformIdSchema("clientswarm").optional(),
      agentDefinitionId: platformIdSchema("agentdefinition").optional(),
      integrationId: platformIdSchema("integration").optional(),
      agentInstanceId: platformIdSchema("clientagent").optional(),
    })
    .strict()
    .parse(query);
  const db = await mongo.database();
  const a = await access(db, config, identity, r, "read", workspaceId);
  if (id) {
    platformIdSchema(OPERATING_PREFIXES[r]).parse(id);
    const row = await db.collection(r).findOne({
      id,
      ...(workspaceId ? { workspaceId } : { workspaceId: { $exists: false } }),
    });
    if (!row) throw new AuthorizationDenied();
    const parsed = OperatingSchemas[r].parse(withoutMongoId(row));
    if (readiness) {
      if (r !== "client_swarms") throw new AuthorizationDenied();
      return evaluateSwarmReadiness(await model(db, parsed, a.empress));
    }
    return parsed;
  }
  if (
    (q.agentDefinitionId && r !== "client_agents") ||
    (q.integrationId && r !== "client_agents") ||
    (q.agentInstanceId && r !== "client_swarms") ||
    (q.key && !platform(r)) ||
    (q.swarmId && !["pricing_recommendations", "swarm_agreements"].includes(r))
  )
    throw new OperatingConflict("Unsupported filter");
  const rows = await db
    .collection(r)
    .find({
      ...(workspaceId ? { workspaceId } : { workspaceId: { $exists: false } }),
      ...(q.key ? { key: q.key } : {}),
      ...(r === "agent_definitions"
        ? { archived: q.archived === "archived" ? true : { $ne: true } }
        : {}),
      ...(q.swarmId ? { "data.swarmId": q.swarmId } : {}),
      ...(q.agentDefinitionId
        ? { "data.definition.id": q.agentDefinitionId }
        : {}),
      ...(q.integrationId
        ? { "data.bindings.integrationId": q.integrationId }
        : {}),
      ...(q.agentInstanceId
        ? { "data.agentInstanceIds": q.agentInstanceId }
        : {}),
    })
    .sort({ id: 1 })
    .skip(q.offset)
    .limit(q.limit + 1)
    .toArray();
  return {
    items: rows
      .slice(0, q.limit)
      .map((rw) => OperatingSchemas[r].parse(withoutMongoId(rw))),
    hasMore: rows.length > q.limit,
    limit: q.limit,
    offset: q.offset,
  };
}
export async function readQueenCatalogue(
  mongo: MongoService,
  config: AppConfig,
  identity: AuthenticatedUser,
  workspaceId: string,
  r: OperatingResource,
) {
  if (!platform(r)) throw new AuthorizationDenied();
  const db = await mongo.database();
  const a = await access(
    db,
    config,
    identity,
    "client_swarms",
    "read",
    workspaceId,
  );
  const rows = await db
    .collection(r)
    .find({
      status: "active",
      archived: false,
      ...(r === "agent_definitions"
        ? {
            "data.executionImplementation.key": {
              $ne: "product_service_understanding",
            },
          }
        : {}),
      ...(!a.empress ? { availability: "queens" } : {}),
    })
    .limit(101)
    .toArray();
  if (rows.length > 100)
    throw new OperatingConflict(
      "Catalogue exceeds response bound; platform review required",
    );
  return {
    items: rows.map((row) => OperatingSchemas[r].parse(withoutMongoId(row))),
  };
}
async function references(
  db: Db,
  r: OperatingResource,
  data: Document,
  workspaceId: string | undefined,
  empress: boolean,
  session: ClientSession,
) {
  const active = async (kind: OperatingResource, ref: Document) => {
    const row = await definition(db, kind, ref, session, true);
    usable(row, empress);
    return row;
  };
  if (r === "agent_definitions") {
    for (const id of [
      ...data.providesCapabilityIds,
      ...data.requiresCapabilityIds,
    ])
      if (
        !(await db
          .collection("capabilities")
          .findOne({ id, archived: { $ne: true } }, { session }))
      )
        throw new OperatingConflict("Capability unavailable");
    for (const ref of [...data.requiredAgents, ...data.recommendedAgents])
      await active("agent_definitions", ref);
    for (const slot of data.integrationRequirements)
      for (const id of slot.supportedProviderIds) {
        const p = await db
          .collection("integration_providers")
          .findOne({ id, status: "active", archived: false }, { session });
        if (
          !p ||
          !p.data.operationalCapabilities.includes(slot.operationalCapability)
        )
          throw new OperatingConflict("Incompatible slot provider");
      }
  }
  if (r === "swarm_templates")
    for (const ref of [
      ...data.requiredAgents,
      ...data.recommendedAgents,
      ...data.optionalAgents,
    ])
      await active("agent_definitions", ref);
  if (r === "methodology_availability") {
    if (!getOfferMethodology(data.methodology.id, data.methodology.version))
      throw new OperatingConflict("Unknown code-owned methodology");
    for (const ref of data.compatibleAgents)
      await active("agent_definitions", ref);
  }
  if (r === "client_agents") {
    const d = await active("agent_definitions", data.definition);
    const keys = new Set<string>();
    for (const b of data.bindings) {
      const k = b.slot + ":" + b.integrationId;
      if (keys.has(k)) throw new OperatingConflict("Duplicate binding");
      keys.add(k);
      const p = await active("integration_providers", b.provider);
      const slot = d.data.integrationRequirements.find(
        (s: Document) => s.slot === b.slot,
      );
      const conn = await scoped(
        db,
        "workspace_integrations",
        b.integrationId,
        workspaceId!,
        session,
      );
      if (
        !slot ||
        !slot.supportedProviderIds.includes(p.id) ||
        !p.data.operationalCapabilities.includes(slot.operationalCapability) ||
        conn.provider !== p.key
      )
        throw new OperatingConflict("Incompatible integration binding");
    }
    for (const id of data.dependencyInstanceIds)
      await scoped(db, "client_agents", id, workspaceId!, session);
    for (const id of data.capabilityInstanceIds)
      await scoped(db, "capability_instances", id, workspaceId!, session);
  }
  if (r === "client_swarms") {
    if (data.template) await active("swarm_templates", data.template);
    for (const id of data.agentInstanceIds)
      await scoped(db, "client_agents", id, workspaceId!, session);
  }
}
export async function mutateOperating(
  mongo: MongoService,
  config: AppConfig,
  identity: AuthenticatedUser,
  r: OperatingResource,
  operation: string,
  raw: unknown,
  workspaceId?: string,
) {
  if (
    ![
      "create",
      "update",
      "publish",
      "configure",
      "delete",
      "retire",
      "approve",
      "empress-approve",
      "supersede",
    ].includes(operation)
  )
    throw new AuthorizationDenied();
  // Retired Agent setup/commercial contracts remain readable for history.
  // Cleanup of definitions still uses the transactional dependency checks below.
  if (
    [
      "swarm_templates",
      "commercial_policies",
      "client_agents",
      "client_swarms",
      "pricing_recommendations",
      "swarm_agreements",
    ].includes(r) ||
    (r === "agent_definitions" &&
      !["create", "publish", "retire", "delete"].includes(operation))
  )
    throw new AuthorizationDenied();
  if (operation === "delete" && r !== "agent_definitions")
    throw new AuthorizationDenied();
  const exceptional = operation === "empress-approve";
  if (exceptional && r !== "swarm_agreements") throw new AuthorizationDenied();
  const controls = {
    id: platformIdSchema(OPERATING_PREFIXES[r]),
    expectedUpdatedAt: z.string().datetime(),
  };
  const dataSchema =
    r === "pricing_recommendations"
      ? RecommendationInput
      : r === "swarm_agreements"
        ? DecisionInput
        : OperatingDataSchemas[r];
  const body = (
    operation === "create"
      ? z
          .object({
            data: dataSchema,
            ...(platform(r)
              ? {
                  key: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
                  version: z.number().int().positive(),
                  availability: z.enum(["internal", "queens", "experimental"]),
                }
              : {}),
          })
          .strict()
      : operation === "update"
        ? z.object({ ...controls, data: dataSchema }).strict()
        : operation === "empress-approve"
          ? ApprovalRequest.extend({ id: controls.id }).strict()
          : z.object(controls).strict()
  ).parse(raw) as Document;
  if (!mongo.withTransaction) throw new Error("Transactions required");
  return mongo.withTransaction(async (db, session) => {
    const a = await access(
      db,
      config,
      identity,
      exceptional ? "agreement_approvals" : r,
      operation === "create"
        ? "create"
        : operation.includes("approve")
          ? "approve"
          : "update",
      exceptional ? undefined : workspaceId,
      session,
    );
    if (r === "agent_definitions" && body.data?.effectiveness) {
      const ledger = await db
        .collection("schema_versions")
        .findOne({ _id: "vapp-v1" } as Document, { session });
      if (
        ![
          11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27,
          28, 29, 30,
        ].includes(ledger?.version ?? 0)
      )
        throw new Error("Effectiveness metadata requires schema v11");
    }
    if (r === "agent_definitions" && body.data?.executionImplementation) {
      const ledger = await db
        .collection("schema_versions")
        .findOne({ _id: "vapp-v1" } as Document, { session });
      if (
        ![
          10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26,
          27, 28, 29, 30,
        ].includes(ledger?.version ?? 0)
      )
        throw new Error(
          "Execution implementation metadata requires schema v10",
        );
    }
    if (exceptional) {
      const pending = await db.collection(r).findOne(
        {
          id: body.id,
          ...pendingApproval,
          ...(workspaceId ? { workspaceId } : {}),
        },
        { session },
      );
      if (!pending) throw new AuthorizationDenied();
      reviewable(pending);
      workspaceId = pending.workspaceId;
    }
    const now = new Date();
    if (workspaceId) {
      const w = await db
        .collection("crm_workspaces")
        .findOne(
          { id: workspaceId, kind: "client", archived: { $ne: true } },
          { session },
        );
      if (!w) throw new AuthorizationDenied();
      now.setTime(Math.max(now.getTime(), w.updatedAt.getTime() + 1));
      const lock = await db
        .collection("crm_workspaces")
        .updateOne(
          { id: workspaceId, updatedAt: w.updatedAt },
          { $set: { updatedAt: now } },
          { session },
        );
      if (!lock.matchedCount) throw new OperatingConflict("Workspace changed");
    }
    const prev =
      operation === "create"
        ? undefined
        : await db.collection(r).findOne(
            {
              id: body.id,
              ...(workspaceId
                ? { workspaceId }
                : { workspaceId: { $exists: false } }),
            },
            { session },
          );
    if (operation !== "create" && !prev) throw new AuthorizationDenied();
    // Only the reviewed native NBA and client website Interaction definitions can be registered. Retired generic
    // Agent setup/commercial authoring and PSU registration remain unavailable.
    if (
      r === "agent_definitions" &&
      ["create", "publish"].includes(operation)
    ) {
      const candidate = prev ?? body;
      const reviewed =
        candidate.key === "website_interaction"
          ? interactionRegistration(a.actor, now)
          : nbaRegistration(a.actor, now);
      if (
        !a.empress ||
        candidate.key !== reviewed.key ||
        candidate.version !== reviewed.version ||
        candidate.availability !== reviewed.availability ||
        !isDeepStrictEqual(candidate.data, reviewed.data)
      )
        throw new AuthorizationDenied();
    }

    if (
      r === "agent_definitions" &&
      !["retire", "delete"].includes(operation) &&
      (body.key === "product_service_understanding" ||
        prev?.key === "product_service_understanding" ||
        body.data?.executionImplementation?.key ===
          "product_service_understanding" ||
        prev?.data.executionImplementation?.key ===
          "product_service_understanding")
    )
      throw new OperatingConflict(
        "Products and services are managed in the workspace, not the Agent registry",
      );
    if (prev) {
      if (
        prev.updatedAt.toISOString() !== body.expectedUpdatedAt ||
        prev.archived
      )
        throw new OperatingConflict("Record changed or retired");
      now.setTime(Math.max(now.getTime(), prev.updatedAt.getTime() + 1));
    }
    if (r === "agent_definitions" && ["retire", "delete"].includes(operation)) {
      // References and execution admission also write this document: concurrent
      // admissions force a transaction retry rather than a stale dependency scan.
      const previousReferenceVersion = prev!.referenceVersion ?? 0;
      const locked = await db
        .collection(r)
        .updateOne(
          { id: prev!.id, updatedAt: prev!.updatedAt },
          { $inc: { referenceVersion: 1 } },
          { session },
        );
      if (!locked.matchedCount) throw new OperatingConflict("Record changed");
      const review = await agentDefinitionRemovalReview(
        db,
        prev!,
        operation as "delete" | "retire",
        session,
      );
      if (!review.allowed)
        throw new OperatingConflict(review.blockers.join(" "));
      prev!.referenceVersion = previousReferenceVersion + 1;
    }
    let row: Document = prev
      ? { ...withoutMongoId(prev), updatedAt: now, updatedBy: a.actor }
      : {
          id: generatePlatformId(OPERATING_PREFIXES[r]),
          createdAt: now,
          updatedAt: now,
          createdBy: a.actor,
          updatedBy: a.actor,
          schemaVersion: 1,
          archived: false,
          referenceVersion: 0,
          ...(workspaceId
            ? { workspaceId, revision: 1 }
            : {
                key: body.key,
                version: body.version,
                availability: body.availability,
              }),
          status:
            r === "pricing_recommendations"
              ? "recorded"
              : r === "swarm_agreements"
                ? "proposed"
                : "draft",
          data: body.data,
        };
    if (operation === "update") {
      if (
        ["pricing_recommendations", "swarm_agreements"].includes(r) ||
        (platform(r) && row.status !== "draft")
      )
        throw new OperatingConflict(
          "Published definitions and commercial artifacts are immutable",
        );
      row.data = body.data;
      if (!platform(r)) {
        row.revision++;
        row.status = "draft";
      }
    }
    if (["create", "update", "publish", "configure"].includes(operation))
      await references(db, r, row.data, workspaceId, a.empress, session);
    if (operation === "create" && r === "pricing_recommendations") {
      const policy = await definition(
        db,
        "commercial_policies",
        body.data.policy,
        session,
        true,
      );
      usable(policy, a.empress);
      const p = policy.data;
      if (
        now < new Date(p.effectiveFrom) ||
        (p.effectiveUntil && now >= new Date(p.effectiveUntil))
      )
        throw new OperatingConflict("Policy not effective");
      const swarm = await scoped(
        db,
        "client_swarms",
        body.data.swarmId,
        workspaceId!,
        session,
      );
      if (swarm.status !== "configured")
        throw new OperatingConflict("Swarm must be configured");
      const m = await model(db, swarm, a.empress, session, true);
      const ready = evaluateSwarmReadiness(m);
      if (!ready.ready) throw new OperatingConflict("Swarm is not ready");
      const n = body.data.recommendedMonthlyMinor,
        cost = body.data.expectedOperatingMonthlyMinor;
      row.data = {
        ...body.data,
        configurationSnapshot: snapshot(m),
        policySnapshot: p,
        currency: p.currency,
        monthlyMargin: n ? (n - cost) / n : null,
      };
    }
    if (operation === "create" && r === "swarm_agreements") {
      const recommendation = await scoped(
        db,
        "pricing_recommendations",
        body.data.recommendationId,
        workspaceId!,
        session,
      );
      if (recommendation.status !== "recorded")
        throw new OperatingConflict("Recommendation unavailable");
      const billingWorkspace = await db
        .collection("crm_workspaces")
        .findOne({ id: workspaceId!, archived: { $ne: true } }, { session });
      if (!billingWorkspace)
        throw new OperatingConflict("Workspace unavailable");
      const billing = effectiveWorkspaceBilling(
        billingWorkspace.billingExemption,
        0,
      );
      const billingLedger = await db
        .collection("schema_versions")
        .findOne({ _id: "vapp-v1" } as Document, { session });
      if (
        [19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30].includes(
          billingLedger?.version ?? 0,
        )
      ) {
        const billingLock = await db
          .collection("crm_workspaces")
          .updateOne(
            { id: workspaceId!, updatedAt: billingWorkspace.updatedAt },
            { $inc: { executionSerial: 1 } },
            { session },
          );
        if (billingLock.matchedCount !== 1)
          throw new OperatingConflict("Billing treatment changed");
      } else if (billingWorkspace.billingExemption !== undefined) {
        throw new OperatingConflict("Workspace billing requires schema v19");
      }
      const decision =
        billing.treatment === "internal"
          ? { ...body.data, treatment: "internal", onboardingMinor: 0 }
          : body.data;
      const calculated = evaluateCommercialDecision(
        decision,
        recommendation.data,
      );
      row.data = {
        decision,
        swarmId: recommendation.data.swarmId,
        recommendationSnapshot: recommendation.data,
        ...calculated,
        decidedBy: a.actor,
        decidedAt: now,
        externalReferenceIds: [],
      };
    }
    if (operation === "publish") {
      if (!platform(r) || row.status !== "draft")
        throw new OperatingConflict("Only global drafts publish");
      row.status = "active";
      if (r === "methodology_availability")
        await persistMethodologyDefinition(db, session, row, a.actor);
    }
    if (operation === "configure") {
      if (!["client_agents", "client_swarms"].includes(r))
        throw new OperatingConflict("Not configurable");
      if (r === "client_agents") {
        const d = await definition(
          db,
          "agent_definitions",
          row.data.definition,
          session,
          true,
        );
        if (
          configurationIssues(
            d.data.configurationFields,
            row.data.configuration,
          ).length
        )
          throw new OperatingConflict("Configuration incomplete");
      } else if (
        !evaluateSwarmReadiness(await model(db, row, a.empress, session, true))
          .ready
      )
        throw new OperatingConflict("Swarm is not ready");
      row.status = "configured";
    }
    if (["approve", "empress-approve"].includes(operation)) {
      if (r !== "swarm_agreements" || row.status !== "proposed")
        throw new OperatingConflict("Only proposed agreements approve");
      if (operation === "empress-approve") {
        a.authority.scopeFilter(a.context, "approve", {
          type: "agreement_approvals",
        });
        row = reviewable(row);
        row.data.policyResult = "approved_by_empress";
        row.data.empressApproval = {
          actor: a.actor,
          at: now,
          reason: body.reason,
        };
      } else if (row.data.policyResult !== "within_policy")
        throw new OperatingConflict("Empress approval required");
      const others = await db
        .collection(r)
        .find(
          { workspaceId, "data.swarmId": row.data.swarmId, status: "approved" },
          { session },
        )
        .limit(101)
        .toArray();
      if (
        others.length > 100 ||
        others.some(
          (o) =>
            (!o.data.decision.effectiveUntil ||
              o.data.decision.effectiveUntil >
                row.data.decision.effectiveFrom) &&
            (!row.data.decision.effectiveUntil ||
              row.data.decision.effectiveUntil > o.data.decision.effectiveFrom),
        )
      )
        throw new OperatingConflict("Approved agreement periods overlap");
      row.status = "approved";
    }
    if (operation === "supersede") {
      if (
        !["pricing_recommendations", "swarm_agreements"].includes(r) ||
        !["recorded", "approved"].includes(row.status)
      )
        throw new OperatingConflict("Cannot supersede");
      row.status = "superseded";
    }
    if (operation === "retire") {
      row.status = "retired";
      row.archived = true;
      row.archivedAt = now;
    }
    row = clean(OperatingSchemas[r].parse(row)) as Document;
    if (operation === "delete") {
      const removed = await db
        .collection(r)
        .deleteOne({ id: row.id, updatedAt: prev!.updatedAt }, { session });
      if (!removed.deletedCount) throw new OperatingConflict("Record changed");
    } else if (!prev) await db.collection(r).insertOne(row, { session });
    else {
      const result = await db
        .collection(r)
        .updateOne(
          { id: row.id, updatedAt: prev.updatedAt },
          { $set: row },
          { session },
        );
      if (!result.matchedCount) throw new OperatingConflict("Record changed");
    }
    await db.collection("events").insertOne(
      EventSchema.parse({
        id: generatePlatformId("event"),
        ...(workspaceId ? { workspaceId } : {}),
        createdAt: now,
        updatedAt: now,
        occurredAt: now,
        actor: a.actor,
        eventType: "operating_foundation_changed",
        payload: {
          application: "hvmapp",
          resource: r,
          resourceId: row.id,
          operation,
          ...(operation === "delete"
            ? { key: row.key, version: row.version, name: row.data.name }
            : {}),
          ...(exceptional
            ? {
                authority: "empress",
                actor: a.actor,
                authorizationResource: "agreement_approvals",
                reason: body.reason,
              }
            : {}),
        },
      }),
      { session },
    );
    return exceptional
      ? ApprovalSuccess.parse({
          id: row.id,
          workspaceId: row.workspaceId,
          status: row.status,
          updatedAt: row.updatedAt.toISOString(),
          policyResult: row.data.policyResult,
          empressApproval: {
            ...row.data.empressApproval,
            at: row.data.empressApproval.at.toISOString(),
          },
        })
      : withoutMongoId(row);
  });
}

export async function reviewAgentRemoval(
  mongo: MongoService,
  config: AppConfig,
  identity: AuthenticatedUser,
  id: string,
  operation: string,
) {
  platformIdSchema("agentdefinition").parse(id);
  const action = z.enum(["delete", "retire"]).parse(operation);
  const db = await mongo.database();
  await access(db, config, identity, "agent_definitions", "update");
  const row = await db
    .collection("agent_definitions")
    .findOne({ id, workspaceId: { $exists: false } });
  if (!row) throw new AuthorizationDenied();
  return agentDefinitionRemovalReview(db, row, action);
}
