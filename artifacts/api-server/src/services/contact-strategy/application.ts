import { digest } from "@workspace/agent-runtime-protocol";
import { InterpretationFailure, type StrategyInterpreter } from "./interpret";
import { z } from "zod";
import type { Db, ClientSession } from "mongodb";
import type { AppConfig } from "../../config";
import type { AuthenticatedUser } from "../../middlewares/auth";
import type { MongoService } from "../mongo";
import { resolveHvmContext, withoutMongoId } from "../hvm-context";
import { AuthorizationDenied } from "../../authorization/policy";
import { HiveConflict } from "../hive-definitions";
import { lockIcpWorkspace } from "../icp/access";
import {
  EventSchema,
  generatePlatformId,
  platformIdSchema,
} from "../../domain";
import { ContactStrategyPolicyV14Schema } from "../../domain/identity-value-v14";
import { CONTACT_STRATEGY_TEMPLATES, strategyTemplate } from "./catalogue";
import { templateSource } from "./provision";
const mutation = z
  .object({
    key: z.string(),
    expectedVersion: z.number().int().nonnegative(),
    operation: z.enum(["save", "approve", "deactivate", "remove"]),
    statement: z.string().trim().min(1).max(2000).optional(),
    name: z.string().trim().min(1).max(160).optional(),
  })
  .strict();
