import { ConsumerFactsSchema } from "./consumer-facts";
import type { MarketDiscovery } from "./discovery";
import { z } from "zod";
import type { Document, ClientSession, Db } from "mongodb";
import type { AppConfig } from "../../config";
import type { MongoService } from "../mongo";
import type { AuthenticatedUser } from "../../middlewares/auth";
import {
  EventSchema,
  generatePlatformId,
  platformIdSchema,
} from "../../domain";
import { resolveHvmContext } from "../hvm-context";
import { HiveConflict } from "../hive-definitions";
import { icpAccess, lockIcpWorkspace } from "./access";
import { ESOS_SUPPORTING_SOURCE } from "./esos-recovery";

const personRuleFields = new Set([
  "preferredLanguage",
  "timezone",
  "consumerCountry",
  "consumerRegion",
  "consumerNeeds",
  "consumerInterests",
  "purchaseStage",
]);
const contactRuleFields = new Set(["jobTitle", "department", "seniority"]);
const rule = z
  .object({
    field: z.enum([
      "industry",
      "country",
      "region",
      "size",
      "jobTitle",
      "department",
      "seniority",
      "preferredLanguage",
      "timezone",
      "consumerCountry",
      "consumerRegion",
      "consumerNeeds",
      "consumerInterests",
      "purchaseStage",
    ]),
    values: z.array(z.string().trim().min(1).max(200)).min(1).max(40),
    effect: z.enum(["include", "exclude"]),
  })
  .strict();
export const EligibilityPolicySchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    exclusivity: z.enum([
      "multiple_offers",
      "one_offer_per_organisation",
      "one_offer_per_customer",
    ]),
    segments: z
      .array(
        z
          .object({
            icpId: platformIdSchema("icp"),
            revision: z.number().int().positive(),
            rules: z.array(rule).min(1).max(20),
          })
          .strict(),
      )
      .min(1)
      .max(40),
    offerPriority: z.array(platformIdSchema("offer")).min(1).max(40),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      new Set(value.segments.map((s) => s.icpId)).size !==
        value.segments.length ||
      new Set(value.offerPriority).size !== value.offerPriority.length
    )
      ctx.addIssue({
        code: "custom",
        message: "Choose each profile and offer only once",
      });
  });
