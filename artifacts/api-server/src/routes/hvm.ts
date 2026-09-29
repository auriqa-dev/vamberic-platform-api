import { createHiveDefinitionsRouter } from "./hive-definitions";
import { Router, json, type ErrorRequestHandler } from "express";
import { z, ZodError } from "zod";
import type { ClientSession, Db, Document } from "mongodb";
import type { AppConfig } from "../config";
import type { MongoService } from "../services/mongo";
import { resolveHvmContext, withoutMongoId } from "../services/hvm-context";
import {
  AuthorizationDenied,
  type Action,
  type ResourceType,
} from "../authorization/policy";
import {
  BrandRecordSchema,
  BrandSchema,
  BrandKitRecordSchema,
  BrandKitSchema,
  WorkspaceIntegrationSchema,
  WorkspaceMembershipSchema,
  partnerHumanSchema,
  platformIdSchema,
  generatePlatformId,
  EventSchema,
  hasCapabilityInstanceEntitlement,
  type Capability,
  type CapabilityInstance,
  type Entitlement,
  type Product,
  type CrmWorkspace,
} from "../domain";
import { readCurrentBrandKit } from "../services/brand-kits";
export const HVM_CLIENT_PROVIDERS = [
  "odyssiant",
  "lusha",
  "postmark",
  "hubspot",
  "ga4",
  "ahrefs",
  "google_ads",
  "linkedin",
  "crm",
  "social",
] as const;
const label = z.string().trim().min(1).max(200);
const brandInput = BrandRecordSchema.pick({
  name: true,
  slug: true,
  primaryDomain: true,
  description: true,
}).strict();
const kitInput = BrandKitRecordSchema.pick({
  colours: true,
  typography: true,
  visualRules: true,
  voice: true,
  terminology: true,
  descriptions: true,
  imageryGuidance: true,
  emailDefaults: true,
})
  .partial()
  .strict();
const integrationInput = z
  .object({
    provider: z.enum(HVM_CLIENT_PROVIDERS),
    displayName: label,
    externalAccountId: label.optional(),
    externalTenantId: label.optional(),
  })
  .strict();
const expected = z.string().datetime();
class Conflict extends Error {}
const pick = (row: Document, keys: string[]) =>
  Object.fromEntries(
    keys.filter((k) => row[k] !== undefined).map((k) => [k, row[k]]),
  );