const customKey = z.string().regex(/^custom_[0-9a-f]{32}$/);
function customDefinition(key: string, name: string) {
  customKey.parse(key);
  return { id: key, key, version: 1, name, category: "Your strategies",
    description: "", type: "contact", configuration: ["Applicability, exceptions and intended outcome"],
    activationRecommendation: "review" as const, approvalRequired: true };
}
async function resolveTemplate(db: Db, w: string, key: string, name?: string, session?: ClientSession) {
  if (!key.startsWith("custom_")) return strategyTemplate(key);
  customKey.parse(key);
  const saved = await db.collection("events").findOne({workspaceId:w,
    eventType:"contact_strategy_definition", "payload.key":key}, {session});
  if (saved) return customDefinition(key, saved.payload.name);
  if (!name) throw new HiveConflict("Enter a name and save the new strategy first");
  return customDefinition(key, name);
}
export function createContactStrategies(
  config: AppConfig,
  mongo: MongoService,
  interpret?: StrategyInterpreter,
) {
  async function access(
    db: Db,
    identity: AuthenticatedUser,
    w: string,
    action: "read" | "update" | "approve",
    session?: ClientSession,
  ) {
    platformIdSchema("workspace").parse(w);
    const r = await resolveHvmContext(db, config, identity, session);
    if (r.context.application !== "hvmapp" || r.context.actor.type !== "human")
      throw new AuthorizationDenied();
    r.authority.scopeFilter(r.context, action, {
      type: "contact_strategy_policies",
      workspaceId: w,
    });
    return r.context.actor;
  }
  async function rows(db: Db, w: string, session?: ClientSession) {
    return (
      await db
        .collection("contact_strategy_policies")
        .find({ workspaceId: w }, { session })
        .toArray()
    ).map((r) => ContactStrategyPolicyV14Schema.parse(withoutMongoId(r)));
  }
  return {
    async list(identity: AuthenticatedUser, w: string) {
      const db = await mongo.database();
      await access(db, identity, w, "read");
      const policies = await rows(db, w);
      const reviews = await db
        .collection("events")
        .find({
          workspaceId: w,
          eventType: "contact_strategy_interpretation",
          "payload.status": "completed",
        })
        .toArray();
      return {
        reviews: reviews.map((e) => ({
          key: e.payload.key,
          createdAt: e.createdAt,
          proposal: e.payload.result,
        })),
        templates: [...CONTACT_STRATEGY_TEMPLATES, ...(await db.collection("events")
          .find({workspaceId:w,eventType:"contact_strategy_definition"}).toArray())
          .map(e => customDefinition(e.payload.key, e.payload.name))],
        policies,
        interpretationAvailable: Boolean(interpret),
      };
    },
    async propose(identity: AuthenticatedUser, w: string, raw: unknown) {
      const input = z
        .object({
          key: z.string(),
          requestKey: z.string().uuid(),
          instruction: z.string().trim().min(1).max(6000),
          name: z.string().trim().min(1).max(160).optional(),
        })
        .strict()
        .parse(raw);
      const db = await mongo.database();
      await access(db, identity, w, "update");
      const template = await resolveTemplate(db, w, input.key, input.name);
      if (!interpret || !mongo.withTransaction)
        throw new Error("Interpretation unavailable");
      const scope = digest({
        w,
        input,
        subject: identity.subject,
        issuer: identity.issuer,
      });
      const reservation = await mongo.withTransaction(async (db, session) => {
        const actor = await access(db, identity, w, "update", session),
          now = await lockIcpWorkspace(db, w, session);
        const previous = await db.collection("events").findOne(
          {
            workspaceId: w,
            eventType: "contact_strategy_interpretation",
            "payload.scope": scope,
          },
          { session },
        );
        if (previous) return { event: previous, context: [], existing: true };
        const current = await rows(db, w, session);
        const latest = [...new Set(current.map((p) => p.key))].map(
          (key) =>
            current
              .filter((p) => p.key === key)
              .sort((a, b) => b.version - a.version)[0],
        );
        const event = EventSchema.parse({
          id: generatePlatformId("event"),
          workspaceId: w,
          eventType: "contact_strategy_interpretation",
          occurredAt: now,
          createdAt: now,
          updatedAt: now,
          createdBy: actor,
          updatedBy: actor,
          source: { system: "contact_strategy" },
          payload: { scope, status: "running", key: input.key },
        });
        await db.collection("events").insertOne(event, { session });
        return {
          event,
          context: latest.map((p) => ({
            key: p.key,
            version: p.version,
            status: p.status,
            clauses: p.clauses,
          })),
          existing: false,
        };
      });
      if (reservation.existing) {
        if (reservation.event.payload.status === "completed")
          return reservation.event.payload.result;
        throw new HiveConflict(
          "This interpretation is already running or failed. Start a new request if necessary.",
        );
      }
      let result;
      try {
        result = await interpret({
          template,
          instruction: input.instruction,
          policies: reservation.context,
        });
      } catch (error) {
        const db = await mongo.database();
        await db
          .collection("events")
          .updateOne(
            { id: reservation.event.id, workspaceId: w },
            {
              $set: {
                "payload.status": "failed",
                ...(error instanceof InterpretationFailure
                  ? { "payload.usage": error.usage }
                  : {}),
              },
            },
          );
        throw new Error("Interpretation failed; saved strategy unchanged");
      }
      await db.collection("events").updateOne(
        { id: reservation.event.id, workspaceId: w },
        {
          $set: {
            "payload.status": "completed",
            "payload.result": result.proposal,
            "payload.usage": result.usage,
          },
        },
      );
      await access(db, identity, w, "read");
      return result.proposal;
    },
    async mutate(identity: AuthenticatedUser, w: string, raw: unknown) {
      const input = mutation.parse(raw);
      if (!mongo.withTransaction) throw new Error("Transactions required");
      return mongo.withTransaction(async (db, session) => {
        const actor = await access(
          db,
          identity,
          w,
          input.operation === "approve" ? "approve" : "update",
          session,
        );
        const now = await lockIcpWorkspace(db, w, session);
        const history = (await rows(db, w, session))
          .filter((r) => r.key === input.key)
          .sort((a, b) => b.version - a.version);
        const previous = history[0];
        const template = await resolveTemplate(db, w, input.key,
          input.operation === "save" ? input.name : undefined, session);
        if (!previous && input.key.startsWith("custom_") && !input.statement)
          throw new HiveConflict("Describe the new strategy before saving");
        if ((previous?.version ?? 0) !== input.expectedVersion)
          throw new HiveConflict("Strategy changed. Reload before saving.");
        if (
          previous &&
          previous.source.reference !==
            templateSource(template.id, template.version)
        )
          throw new HiveConflict(
            "Existing policy requires a reviewed template mapping",
          );
        if (input.operation !== "save" && !previous)
          throw new HiveConflict("Save a draft first");
        const latestDecision = history.find((p) => p.status !== "draft");
        if (
          input.operation === "remove" &&
          latestDecision?.status === "recorded"
        )
          throw new HiveConflict(
            "Deactivate the approved strategy before removing it",
          );
        if (input.operation === "approve" && previous?.status !== "draft")
          throw new HiveConflict("Review a saved draft before approval");
        const record = ContactStrategyPolicyV14Schema.parse({
          ...(previous ?? {
            workspaceId: w,
            key: template.key,
            organisationIds: [],
            personIds: [],
            contactPointIds: [],
            campaignIds: [],
            knowledge: [],
          }),
          id: generatePlatformId("contactstrategy"),
          version: (previous?.version ?? 0) + 1,
          createdAt: now,
          updatedAt: now,
          source: {
            kind: "platform",
            reference: templateSource(template.id, template.version),
          },
          status:
            input.operation === "save"
              ? "draft"
              : input.operation === "approve"
                ? "recorded"
                : "withdrawn",
          ...(previous ? { supersedesId: previous.id } : {}),
          clauses:
            input.operation === "save"
              ? [
                  {
                    key: "policy",
                    category:
                      template.type === "prioritisation"
                        ? "priority"
                        : "contact",
                    statement: input.statement ?? template.description,
                    evidence: [],
                  },
                  ...(previous?.clauses.filter((c) => c.key !== "policy") ??
                    []),
                ]
              : previous!.clauses,
        });
        if (!previous && input.key.startsWith("custom_")) {
          await db.collection("events").insertOne(EventSchema.parse({
            id:generatePlatformId("event"),workspaceId:w,eventType:"contact_strategy_definition",
            occurredAt:now,createdAt:now,updatedAt:now,createdBy:actor,updatedBy:actor,
            source:{system:"contact_strategy"},payload:{key:input.key,name:template.name},
          }),{session});
        }
        await db
          .collection("contact_strategy_policies")
          .insertOne(record, { session });
        await db.collection("events").insertOne(
          EventSchema.parse({
            id: generatePlatformId("event"),
            workspaceId: w,
            eventType: "contact_strategy_changed",
            occurredAt: now,
            createdAt: now,
            updatedAt: now,
            createdBy: actor,
            updatedBy: actor,
            source: { system: "contact_strategy" },
            payload: {
              policyId: record.id,
              version: record.version,
              operation: input.operation,
              templateId: template.id,
              templateVersion: template.version,
            },
          }),
          { session },
        );
        return record;
      });
    },
  };
}
