import { businessOutcomesRouter } from "./business-outcomes";
import { createPerformanceRouter } from "./performance";
import { interactionRouter } from "./interaction";
import { websiteTrackingRouter } from "./website-tracking";
import { createCommunicationsRouter } from "./communications";
import { createNbaRouter } from "./nba";
import { createGa4Router } from "./ga4";
import { createMailboxRouter } from "./mailbox";
import { createLushaRouter } from "./lusha";
import { createCampaignRouter } from "./campaigns";
import { createResearchRouter } from "./research";
import { createContentStrategyRouter } from "./content-strategy";
import { createContactStrategyRouter } from "./contact-strategy";
import { createResearchDocumentsRouter } from "./research-documents";
import { createBrandExpressionRouter } from "./brand-expression";
import type { BrandGenerator } from "../services/brand-expression/generate";
import {
  ExpressionContentSchema,
  ExpressionDimensionSchema,
} from "../domain/brand-expression";
import { readOnboardingBrandDomain } from "../services/onboarding-brand-domain";
import { createContactManagementRouter } from "./contact-management";
import { createIcpRouter } from "./icp";
import type { IcpGenerator } from "../services/icp/generate";
import { createPsuRouter } from "./psu";
import type { PsuGenerator } from "../services/psu/generate";
import { createBrandImagesRouter } from "./brand-images";
import { createBrandImageStore } from "../services/brand-images";
import { createClientOnboardingRouter } from "./client-onboarding";
import { OnboardingConflict } from "../services/client-onboarding";
import {
  provisionQueenClient,
  QueenProvisionConflict,
} from "../services/hvm-queen-provision";
import { createAgentSubsystem } from "../services/agent-subsystem";
import { createOperatingRouter } from "./operating";
import { createOffersRouter } from "./offers";
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
  WorkspacePartnerAssignmentSchema,
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
  chatPersonality: true,
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
export function createHvmRouter(
  config: AppConfig,
  mongo: MongoService,
  agents = createAgentSubsystem(config, mongo),
  brandImages = config.brandImages
    ? createBrandImageStore(
        config.brandImages.bucket,
        config.brandImages.region,
      )
    : undefined,
  psuGenerator?: PsuGenerator,
  icpGenerator?: IcpGenerator,
  brandGenerator?: BrandGenerator,
) {
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
  router.use(createResearchDocumentsRouter(config, mongo));
  router.use(createBrandImagesRouter(config, mongo, brandImages));
  // Import batches are bounded to 700 KB by the uploader. Parse these before
  // the normal 256 KB application limit, with room for the request envelope.
  router.use(
    "/workspaces/:workspaceId/icp/imports",
    json({ limit: "1mb", strict: true, inflate: false }),
  );
  router.use(json({ limit: "256kb", strict: true, inflate: false }));
  router.use(createClientOnboardingRouter(config, mongo));
  router.use(createPsuRouter(config, mongo, psuGenerator));
  router.use(createIcpRouter(config, mongo, icpGenerator));
  router.use(createMailboxRouter(config, mongo));
  router.use(createGa4Router(config, mongo));
  router.use(businessOutcomesRouter(config, mongo));
  router.use(createPerformanceRouter(config, mongo));
  router.use(createCommunicationsRouter(config, mongo));
  router.use(websiteTrackingRouter(config, mongo));
  router.use(interactionRouter(config, mongo));
  router.use(createLushaRouter(config, mongo));
  router.use(createResearchRouter(config, mongo));
  router.use(createCampaignRouter(config, mongo));
  router.use(createNbaRouter(config, mongo, agents.nba));
  router.use(createContactStrategyRouter(config, mongo));
  router.use(createContentStrategyRouter(config, mongo));
  router.use(createBrandExpressionRouter(config, mongo, brandGenerator));
  router.use(createContactManagementRouter(config, mongo));
  router.use(createHiveDefinitionsRouter(config, mongo));
  router.use(createOffersRouter(config, mongo));
  router.use(createOperatingRouter(config, mongo));
  router.use(agents.operators);
  router.use(agents.human);
  router.post("/partners/:partnerId/clients", async (req, res) => {
    z.object({}).strict().parse(req.query);
    try {
      res
        .status(201)
        .json(
          await provisionQueenClient(
            config,
            mongo,
            req.auth!,
            req.params.partnerId,
            req.body,
          ),
        );
    } catch (error) {
      if (error instanceof QueenProvisionConflict) throw new Conflict();
      throw error;
    }
  });
  router.get("/reference-data/currencies", async (req, res) => {
    z.object({}).strict().parse(req.query);
    const db = await mongo.database();
    await resolveHvmContext(db, config, req.auth!);
    const rows = await db
      .collection("ref_currencies")
      .find(
        { is_active: true },
        { projection: { _id: 0, code: 1, name: 1, minorUnits: 1 } },
      )
      .sort({ code: 1 })
      .toArray();
    const supported = new Set(Intl.supportedValuesOf("currency"));
    res.json({
      currencies: rows.map((row) => ({
        code: row.code,
        name: row.name,
        minorUnits: row.minorUnits,
        selectable: supported.has(row.code) && Number.isInteger(row.minorUnits),
      })),
    });
  });
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
    } else if (req.params.view === "brands") {
      const brands = await list(db, "brands", {
        ...scope,
        archived: { $ne: true },
      });
      res.json({
        brands: await Promise.all(
          brands.map(async (b) => ({
            ...pick(b, [
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
            ...(b.primaryDomain
              ? {}
              : {
                  primaryDomain: await readOnboardingBrandDomain(
                    db,
                    workspaceId,
                    b.id,
                  ),
                }),
          })),
        ),
      });
    } else if (req.params.view === "integrations")
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
      const workspace = await db
        .collection("crm_workspaces")
        .findOne({ id: workspaceId, archived: { $ne: true } });
      res.json({
        workspaceId,
        updatedAt: workspace?.updatedAt,
        management: assignments.length ? "queen" : "client",
        canManage: resolved.authority.authorize(resolved.context, "manage", {
          type: "workspace_memberships",
          workspaceId,
        }),
        canChangeManagement: resolved.response.clients.some(
          (c) => c.workspaceId === workspaceId && c.role === "admin",
        ),
        currentHuman: resolved.response.human,
        memberships: memberships.map((m) =>
          pick(m, [
            "id",
            "role",
            "status",
            "personId",
            "human",
            "joinedAt",
            "endedAt",
            "updatedAt",
          ]),
        ),
        partnerAssignments: assignments.map((a) =>
          pick(a, ["id", "partnerId", "role", "status", "updatedAt"]),
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
      "kit-save": { resource: "brand_kits", action: "update" },
      "kit-expression-remove": { resource: "brand_kits", action: "update" },
      "kit-expression-save": { resource: "brand_kits", action: "update" },
      "kit-expression-approve": { resource: "brand_kits", action: "approve" },
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
      "management-change": { resource: "crm_workspaces", action: "update" },
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
        case "kit-save": {
          // One immediate, versioned save: keep other sections and images intact.
          for (const action of ["create", "approve"] as const)
            resolved.authority.scopeFilter(resolved.context, action, {
              type: "brand_kits",
              workspaceId,
            });
          const input = z
            .object({
              brandId: platformIdSchema("brand"),
              expectedKitId: platformIdSchema("brandkit").nullable(),
              expectedUpdatedAt: expected.optional(),
              content: kitInput.refine(
                (v) => Object.keys(v).length === 1,
                "Save one section at a time",
              ),
            })
            .strict()
            .parse(req.body);
          const active = await collection
            .find(
              {
                workspaceId,
                brandId: input.brandId,
                status: "approved",
                archived: { $ne: true },
              },
              options,
            )
            .limit(2)
            .toArray();
          const previous = active[0];
          if (
            active.length > 1 ||
            (previous?.id ?? null) !== input.expectedKitId ||
            previous?.updatedAt.toISOString() !== input.expectedUpdatedAt
          )
            throw new Conflict("Brand Kit changed; reload before saving");
          const kit = BrandKitSchema.parse({
            ...(previous ? withoutMongoId(previous) : {}),
            ...input.content,
            ...base,
            id: generatePlatformId("brandkit"),
            brandId: input.brandId,
            status: "approved",
            approvedAt: now,
            approvedBy: actor,
            archived: false,
            archivedAt: undefined,
          });
          await kitReferences(kit);
          if (previous)
            await collection.updateOne(
              { id: previous.id, workspaceId, status: "approved" },
              { $set: { status: "retired", updatedAt: now, updatedBy: actor } },
              options,
            );
          return save(kit, true);
        }
        case "kit-expression-remove":
        case "kit-expression-save":
        case "kit-expression-approve": {
          const ledger = await db
            .collection("schema_versions")
            .findOne({ _id: "vapp-v1" } as Document, options);
          if (![25, 26, 27, 28, 29, 30].includes(ledger?.version))
            throw new Conflict("Brand Kit upgrade is not available yet");
          const input = z
            .object({
              brandId: platformIdSchema("brand"),
              expectedKitId: platformIdSchema("brandkit").nullable(),
              expectedUpdatedAt: expected.optional(),
              dimension: ExpressionDimensionSchema,
              target: z.enum(["draft", "approved"]).optional(),
              content: z.unknown().optional(),
              originalDescription: z.string().max(4000).default(""),
              sourceGenerationId: platformIdSchema("event").optional(),
            })
            .strict()
            .parse(req.body);
          const active = await collection
            .find(
              {
                workspaceId,
                brandId: input.brandId,
                status: "approved",
                archived: { $ne: true },
              },
              options,
            )
            .limit(2)
            .toArray();
          const previous = active[0];
          if (
            active.length > 1 ||
            (previous?.id ?? null) !== input.expectedKitId ||
            previous?.updatedAt.toISOString() !== input.expectedUpdatedAt
          )
            throw new Conflict("Brand Kit changed; reload before saving");
          if (!previous)
            resolved.authority.scopeFilter(resolved.context, "create", {
              type: "brand_kits",
              workspaceId,
            });
          const expression = structuredClone(previous?.expression ?? {});
          const state = expression[input.dimension] ?? {};
          if (req.params.operation === "kit-expression-save") {
            const content = ExpressionContentSchema.shape[
              input.dimension
            ].parse(input.content);
            let proposal;
            if (input.sourceGenerationId) {
              const source = await db.collection("events").findOne(
                {
                  id: input.sourceGenerationId,
                  workspaceId,
                  eventType: "brand_expression_generation",
                  "payload.brandId": input.brandId,
                  "payload.status": "completed",
                  "payload.input.mode": "interpret",
                },
                options,
              );
              if (!source)
                throw new Conflict("Interpretation is not available");
              proposal = source.payload.result?.settings?.[input.dimension];
              if (
                !proposal ||
                source.payload.input.description !== input.originalDescription
              )
                throw new Conflict("Interpretation source changed");
            }
            state.draft = {
              content,
              originalDescription: input.originalDescription,
              ...(proposal
                ? {
                    proposedContent: proposal,
                    sourceGenerationId: input.sourceGenerationId,
                  }
                : {}),
              savedAt: now,
              savedBy: actor,
            };
          } else if (req.params.operation === "kit-expression-remove") {
            if (!input.target || !state[input.target])
              throw new Conflict("Settings changed; reload before deleting");
            if (input.target === "approved")
              resolved.authority.scopeFilter(resolved.context, "approve", {
                type: "brand_kits",
                workspaceId,
              });
            delete state[input.target];
          } else {
            if (!state.draft)
              throw new Conflict("Save a draft before approval");
            state.approved = {
              ...state.draft,
              approvedAt: now,
              approvedBy: actor,
            };
            delete state.draft;
          }
          expression[input.dimension] = state;
          const kit = BrandKitSchema.parse({
            ...(previous ? withoutMongoId(previous) : {}),
            ...base,
            id: generatePlatformId("brandkit"),
            brandId: input.brandId,
            status: "approved",
            approvedAt: now,
            approvedBy: previous?.approvedBy ?? actor,
            expression,
            archived: false,
            archivedAt: undefined,
          });
          await kitReferences(kit);
          if (previous)
            await collection.updateOne(
              { id: previous.id, workspaceId, status: "approved" },
              { $set: { status: "retired", updatedAt: now, updatedBy: actor } },
              options,
            );
          return save(kit, true);
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
          if (req.body?.provider === "ga4")
            throw new Conflict(
              "Use Connect Google Analytics to verify and save a GA4 property",
            );
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
          if (row.provider === "ga4")
            throw new Conflict(
              "Manage GA4 through its verified connection controls",
            );
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
        case "management-change": {
          if (
            !resolved.response.clients.some(
              (c) => c.workspaceId === workspaceId && c.role === "admin",
            )
          )
            throw new AuthorizationDenied();
          const input = z
            .object({
              management: z.enum(["client", "queen"]),
              partnerId: platformIdSchema("partner").optional(),
              expectedUpdatedAt: expected,
              confirm: z.literal(true),
            })
            .strict()
            .parse(req.body);
          if (input.expectedUpdatedAt !== previousWorkspaceUpdate)
            throw new Conflict(
              "Workspace changed; reload before changing access",
            );
          if (input.management === "queen") {
            if (
              !input.partnerId ||
              !(await db.collection("hvm_partners").findOne(
                {
                  id: input.partnerId,
                  status: "active",
                  archived: { $ne: true },
                },
                options,
              ))
            )
              throw new Conflict("Partner is unavailable");
            if (
              !(await db.collection("hvm_partner_memberships").findOne(
                {
                  partnerId: input.partnerId,
                  role: "owner",
                  status: "active",
                  archived: { $ne: true },
                },
                options,
              ))
            )
              throw new Conflict("Partner needs an active owner");
          } else if (input.partnerId)
            throw new Conflict(
              "Client-managed workspaces do not require a Partner",
            );
          const assignments = await list(
            db,
            "workspace_partner_assignments",
            { workspaceId, status: "active", archived: { $ne: true } },
            session,
          );
          const retained = assignments.find(
            (a) =>
              input.management === "queen" &&
              a.partnerId === input.partnerId &&
              a.role === "primary",
          );
          for (const assignment of assignments) {
            if (assignment.id === retained?.id) continue;
            const ended = WorkspacePartnerAssignmentSchema.parse({
              ...assignment,
              status: "ended",
              endedAt: now,
              updatedAt: now,
              updatedBy: actor,
            });
            await db
              .collection("workspace_partner_assignments")
              .updateOne(
                { id: assignment.id, workspaceId, status: "active" },
                { $set: ended },
                options,
              );
          }
          if (input.management === "queen" && !retained)
            await db.collection("workspace_partner_assignments").insertOne(
              WorkspacePartnerAssignmentSchema.parse({
                ...base,
                id: generatePlatformId("partnerassignment"),
                partnerId: input.partnerId,
                role: "primary",
                status: "active",
                assignedAt: now,
                assignedBy: { type: "human", id: actor.id },
              }),
              options,
            );
          await db.collection("events").insertOne(
            EventSchema.parse({
              ...base,
              id: generatePlatformId("event"),
              eventType: "workspace_management_changed",
              occurredAt: now,
              actor,
              payload: {
                management: input.management,
                partnerId: input.partnerId ?? null,
                endedAssignmentIds: assignments
                  .filter((a) => a.id !== retained?.id)
                  .map((a) => a.id),
              },
            }),
            options,
          );
          return { id: workspaceId, updatedAt: now };
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
          if (row.role === "admin" && row.status === "active") {
            const admins = await collection
              .find(
                {
                  workspaceId,
                  role: "admin",
                  status: "active",
                  archived: { $ne: true },
                },
                options,
              )
              .limit(2)
              .toArray();
            if (admins.length < 2)
              throw new Conflict("Keep at least one client administrator");
          }
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
          : error instanceof Conflict ||
              error instanceof OnboardingConflict ||
              error?.code === 11000
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