export type EligibilityPolicy = z.infer<typeof EligibilityPolicySchema>;
/** Deterministic fit only. Missing data is never interpreted as a match. */
export function assessFit(record: Document, rules: z.infer<typeof rule>[]) {
  if (!rules.length)
    return { fit: "needs_review", reasons: ["No matching criteria approved"] };
  const reasons: string[] = [];
  let missing = false;
  let failed = false;
  const normal = (v: string) => v.trim().toLocaleLowerCase("en-GB");
  for (const r of rules) {
    const value = r.field === "size" ? record.size?.band : record[r.field];
    const values = Array.isArray(value)
      ? value.filter(
          (v): v is string => typeof v === "string" && Boolean(v.trim()),
        )
      : typeof value === "string" && value.trim()
        ? [value]
        : [];
    if (!values.length) {
      missing = true;
      reasons.push(`${r.field}: not recorded`);
      continue;
    }
    const match = r.values.some((v) =>
      values.some((value) => normal(v) === normal(value)),
    );
    if (
      (r.effect === "exclude" && match) ||
      (r.effect === "include" && !match)
    ) {
      failed = true;
      reasons.push(`${r.field}: does not meet the approved rule`);
    }
  }
  return {
    fit: failed ? "not_fit" : missing ? "needs_review" : "matches",
    reasons,
  };
}
/** Consumer rules use person fields only. Never borrow an employer's attributes. */
export function assessConsumerFit(
  record: Document,
  rules: z.infer<typeof rule>[],
) {
  if (rules.some((r) => !personRuleFields.has(r.field)))
    return {
      fit: "needs_review",
      reasons: [
        "This consumer segment contains business rules. Review the policy using recorded person fields.",
      ],
    };
  return assessFit(record, rules);
}
export function permittedOffers(
  eligible: string[],
  exclusivity: EligibilityPolicy["exclusivity"],
) {
  return exclusivity !== "multiple_offers" ? eligible.slice(0, 1) : eligible;
}
export function createEligibility(
  config: AppConfig,
  mongo: MongoService,
  discover?: MarketDiscovery,
) {
  async function authority(
    db: Db,
    identity: AuthenticatedUser,
    w: string,
    action: "read" | "update" | "approve",
    session?: ClientSession,
  ) {
    await icpAccess(db, config, identity, w, "read", session);
    const r = await resolveHvmContext(db, config, identity, session);
    r.authority.scopeFilter(r.context, action, {
      type: "ideal_customer_profiles",
      workspaceId: w,
    });
    return r.context.actor;
  }
  async function context(
    db: Db,
    w: string,
    policy: EligibilityPolicy,
    session?: ClientSession,
  ) {
    const segments = [];
    for (const segment of policy.segments) {
      const row = await db
        .collection("ideal_customer_profiles")
        .findOne(
          { workspaceId: w, id: segment.icpId, archived: false },
          { session },
        );
      const revision = await db.collection("hive_definition_revisions").findOne(
        {
          workspaceId: w,
          entityType: "ideal_customer_profiles",
          entityId: segment.icpId,
          revision: segment.revision,
        },
        { session },
      );
      if (
        !row ||
        row.approvedRevision !== segment.revision ||
        !revision?.snapshot?.offer
      )
        throw new HiveConflict(
          "Use current approved, offer-linked profiles for eligibility",
        );
      const link = revision.snapshot.offer;
      const offer = await db.collection("offers").findOne(
        {
          workspaceId: w,
          id: link.id,
          offeringId: row.offeringId,
          archived: false,
          approvedRevision: link.revision,
        },
        { session },
      );
      if (!offer)
        throw new HiveConflict(
          "An offer changed; review the dependent profile and policy",
        );
      segments.push({
        ...segment,
        offer: link,
        name: revision.snapshot.definition.name,
        profileType: revision.snapshot.definition.profileType,
      });
    }
    const ids = new Set(segments.map((s) => s.offer.id));
    if (
      policy.offerPriority.length !== ids.size ||
      policy.offerPriority.some((id) => !ids.has(id))
    )
      throw new HiveConflict(
        "Set the order for every offer represented by these profiles",
      );
    return segments;
  }
  async function read(identity: AuthenticatedUser, w: string) {
    const db = await mongo.database();
    await authority(db, identity, w, "read");
    const rows = await db
      .collection("events")
      .find({
        workspaceId: w,
        eventType: "icp_eligibility_policy",
        "payload.status": { $ne: "deleted" },
      })
      .sort({ createdAt: -1, id: -1 })
      .limit(100)
      .toArray();
    const activeRows = await db
      .collection("events")
      .find({
        workspaceId: w,
        eventType: "icp_eligibility_policy",
        "payload.status": "approved",
      })
      .sort({ updatedAt: -1, id: -1 })
      .limit(1)
      .toArray();
    const active = activeRows[0]?.id;
    if (activeRows[0] && !rows.some((row) => row.id === active))
      rows.push(activeRows[0]);
    return Promise.all(
      rows.map(async (row) => {
        let stale = false;
        try {
          await context(
            db,
            w,
            EligibilityPolicySchema.parse(row.payload.definition),
          );
        } catch {
          stale = true;
        }
        return {
          id: row.id,
          updatedAt: row.updatedAt.toISOString(),
          ...row.payload,
          stale,
          active: row.id === active,
        };
      }),
    );
  }
  async function discoveryPolicy(
    db: Db,
    w: string,
    id: string,
    session?: ClientSession,
  ) {
    const rows = await db
      .collection("events")
      .find(
        {
          workspaceId: w,
          eventType: "icp_eligibility_policy",
          "payload.status": "approved",
        },
        { session },
      )
      .sort({ updatedAt: -1, id: -1 })
      .limit(1)
      .toArray();
    if (rows[0]?.id !== id)
      throw new HiveConflict("Use the current approved policy");
    const segments = await context(
      db,
      w,
      EligibilityPolicySchema.parse(rows[0].payload.definition),
      session,
    );
    if (!segments.some((s) => s.profileType === "b2b"))
      throw new HiveConflict(
        "Public discovery finds organisations, not private consumers",
      );
  }
  async function discoveryRead(
    identity: AuthenticatedUser,
    w: string,
    id: string,
  ) {
    const db = await mongo.database();
    await authority(db, identity, w, "read");
    platformIdSchema("event").parse(id);
    const row = await db
      .collection("events")
      .findOne({ id, workspaceId: w, eventType: "icp_market_discovery" });
    if (!row) throw new HiveConflict("Research not found");
    let stale = false;
    try {
      await discoveryPolicy(db, w, row.payload.policyId);
    } catch {
      stale = true;
    }
    return {
      id: row.id,
      ...row.payload,
      stale,
      status:
        row.payload.status === "searching" &&
        Date.now() - row.createdAt.getTime() > 120000
          ? "interrupted"
          : row.payload.status,
    };
  }
  return {
    read,
    discoveryRead,
    async discoveryLatest(
      identity: AuthenticatedUser,
      w: string,
      policyId: string,
    ) {
      platformIdSchema("event").parse(policyId);
      const db = await mongo.database();
      await authority(db, identity, w, "read");
      const rows = await db
        .collection("events")
        .find({
          workspaceId: w,
          eventType: "icp_market_discovery",
          "payload.policyId": policyId,
        })
        .sort({ createdAt: -1, id: -1 })
        .limit(1)
        .toArray();
      return rows[0] ? discoveryRead(identity, w, rows[0].id) : null;
    },
    async discoveryStart(identity: AuthenticatedUser, w: string, raw: unknown) {
      const input = z
        .object({
          requestKey: z.string().uuid(),
          policyId: platformIdSchema("event"),
          query: z.string().trim().min(10).max(1500),
          publicQueryConfirmed: z.literal(true),
        })
        .strict()
        .parse(raw);
      if (!discover || !mongo.withTransaction)
        throw new Error("Discovery unavailable");
      const prepared = await mongo.withTransaction(async (db, session) => {
        const actor = await authority(db, identity, w, "update", session);
        const now = await lockIcpWorkspace(db, w, session);
        await discoveryPolicy(db, w, input.policyId, session);
        const previous = await db.collection("events").findOne(
          {
            workspaceId: w,
            eventType: "icp_market_discovery",
            "payload.requestKey": input.requestKey,
          },
          { session },
        );
        if (previous) {
          if (
            previous.payload.query !== input.query ||
            previous.payload.policyId !== input.policyId
          )
            throw new HiveConflict("Request changed");
          return { row: previous, fresh: false };
        }
        const active = await db.collection("events").findOne(
          {
            workspaceId: w,
            eventType: "icp_market_discovery",
            "payload.status": "searching",
            createdAt: { $gt: new Date(Date.now() - 120000) },
          },
          { session },
        );
        if (active) throw new HiveConflict("Research is already running");
        const row = EventSchema.parse({
          id: generatePlatformId("event"),
          workspaceId: w,
          createdAt: now,
          updatedAt: now,
          occurredAt: now,
          createdBy: actor,
          updatedBy: actor,
          eventType: "icp_market_discovery",
          payload: { ...input, status: "searching" },
        });
        await db.collection("events").insertOne(row, { session });
        return { row, fresh: true };
      });
      if (prepared.fresh)
        void (async () => {
          let result: Awaited<ReturnType<MarketDiscovery>> | undefined;
          try {
            result = await discover(input.query, AbortSignal.timeout(90000));
          } catch {
            /* Recoverable failure; no automatic provider retry. */
          }
          await mongo.withTransaction!(async (db, session) => {
            const now = await lockIcpWorkspace(db, w, session);
            const row = await db.collection("events").findOne(
              {
                id: prepared.row.id,
                workspaceId: w,
                eventType: "icp_market_discovery",
                "payload.status": "searching",
              },
              { session },
            );
            if (!row) return;
            // Retain usage and source-backed suggestions even if the policy changed. Read marks them stale.
            const payload = {
              ...row.payload,
              status: result ? "review" : "failed",
              ...(result ?? {}),
            };
            EventSchema.parse({ ...row, payload, updatedAt: now });
            await db
              .collection("events")
              .updateOne(
                { id: row.id, workspaceId: w, "payload.status": "searching" },
                { $set: { payload, updatedAt: now } },
                { session },
              );
          });
        })().catch(() => {
          /* A lost completion remains recoverably interrupted. */
        });
      return discoveryRead(identity, w, prepared.row.id);
    },
    async save(identity: AuthenticatedUser, w: string, raw: unknown) {
      const input = z
        .object({
          requestKey: z.string().uuid(),
          definition: EligibilityPolicySchema,
        })
        .strict()
        .parse(raw);
      if (!mongo.withTransaction) throw new Error("Transactions required");
      return mongo.withTransaction(async (db, session) => {
        const actor = await authority(db, identity, w, "update", session);
        const now = await lockIcpWorkspace(db, w, session);
        const prior = await db.collection("events").findOne(
          {
            workspaceId: w,
            eventType: "icp_eligibility_policy",
            "payload.requestKey": input.requestKey,
          },
          { session },
        );
        if (prior) {
          if (prior.payload.status === "deleted")
            throw new HiveConflict("This draft was deleted; start a new draft");
          if (
            JSON.stringify(prior.payload.definition) !==
            JSON.stringify(input.definition)
          )
            throw new HiveConflict("Request key reused");
          return {
            id: prior.id,
            updatedAt: prior.updatedAt.toISOString(),
            ...prior.payload,
          };
        }
        const segments = await context(db, w, input.definition, session);
        const row = EventSchema.parse({
          id: generatePlatformId("event"),
          workspaceId: w,
          createdAt: now,
          updatedAt: now,
          occurredAt: now,
          createdBy: actor,
          updatedBy: actor,
          eventType: "icp_eligibility_policy",
          payload: { ...input, status: "draft", segments },
        });
        await db.collection("events").insertOne(row, { session });
        return {
          id: row.id,
          updatedAt: row.updatedAt.toISOString(),
          ...row.payload,
        };
      });
    },
    async updateDraft(identity: AuthenticatedUser, w: string, raw: unknown) {
      const input = z
        .object({
          id: platformIdSchema("event"),
          expectedUpdatedAt: z.string().datetime(),
          requestKey: z.string().uuid(),
          definition: EligibilityPolicySchema,
        })
        .strict()
        .parse(raw);
      if (!mongo.withTransaction) throw new Error("Transactions required");
      return mongo.withTransaction(async (db, session) => {
        const actor = await authority(db, identity, w, "update", session);
        const now = await lockIcpWorkspace(db, w, session);
        const filter = {
          workspaceId: w,
          id: input.id,
          eventType: "icp_eligibility_policy",
        };
        const row = await db.collection("events").findOne(filter, { session });
        if (!row || row.payload.status !== "draft")
          throw new HiveConflict(
            "Only drafts can be edited; copy an approved policy to a new version",
          );
        if (row.payload.lastEdit?.requestKey === input.requestKey) {
          if (
            JSON.stringify(row.payload.definition) !==
              JSON.stringify(input.definition) ||
            row.payload.lastEdit.expectedUpdatedAt !== input.expectedUpdatedAt
          )
            throw new HiveConflict("Request key reused");
          return {
            id: row.id,
            updatedAt: row.updatedAt.toISOString(),
            ...row.payload,
          };
        }
        if (row.updatedAt.toISOString() !== input.expectedUpdatedAt)
          throw new HiveConflict("Draft changed; reload before editing");
        const segments = await context(db, w, input.definition, session);
        await db.collection("events").insertOne(
          EventSchema.parse({
            id: generatePlatformId("event"),
            workspaceId: w,
            createdAt: now,
            updatedAt: now,
            occurredAt: now,
            createdBy: actor,
            updatedBy: actor,
            eventType: "icp_eligibility_draft_edit",
            payload: {
              policyId: row.id,
              previousDefinition: row.payload.definition,
              definition: input.definition,
              requestKey: input.requestKey,
            },
          }),
          { session },
        );
        const payload = {
          ...row.payload,
          definition: input.definition,
          segments,
          lastEdit: {
            requestKey: input.requestKey,
            expectedUpdatedAt: input.expectedUpdatedAt,
          },
        };
        const changed = await db
          .collection("events")
          .updateOne(
            { ...filter, updatedAt: row.updatedAt, "payload.status": "draft" },
            { $set: { payload, updatedAt: now, updatedBy: actor } },
            { session },
          );
        if (!changed.matchedCount) throw new HiveConflict("Draft changed");
        return { id: row.id, updatedAt: now.toISOString(), ...payload };
      });
    },
    async deleteDrafts(identity: AuthenticatedUser, w: string, raw: unknown) {
      const input = z
        .object({
          items: z
            .array(
              z
                .object({
                  id: platformIdSchema("event"),
                  expectedUpdatedAt: z.string().datetime(),
                })
                .strict(),
            )
            .min(1)
            .max(100),
          confirmation: z.literal("DELETE"),
        })
        .strict()
        .parse(raw);
      if (new Set(input.items.map((x) => x.id)).size !== input.items.length)
        throw new HiveConflict("Choose each draft once");
      if (!mongo.withTransaction) throw new Error("Transactions required");
      // Removing a draft is an update to its lifecycle; retain audit evidence, never delete approved policy history.
      await authority(await mongo.database(), identity, w, "update");
      const results = [];
      for (const item of input.items) {
        const result = await mongo.withTransaction(async (db, session) => {
          const actor = await authority(db, identity, w, "update", session);
          const now = await lockIcpWorkspace(db, w, session);
          const filter = {
            workspaceId: w,
            id: item.id,
            eventType: "icp_eligibility_policy",
          };
          const row = await db
            .collection("events")
            .findOne(filter, { session });
          if (!row) return { id: item.id, status: "not_found" };
          if (row.payload.status === "deleted")
            return { id: item.id, status: "deleted" };
          if (row.payload.status !== "draft")
            return { id: item.id, status: "protected" };
          if (row.updatedAt.toISOString() !== item.expectedUpdatedAt)
            return { id: item.id, status: "changed" };
          await db.collection("events").insertOne(
            EventSchema.parse({
              id: generatePlatformId("event"),
              workspaceId: w,
              createdAt: now,
              updatedAt: now,
              occurredAt: now,
              createdBy: actor,
              updatedBy: actor,
              eventType: "icp_eligibility_draft_deleted",
              payload: { policyId: row.id, definition: row.payload.definition },
            }),
            { session },
          );
          const changed = await db.collection("events").updateOne(
            {
              ...filter,
              updatedAt: row.updatedAt,
              "payload.status": "draft",
            },
            {
              $set: {
                "payload.status": "deleted",
                updatedAt: now,
                updatedBy: actor,
              },
            },
            { session },
          );
          if (!changed.matchedCount) throw new HiveConflict("Draft changed");
          return { id: item.id, status: "deleted" };
        });
        results.push(result);
      }
      return { results };
    },
    async approve(identity: AuthenticatedUser, w: string, raw: unknown) {
      const input = z
        .object({
          id: platformIdSchema("event"),
          expectedUpdatedAt: z.string().datetime(),
        })
        .strict()
        .parse(raw);
      if (!mongo.withTransaction) throw new Error("Transactions required");
      await mongo.withTransaction(async (db, session) => {
        const actor = await authority(db, identity, w, "approve", session);
        const now = await lockIcpWorkspace(db, w, session);
        const row = await db.collection("events").findOne(
          {
            workspaceId: w,
            id: input.id,
            eventType: "icp_eligibility_policy",
          },
          { session },
        );
        if (
          !row ||
          row.updatedAt.toISOString() !== input.expectedUpdatedAt ||
          row.payload.status !== "draft"
        )
          throw new HiveConflict("Policy changed; reload before approving");
        await context(
          db,
          w,
          EligibilityPolicySchema.parse(row.payload.definition),
          session,
        );
        await db.collection("events").insertOne(
          EventSchema.parse({
            id: generatePlatformId("event"),
            workspaceId: w,
            createdAt: now,
            updatedAt: now,
            occurredAt: now,
            createdBy: actor,
            updatedBy: actor,
            eventType: "icp_eligibility_approval",
            payload: {
              policyId: row.id,
              definition: row.payload.definition,
              segments: row.payload.segments,
            },
          }),
          { session },
        );
        await db.collection("events").updateOne(
          { workspaceId: w, id: row.id },
          {
            $set: {
              "payload.status": "approved",
              updatedAt: now,
              updatedBy: actor,
            },
          },
          { session },
        );
      });
      return read(identity, w);
    },
    async identify(identity: AuthenticatedUser, w: string, raw: unknown) {
      const input = z
        .object({
          policyId: platformIdSchema("event"),
          offset: z.coerce.number().int().min(0).max(1000000).default(0),
          recordType: z
            .enum(["organisations", "people"])
            .default("organisations"),
        })
        .strict()
        .parse(raw);
      const db = await mongo.database();
      await authority(db, identity, w, "read");
      const r = await resolveHvmContext(db, config, identity);
      r.authority.scopeFilter(r.context, "read", {
        type: "organisations",
        workspaceId: w,
      });
      r.authority.scopeFilter(r.context, "read", {
        type: "people",
        workspaceId: w,
      });
      r.authority.scopeFilter(r.context, "read", {
        type: "organisation_relationships",
        workspaceId: w,
      });
      const row = await db.collection("events").findOne({
        workspaceId: w,
        id: input.policyId,
        eventType: "icp_eligibility_policy",
        "payload.status": "approved",
      });
      if (!row)
        throw new HiveConflict(
          "Approve a policy before identifying eligible organisations",
        );
      const active = await db
        .collection("events")
        .find({
          workspaceId: w,
          eventType: "icp_eligibility_policy",
          "payload.status": "approved",
        })
        .sort({ updatedAt: -1, id: -1 })
        .limit(1)
        .toArray();
      if (active[0]?.id !== row.id)
        throw new HiveConflict(
          "This policy has been superseded; use the current approved policy",
        );
      const policy = EligibilityPolicySchema.parse(row.payload.definition);
      const segments = await context(db, w, policy);
      if (input.recordType === "people") {
        const consumers = segments.filter(
          (s) => s.profileType === "b2c" || s.profileType === "d2c",
        );
        const records = consumers.length
          ? await db
              .collection("people")
              .find(
                {
                  workspaceId: w,
                  archived: { $ne: true },
                  $or: [
                    { lifecycleStatus: "active" },
                    { lifecycleStatus: { $exists: false } },
                  ],
                },
                {
                  projection: {
                    id: 1,
                    displayName: 1,
                    firstName: 1,
                    lastName: 1,
                    preferredLanguage: 1,
                    timezone: 1,
                  },
                },
              )
              .sort({ id: 1 })
              .skip(input.offset)
              .limit(51)
              .toArray()
          : [];
        const factRows = records.length
          ? await db
              .collection("events")
              .find({
                workspaceId: w,
                eventType: "consumer_characteristics",
                personId: { $in: records.slice(0, 50).map((p) => p.id) },
              })
              .toArray()
          : [];
        const factsByPerson = new Map(
          factRows.map((r) => [
            r.personId,
            ConsumerFactsSchema.safeParse(r.payload.facts),
          ]),
        );
        const organisationOnly =
          policy.exclusivity === "one_offer_per_organisation";
        return {
          policyId: row.id,
          policyUpdatedAt: row.updatedAt.toISOString(),
          recordType: "people" as const,
          items: records.slice(0, 50).map((person) => {
            const parsed = factsByPerson.get(person.id);
            const facts = parsed?.success ? parsed.data : undefined;
            const evidence = {
              ...person,
              consumerCountry: facts?.country,
              consumerRegion: facts?.region,
              consumerNeeds: facts?.needs,
              consumerInterests: facts?.interests,
              purchaseStage: facts?.purchaseStage,
            };

            const fits = consumers.map((segment) => ({
              icpId: segment.icpId,
              icpRevision: segment.revision,
              offer: segment.offer,
              ...assessConsumerFit(evidence, segment.rules),
            }));
            const eligible = policy.offerPriority.filter((id) =>
              fits.some((f) => f.offer.id === id && f.fit === "matches"),
            );
            return {
              id: person.id,
              name:
                person.displayName ||
                [person.firstName, person.lastName].filter(Boolean).join(" "),
              preferredLanguage: person.preferredLanguage ?? null,
              timezone: person.timezone ?? null,
              consumerObservedOn: facts?.observedOn ?? null,
              fits,
              eligibleOfferIds: eligible,
              permittedOfferIds: organisationOnly
                ? []
                : permittedOffers(eligible, policy.exclusivity),
              contacts: [],
              moreContacts: false,
            };
          }),
          hasMore: records.length > 50,
          offset: input.offset,
          limit: 50,
          campaignSelection: null,
          notice: !consumers.length
            ? "This policy has no consumer segments. Add an approved B2C or D2C profile to assess people."
            : organisationOnly
              ? "Consumer fit is shown, but this policy only defines organisation exclusivity. Review and approve a policy allowing multiple offers or one offer per customer before permitting consumer offers."
              : "Consumer fit uses recorded characteristics against approved rules. Check the observation date and source in the contact record before acting. Missing facts require review. Matching never grants permission to contact or selects outreach.",
        };
      }
      const records = await db
        .collection("organisations")
        .find(
          {
            workspaceId: w,
            archived: { $ne: true },
            "source.system": { $ne: ESOS_SUPPORTING_SOURCE },
          },
          {
            projection: {
              id: 1,
              name: 1,
              industry: 1,
              country: 1,
              region: 1,
              size: 1,
              updatedAt: 1,
            },
          },
        )
        .sort({ id: 1 })
        .skip(input.offset)
        .limit(51)
        .toArray();
      const items = [];
      for (const record of records.slice(0, 50)) {
        const fits = segments.map((segment) => ({
          icpId: segment.icpId,
          icpRevision: segment.revision,
          offer: segment.offer,
          ...(segment.profileType === "b2b"
            ? assessFit(
                record,
                segment.rules.filter((r) => !contactRuleFields.has(r.field)),
              )
            : {
                fit: "needs_review",
                reasons: [
                  "Consumer fit cannot be established from organisation records",
                ],
              }),
        }));
        const eligible = policy.offerPriority.filter((id) =>
          fits.some((f) => f.offer.id === id && f.fit === "matches"),
        );
        // Organisation-level precedence applies to all contacts, never one offer per person.
        const permitted = permittedOffers(eligible, policy.exclusivity);
        const links = await db
          .collection("organisation_relationships")
          .find({
            workspaceId: w,
            organisationId: record.id,
            current: true,
            archived: { $ne: true },
          })
          .limit(21)
          .toArray();
        const people = [];
        for (const link of links.slice(0, 20)) {
          const person = await db.collection("people").findOne(
            { workspaceId: w, id: link.personId, archived: { $ne: true } },
            {
              projection: {
                id: 1,
                displayName: 1,
                firstName: 1,
                lastName: 1,
              },
            },
          );
          if (person) {
            const contactFits = segments
              .filter((s) => s.profileType === "b2b")
              .map((s) => ({
                icpId: s.icpId,
                offerId: s.offer.id,
                ...assessFit(
                  link,
                  s.rules.filter((r) => contactRuleFields.has(r.field)),
                ),
              }));
            const contactPermitted = permitted.filter((id) =>
              contactFits.some(
                (f) =>
                  f.offerId === id &&
                  f.fit === "matches" &&
                  fits.some(
                    (org) => org.icpId === f.icpId && org.fit === "matches",
                  ),
              ),
            );
            people.push({
              id: person.id,
              name:
                person.displayName ||
                [person.firstName, person.lastName].filter(Boolean).join(" "),
              jobTitle: link.jobTitle ?? null,
              roleFit: contactFits.some((f) => f.fit === "matches")
                ? "matches"
                : contactFits.length &&
                    contactFits.every((f) => f.fit === "not_fit")
                  ? "not_fit"
                  : "needs_review",
              fits: contactFits,
              permittedOfferIds: contactPermitted,
            });
          }
        }
        items.push({
          id: record.id,
          name: record.name,
          fits,
          eligibleOfferIds: eligible,
          permittedOfferIds: permitted,
          contacts: people,
          moreContacts: links.length > 20,
        });
      }
      return {
        policyId: row.id,
        policyUpdatedAt: row.updatedAt.toISOString(),
        recordType: "organisations" as const,
        items,
        hasMore: records.length > 50,
        offset: input.offset,
        limit: 50,
        campaignSelection: null,
        notice:
          "Strategic eligibility from recorded Hive fields. Contact roles use separately approved job title, department and seniority rules; missing facts require review. No campaign or outreach has been selected.",
      };
    },
  };
}