export function createHvmRouter(config: AppConfig, mongo: MongoService) {
  const router = Router();
  router.use((req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    if (
      !req.auth ||
      req.authorization?.application !== "hvmapp" ||
      req.authorization.actor.type !== "human"
    ) {
      next(new AuthorizationDenied());
      return;
    }
    next();
  });
  router.use(json({ limit: "256kb", strict: true, inflate: false }));
  router.use(createHiveDefinitionsRouter(config, mongo));
  router.get("/context", async (req, res) => {
    const resolved = await resolveHvmContext(
      await mongo.database(),
      config,
      req.auth!,
    );
    res.json(resolved.response);
  });
  router.get("/integration-providers", (_req, res) =>
    res.json({ providers: HVM_CLIENT_PROVIDERS }),
  );
  async function list(
    db: Db,
    collection: string,
    filter: Document,
    session?: ClientSession,
  ) {
    const rows = await db
      .collection(collection)
      .find(filter, { session })
      .sort({ id: 1 })
      .limit(101)
      .toArray();
    if (rows.length > 100) throw new Conflict("Scope exceeds Phase 1 limit");
    return rows.map(withoutMongoId);
  }
  const resources: Record<string, ResourceType> = {
    overview: "crm_workspaces",
    brands: "brands",
    integrations: "workspace_integrations",
    team: "workspace_memberships",
    capabilities: "capability_instances",
    enquiries: "crm_leads",
  };
  router.get("/workspaces/:workspaceId/:view", async (req, res) => {
    const workspaceId = platformIdSchema("workspace").parse(
      req.params.workspaceId,
    );
    const resource = resources[req.params.view];
    if (!resource) throw new AuthorizationDenied();
    const db = await mongo.database();
    const resolved = await resolveHvmContext(db, config, req.auth!);
    const scope = resolved.authority.scopeFilter(resolved.context, "read", {
      type: resource,
      workspaceId,
    });
    if (req.params.view === "overview") {
      const workspace = await db
        .collection("crm_workspaces")
        .findOne({ id: workspaceId, archived: { $ne: true } });
      if (!workspace) throw new AuthorizationDenied();
      const organisation = await db.collection("organisations").findOne({
        id: workspace.clientOrganisationId,
        $or: [{ workspaceId }, { workspaceId: { $exists: false } }],
      });
      const assignments = await list(db, "workspace_partner_assignments", {
        ...scope,
        status: "active",
        archived: { $ne: true },
      });
      const partners = await list(db, "hvm_partners", {
        id: { $in: assignments.map((a) => a.partnerId) },
        status: "active",
        archived: { $ne: true },
      });
      res.json({
        workspace: pick(workspace, ["id", "name", "kind", "updatedAt"]),
        organisation: organisation
          ? pick(organisation, ["id", "name", "domain"])
          : null,
        partners: partners.map((p) => pick(p, ["id", "displayName"])),
        readiness: {
          brands: await db.collection("brands").countDocuments({
            ...scope,
            status: "active",
            archived: { $ne: true },
          }),
          approvedBrandKits: await db.collection("brand_kits").countDocuments({
            ...scope,
            status: "approved",
            archived: { $ne: true },
          }),
        },
      });
    } else if (req.params.view === "brands")
      res.json({
        brands: (
          await list(db, "brands", { ...scope, archived: { $ne: true } })
        ).map((b) =>
          pick(b, [
            "id",
            "workspaceId",
            "organisationId",
            "name",
            "slug",
            "status",
            "primaryDomain",
            "description",
            "updatedAt",
          ]),
        ),
      });
    else if (req.params.view === "integrations")
      res.json({
        integrations: (await list(db, "workspace_integrations", scope))
          .filter((i) => HVM_CLIENT_PROVIDERS.includes(i.provider))
          .map((i) => ({
            ...pick(i, [
              "id",
              "provider",
              "displayName",
              "status",
              "externalAccountId",
              "externalTenantId",
              "updatedAt",
            ]),
            connectionReady:
              i.status === "connected" && i.provider !== "odyssiant",
          })),
      });
    else if (req.params.view === "team") {
      const memberships = await list(db, "workspace_memberships", scope);
      const assignments = await list(db, "workspace_partner_assignments", {
        ...scope,
        status: "active",
        archived: { $ne: true },
      });
      res.json({
        memberships: memberships.map((m) =>
          pick(m, [
            "id",
            "role",
            "status",
            "personId",
            "joinedAt",
            "endedAt",
            "updatedAt",
          ]),
        ),
        partnerAssignments: assignments.map((a) =>
          pick(a, ["id", "partnerId", "role", "status"]),
        ),
      });
    } else if (req.params.view === "enquiries")
      res.json({
        leads: await list(db, "crm_leads", scope),
        opportunities: await list(db, "opportunities", scope),
      });
    else {
      const instances = (await list(
        db,
        "capability_instances",
        scope,
      )) as CapabilityInstance[];
      const entitlements = (await list(
        db,
        "entitlements",
        scope,
      )) as Entitlement[];
      const capabilities = (await list(db, "capabilities", {
        id: { $in: instances.map((i) => i.capabilityId) },
      })) as Capability[];
      const products = (await list(db, "products", {
        id: { $in: instances.map((i) => i.scopeProductId).filter(Boolean) },
        $or: [{ workspaceId }, { workspaceId: { $exists: false } }],
      })) as Product[];
      const workspace = await db
        .collection("crm_workspaces")
        .findOne({ id: workspaceId });
      res.json({
        instances: instances.map((i) => ({
          ...pick(i, [
            "id",
            "capabilityId",
            "scopeType",
            "scopeProductId",
            "status",
          ]),
          access: hasCapabilityInstanceEntitlement(
            {
              instances,
              capabilities,
              products,
              workspaces: [withoutMongoId(workspace!) as CrmWorkspace],
            },
            entitlements,
            i.id,
            workspaceId,
            new Date(),
          ),
        })),
        entitlements: entitlements.map((e) =>
          pick(e, [
            "id",
            "capabilityId",
            "capabilityInstanceId",
            "status",
            "activeFrom",
            "activeUntil",
          ]),
        ),
      });
    }
  });
  router.get(
    "/workspaces/:workspaceId/brands/:brandId/kit",
    async (req, res) => {
      const db = await mongo.database();
      const resolved = await resolveHvmContext(db, config, req.auth!);
      const result = await readCurrentBrandKit(
        db,
        resolved.authority,
        resolved.context,
        req.params.workspaceId,
        req.params.brandId,
      );
      if (!result) throw new AuthorizationDenied();
      res.json(result);
    },
  );
  router.get(
    "/workspaces/:workspaceId/brands/:brandId/kits",
    async (req, res) => {
      const workspaceId = platformIdSchema("workspace").parse(
        req.params.workspaceId,
      );
      const brandId = platformIdSchema("brand").parse(req.params.brandId);
      const db = await mongo.database();
      const resolved = await resolveHvmContext(db, config, req.auth!);
      const scope = resolved.authority.scopeFilter(resolved.context, "read", {
        type: "brand_kits",
        workspaceId,
      });
      if (!(await db.collection("brands").findOne({ ...scope, id: brandId })))
        throw new AuthorizationDenied();
      res.json({
        kits: (await list(db, "brand_kits", { ...scope, brandId })).map((k) =>
          BrandKitSchema.parse(k),
        ),
      });
    },
  );
  // One transactional write seam, fresh authorization and workspace serialization.
  router.post("/workspaces/:workspaceId/:operation", async (req, res) => {
    const workspaceId = platformIdSchema("workspace").parse(
      req.params.workspaceId,
    );
    const operations: Record<
      string,
      { resource: ResourceType; action: Action }
    > = {
      profile: { resource: "crm_workspaces", action: "update" },
      "brand-create": { resource: "brands", action: "create" },
      "brand-update": { resource: "brands", action: "update" },
      "kit-create": { resource: "brand_kits", action: "create" },
      "kit-update": { resource: "brand_kits", action: "update" },
      "kit-approve": { resource: "brand_kits", action: "approve" },
      "kit-retire": { resource: "brand_kits", action: "approve" },
      "integration-create": {
        resource: "workspace_integrations",
        action: "create",
      },
      "integration-update": {
        resource: "workspace_integrations",
        action: "update",
      },
      "integration-disconnect": {
        resource: "workspace_integrations",
        action: "update",
      },
      "member-provision": {
        resource: "workspace_memberships",
        action: "manage",
      },
      "member-revoke": { resource: "workspace_memberships", action: "manage" },
    };
    const op = operations[req.params.operation];
    if (!op) throw new AuthorizationDenied();
    if (!mongo.withTransaction) throw new Error("Transactions required");
    const result = await mongo.withTransaction(async (db, session) => {
      const resolved = await resolveHvmContext(db, config, req.auth!, session);
      resolved.authority.scopeFilter(resolved.context, op.action, {
        type: op.resource,
        workspaceId,
      });
      const options = { session };
      const workspace = await db
        .collection("crm_workspaces")
        .findOne({ id: workspaceId, archived: { $ne: true } }, options);
      if (!workspace) throw new AuthorizationDenied();
      const previousWorkspaceUpdate = workspace.updatedAt.toISOString();
      const now = new Date(
        Math.max(Date.now(), workspace.updatedAt.getTime() + 1),
      );
      await db
        .collection("crm_workspaces")
        .updateOne(
          { id: workspaceId, updatedAt: workspace.updatedAt },
          { $set: { updatedAt: now } },
          options,
        );
      const actor = partnerHumanSchema.parse(resolved.context.actor);
      const base = {
        workspaceId,
        createdAt: now,
        updatedAt: now,
        createdBy: actor,
        updatedBy: actor,
      };
      const collection = db.collection(op.resource);
      async function current(id: string, date: string) {
        const row = await collection.findOne(
          { id, workspaceId, archived: { $ne: true } },
          options,
        );
        if (!row) throw new AuthorizationDenied();
        if (row.updatedAt.toISOString() !== date)
          throw new Conflict("Record changed; reload");
        return withoutMongoId(row);
      }
      function clean(value: unknown): unknown {
        if (value instanceof Date) return value;
        if (Array.isArray(value)) return value.map(clean);
        if (value && typeof value === "object")
          return Object.fromEntries(
            Object.entries(value)
              .filter(([, v]) => v !== undefined)
              .map(([k, v]) => [k, clean(v)]),
          );
        return value;
      }
      async function save(raw: Document, fresh: boolean) {
        const row = clean(raw) as Document;
        if (fresh) await collection.insertOne(row, options);
        else
          await collection.updateOne(
            { id: row.id, workspaceId },
            { $set: row },
            options,
          );
        await db.collection("events").insertOne(
          EventSchema.parse({
            ...base,
            id: generatePlatformId("event"),
            eventType: "hvm_onboarding_changed",
            occurredAt: now,
            actor,
            payload: {
              application: "hvmapp",
              resource: op.resource,
              resourceId: row.id,
              action: req.params.operation,
              human: actor,
            },
          }),
          options,
        );
        return { id: row.id, updatedAt: row.updatedAt };
      }
      async function kitReferences(kit: Document) {
        if (
          !(await db.collection("brands").findOne(
            {
              id: kit.brandId,
              workspaceId,
              status: "active",
              archived: { $ne: true },
            },
            options,
          ))
        )
          throw new AuthorizationDenied();
        for (const copy of kit.descriptions?.products ?? [])
          if (
            !(await db.collection("products").findOne(
              {
                id: copy.productId,
                brandId: kit.brandId,
                workspaceId,
                archived: { $ne: true },
              },
              options,
            ))
          )
            throw new AuthorizationDenied();
        if (
          kit.emailDefaults?.replyToContactPointId &&
          !(await db.collection("contact_points").findOne(
            {
              id: kit.emailDefaults.replyToContactPointId,
              workspaceId,
              archived: { $ne: true },
            },
            options,
          ))
        )
          throw new AuthorizationDenied();
      }
      switch (req.params.operation) {
        case "profile": {
          const input = z
            .object({ name: label, expectedUpdatedAt: expected })
            .strict()
            .parse(req.body);
          if (input.expectedUpdatedAt !== previousWorkspaceUpdate)
            throw new Conflict("Workspace changed; reload");
          await db
            .collection("crm_workspaces")
            .updateOne(
              { id: workspaceId },
              { $set: { name: input.name, updatedAt: now } },
              options,
            );
          await db.collection("events").insertOne(
            EventSchema.parse({
              ...base,
              id: generatePlatformId("event"),
              eventType: "hvm_onboarding_changed",
              occurredAt: now,
              actor,
              payload: {
                application: "hvmapp",
                resource: "crm_workspaces",
                resourceId: workspaceId,
                action: "profile",
                human: actor,
              },
            }),
            options,
          );
          return { id: workspaceId, updatedAt: now };
        }
        case "brand-create":
          return save(
            BrandSchema.parse({
              ...brandInput.parse(req.body),
              ...base,
              id: generatePlatformId("brand"),
              organisationId: workspace.clientOrganisationId,
              status: "active",
            }),
            true,
          );
        case "brand-update": {
          const { id, expectedUpdatedAt, changes } = z
            .object({
              id: platformIdSchema("brand"),
              expectedUpdatedAt: expected,
              changes: brandInput.partial(),
            })
            .strict()
            .parse(req.body);
          return save(
            BrandSchema.parse({
              ...(await current(id, expectedUpdatedAt)),
              ...changes,
              updatedAt: now,
              updatedBy: actor,
            }),
            false,
          );
        }
        case "kit-create": {
          const input = z
            .object({
              brandId: platformIdSchema("brand"),
              content: kitInput,
              sourceKitId: platformIdSchema("brandkit").optional(),
            })
            .strict()
            .parse(req.body);
          let source: Document = {};
          if (input.sourceKitId) {
            const row = await collection.findOne(
              { id: input.sourceKitId, workspaceId, brandId: input.brandId },
              options,
            );
            if (!row) throw new AuthorizationDenied();
            source = withoutMongoId(row);
          }
          const kit = BrandKitSchema.parse({
            ...source,
            ...input.content,
            ...base,
            id: generatePlatformId("brandkit"),
            brandId: input.brandId,
            status: "draft",
            archived: false,
            archivedAt: undefined,
            approvedAt: undefined,
            approvedBy: undefined,
          });
          await kitReferences(kit);
          return save(kit, true);
        }
        case "kit-update": {
          const input = z
            .object({
              id: platformIdSchema("brandkit"),
              expectedUpdatedAt: expected,
              content: kitInput,
            })
            .strict()
            .parse(req.body);
          const row = await current(input.id, input.expectedUpdatedAt);
          if (row.status !== "draft")
            throw new Conflict("Only drafts may be edited");
          const kit = BrandKitSchema.parse({
            ...row,
            ...input.content,
            updatedAt: now,
            updatedBy: actor,
          });
          await kitReferences(kit);
          return save(kit, false);
        }
        case "kit-approve":
        case "kit-retire": {
          const input = z
            .object({
              id: platformIdSchema("brandkit"),
              expectedUpdatedAt: expected,
              replacesKitId: platformIdSchema("brandkit").optional(),
            })
            .strict()
            .parse(req.body);
          const row = await current(input.id, input.expectedUpdatedAt);
          await kitReferences(row);
          if (req.params.operation === "kit-retire") {
            if (row.status !== "approved")
              throw new Conflict("Only current kits may retire");
            return save(
              BrandKitSchema.parse({
                ...row,
                status: "retired",
                updatedAt: now,
                updatedBy: actor,
              }),
              false,
            );
          }
          if (row.status !== "draft")
            throw new Conflict("Only drafts may be approved");
          const active = await collection
            .find(
              { workspaceId, brandId: row.brandId, status: "approved" },
              options,
            )
            .limit(2)
            .toArray();
          if (active.length > 1 || active[0]?.id !== input.replacesKitId)
            throw new Conflict("Current kit changed; reload");
          if (active[0])
            await collection.updateOne(
              { id: active[0].id, workspaceId, status: "approved" },
              { $set: { status: "retired", updatedAt: now, updatedBy: actor } },
              options,
            );
          return save(
            BrandKitSchema.parse({
              ...row,
              status: "approved",
              approvedAt: now,
              approvedBy: actor,
              updatedAt: now,
              updatedBy: actor,
            }),
            false,
          );
        }
        case "integration-create":
          return save(
            WorkspaceIntegrationSchema.parse({
              ...integrationInput.parse(req.body),
              ...base,
              id: generatePlatformId("integration"),
              status: "pending",
            }),
            true,
          );
        case "integration-update":
        case "integration-disconnect": {
          const input = z
            .object({
              id: platformIdSchema("integration"),
              expectedUpdatedAt: expected,
              changes: integrationInput
                .omit({ provider: true })
                .partial()
                .optional(),
            })
            .strict()
            .parse(req.body);
          const row = await current(input.id, input.expectedUpdatedAt);
          if (!HVM_CLIENT_PROVIDERS.includes(row.provider))
            throw new AuthorizationDenied();
          if (
            req.params.operation === "integration-update" &&
            row.status !== "pending"
          )
            throw new Conflict("Only pending metadata may be edited");
          return save(
            WorkspaceIntegrationSchema.parse({
              ...row,
              ...input.changes,
              ...(req.params.operation === "integration-disconnect"
                ? { status: "disconnected", disconnectedAt: now }
                : {}),
              updatedAt: now,
              updatedBy: actor,
            }),
            false,
          );
        }
        case "member-provision": {
          const input = z
            .object({
              human: partnerHumanSchema,
              role: z.enum(["admin", "member"]),
            })
            .strict()
            .parse(req.body);
          if (input.human.issuer !== config.cognito.issuer)
            throw new AuthorizationDenied();
          const existing = await collection.findOne(
            {
              workspaceId,
              "human.issuer": input.human.issuer,
              "human.id": input.human.id,
              status: "active",
            },
            options,
          );
          if (existing) {
            if (existing.role !== input.role)
              throw new Conflict("Existing membership role differs");
            return { id: existing.id, updatedAt: existing.updatedAt };
          }
          return save(
            WorkspaceMembershipSchema.parse({
              ...base,
              ...input,
              id: generatePlatformId("workspacemembership"),
              status: "active",
              joinedAt: now,
              addedBy: actor,
            }),
            true,
          );
        }
        case "member-revoke": {
          const input = z
            .object({
              id: platformIdSchema("workspacemembership"),
              expectedUpdatedAt: expected,
            })
            .strict()
            .parse(req.body);
          const row = await current(input.id, input.expectedUpdatedAt);
          if (row.human.id === actor.id && row.human.issuer === actor.issuer)
            throw new Conflict(
              "Self-revocation requires another administrator",
            );
          return save(
            WorkspaceMembershipSchema.parse({
              ...row,
              status: "ended",
              endedAt: now,
              updatedAt: now,
              updatedBy: actor,
            }),
            false,
          );
        }
        default:
          throw new AuthorizationDenied();
      }
    });
    res.status(200).json(result);
  });
  router.use((_req, _res, next) => next(new AuthorizationDenied()));
  const errors: ErrorRequestHandler = (error, _req, res, _next) => {
    void _next;
    const status =
      error instanceof AuthorizationDenied
        ? 404
        : error instanceof ZodError || error?.type === "entity.parse.failed"
          ? 400
          : error instanceof Conflict || error?.code === 11000
            ? 409
            : 503;
    res.status(status).json({
      error: {
        code:
          status === 404
            ? "NOT_FOUND"
            : status === 400
              ? "INVALID_INPUT"
              : status === 409
                ? "CONFLICT"
                : "HVM_UNAVAILABLE",
        message:
          status === 404
            ? "Resource not found"
            : status === 400
              ? "Invalid request"
              : status === 409
                ? "Record changed or conflicts; reload"
                : "HVM temporarily unavailable",
      },
    });
  };
  router.use(errors);
  return router;
}
