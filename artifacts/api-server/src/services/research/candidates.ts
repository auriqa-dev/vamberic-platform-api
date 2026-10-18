import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { Document } from "mongodb";
import type { AppConfig } from "../../config";
import type { AuthenticatedUser } from "../../middlewares/auth";
import type { MongoService } from "../mongo";
import {
  EventSchema,
  generatePlatformId,
  platformIdSchema,
} from "../../domain";
import { contentContext } from "../content-strategy/context";
import { contentAccess } from "../content-strategy/application";
import { contactContextAccess } from "../contact-context";
import { readOrganisationDossier } from "./organisation-dossier";
import { createContactManagement } from "../contact-management";
import { lockIcpWorkspace } from "../icp/access";
import { HiveConflict } from "../hive-definitions";
import {
  employmentReview,
  verifyLushaMatch,
  normaliseIdentity,
} from "./candidate-policy";
import { createLushaConnection } from "../lusha/connection";
import {
  createLushaProvider,
  LushaFailure,
  type LushaProvider,
} from "../lusha/provider";
import type { LushaSecrets } from "../lusha/secrets";
export class ResearchActionConflict extends HiveConflict {}
const digest = (v: unknown) =>
  createHash("sha256").update(JSON.stringify(v)).digest("hex");
const event = (w: string, type: string, payload: Document) => {
  const now = new Date();
  return EventSchema.parse({
    id: generatePlatformId("event"),
    workspaceId: w,
    eventType: type,
    createdAt: now,
    updatedAt: now,
    occurredAt: now,
    payload,
  });
};
export function createResearchCandidates(
  config: AppConfig,
  mongo: MongoService,
  provider: LushaProvider = createLushaProvider(),
  secrets?: LushaSecrets,
) {
  const connection = createLushaConnection(config, mongo, provider, secrets),
    records = createContactManagement(config, mongo);
  async function candidate(identity: AuthenticatedUser, w: string, id: string) {
    platformIdSchema("event").parse(id);
    const db = await mongo.database();
    await contentAccess(db, config, identity, w, "update");
    await contactContextAccess(db, config, identity, w, "read");
    const row = await db
      .collection("events")
      .findOne({ workspaceId: w, id, eventType: "research_discovery" });
    if (
      !row?.payload.result.candidateId ||
      (row.payload.expiresAt <= new Date().toISOString() &&
        row.payload.result.status !== "promoted") ||
      ["rejected", "expired"].includes(row.payload.result.status)
    )
      throw new ResearchActionConflict("Candidate unavailable or expired.");
    const job = await db.collection("events").findOne({
      workspaceId: w,
      id: row.payload.jobId,
      eventType: "research_job",
      archived: { $ne: true },
    });
    if (!job || job.payload.status === "cancelled")
      throw new ResearchActionConflict("Research was cancelled or removed.");
    if (job.payload.request.campaignVersion) {
      const campaignId = job.payload.request.destinations?.find(
        (d: Document) => d.type === "campaign",
      )?.id;
      const campaign = await db.collection("events").findOne({
        workspaceId: w,
        campaignId,
        eventType: "campaign_setup",
        archived: { $ne: true },
        "payload.version": job.payload.request.campaignVersion,
        "payload.status": "ready",
      });
      if (!campaign)
        throw new ResearchActionConflict(
          "The campaign changed. Review its research scope before continuing.",
        );
    }
    const context = await contentContext(
      db,
      config,
      identity,
      w,
      job.payload.request.scope,
    );

    return { db, row, job, context, result: row.payload.result as Document };
  }
  async function organisations(
    db: Awaited<ReturnType<typeof candidate>>["db"],
    w: string,
    domain: string,
  ) {
    return db
      .collection("organisations")
      .find({
        workspaceId: w,
        archived: { $ne: true },
        $or: [{ domain }, { normalizedDomain: domain }],
      })
      .limit(2)
      .toArray();
  }
  async function update(w: string, id: string, values: Document) {
    if (!mongo.withTransaction) throw new Error("Transactions required");
    const transitions: Record<string, string[]> = {
      selected: ["candidate", "matched", "selected"],
      verified: ["candidate", "verified"],
      rejected: ["candidate", "selected", "verified", "enriching"],
      enriching: ["verified"],
      ready: ["enriching"],
      needs_review: ["enriching"],
      matched: ["verified", "ready"],
      promoted: ["selected", "matched"],
    };
    await mongo.withTransaction(async (db, session) => {
      await lockIcpWorkspace(db, w, session);
      const row = await db
        .collection("events")
        .findOne(
          { workspaceId: w, id, eventType: "research_discovery" },
          { session },
        );
      if (
        !row ||
        row.payload.expiresAt <= new Date().toISOString() ||
        !transitions[values.status]?.includes(row.payload.result.status)
      )
        throw new ResearchActionConflict(
          "Candidate changed or expired. Refresh before continuing.",
        );
      const parent = await db.collection("events").findOne(
        {
          workspaceId: w,
          id: row.payload.jobId,
          eventType: "research_job",
          archived: { $ne: true },
        },
        { session },
      );
      if (!parent || parent.payload.status === "cancelled")
        throw new ResearchActionConflict("Research is no longer available.");
      await db.collection("events").updateOne(
        {
          workspaceId: w,
          id,
          "payload.result.status": row.payload.result.status,
        },
        {
          $set: {
            ...Object.fromEntries(
              Object.entries(values).map(([k, v]) => [
                `payload.result.${k}`,
                v,
              ]),
            ),
            updatedAt: new Date(),
          },
          ...(values.status === "rejected"
            ? {
                $unset: {
                  "payload.result.employmentReview": "",
                  "payload.result.reviewedBy": "",
                  "payload.result.verifiedEmail": "",
                },
              }
            : {}),
        },
        { session },
      );
    });
  }
  return {
    async peopleRequest(identity: AuthenticatedUser, w: string, id: string) {
      const { row, result, context } = await candidate(identity, w, id);
      if (
        !["selected", "promoted", "matched", "candidate"].includes(
          result.status,
        )
      )
        throw new ResearchActionConflict("Select a current candidate first.");
      const roles = [
        ...new Set(
          context.buyers.flatMap(
            (b) =>
              b.snapshot.definition?.jobTitles ?? b.snapshot.jobTitles ?? [],
          ),
        ),
      ]
        .filter((v): v is string => typeof v === "string")
        .slice(0, 20);
      if (!roles.length)
        throw new ResearchActionConflict(
          "Approve buyer job titles in the selected ICP before researching people.",
        );
      const db = await mongo.database(),
        matches = await organisations(db, w, result.details.domain);
      if (matches.length !== 1)
        throw new ResearchActionConflict(
          "Save or resolve the organisation first.",
        );
      return {
        requestKey: randomUUID(),
        objective: `${result.kind === "person" ? `Verify current employment of ${result.details.firstName} ${result.details.lastName}.` : "Find current professional contacts"} at ${result.details.domain} in these roles: ${roles.join(", ")}. Establish employment using dated public sources.`,
        type: "contact_discovery",
        scope: row.payload.scope,
        sourceMode: "web",
        urls: [],
        destinations: [{ type: "organisations", id: matches[0]!.id }],
        freshnessDays: 30,
      };
    },
    async supplement(identity: AuthenticatedUser, w: string, id: string) {
      const { db, row, result, context } = await candidate(identity, w, id);
      if (
        result.kind !== "organisation" ||
        !["selected", "promoted", "matched"].includes(result.status)
      )
        throw new ResearchActionConflict("Select an organisation first.");
      const matches = await organisations(db, w, result.details.domain);
      if (matches.length !== 1)
        throw new ResearchActionConflict(
          "Save or resolve the organisation first.",
        );
      const dossier = await readOrganisationDossier(db, w, matches[0]!.id);
      if (
        dossier.hasMore ||
        dossier.context.lifecycle === "customer" ||
        dossier.context.sourceCurrentCustomer ||
        dossier.context.sourceRestrictions.length ||
        dossier.context.inheritedRestrictions.length ||
        dossier.context.controls.doNotContact ||
        dossier.context.controls.commercialExclusion ||
        dossier.context.controls.marketingSuppressed ||
        dossier.context.controls.oneToOneSuppressed
      )
        throw new ResearchActionConflict(
          "Review the organisation's history and restrictions before paid discovery.",
        );
      const webJobs = await db
        .collection("events")
        .find({
          workspaceId: w,
          eventType: "research_job",
          archived: { $ne: true },
          "payload.status": "completed",
          "payload.request.type": "contact_discovery",
          "payload.request.sourceMode": "web",
        })
        .toArray();
      const webFirst = webJobs.some(
        (j) =>
          JSON.stringify(j.payload.request.scope) ===
            JSON.stringify(row.payload.scope) &&
          j.payload.request.destinations?.some(
            (d: Document) =>
              d.type === "organisations" && d.id === matches[0]!.id,
          ),
      );
      if (!webFirst)
        throw new ResearchActionConflict(
          "Complete public-source people research for this organisation before supplementary Lusha discovery.",
        );
      const roles = [
        ...new Set(
          context.buyers.flatMap(
            (b) =>
              b.snapshot.definition?.jobTitles ?? b.snapshot.jobTitles ?? [],
          ),
        ),
      ]
        .filter((v): v is string => typeof v === "string")
        .slice(0, 20);
      if (!roles.length)
        throw new ResearchActionConflict(
          "Approve buyer job titles in the selected ICP first.",
        );
      const access = await connection.active(identity, w, "discovery"),
        lookupKey = digest([
          w,
          access.row.id,
          "supplement",
          result.details.domain,
          roles,
        ]);
      if (!mongo.withTransaction) throw new Error("Transactions required");
      const ledger = await mongo.withTransaction(async (db, session) => {
        await lockIcpWorkspace(db, w, session);
        const old = await db.collection("events").findOne(
          {
            workspaceId: w,
            eventType: "lusha_lookup",
            "payload.lookupKey": lookupKey,
          },
          { session },
        );
        if (old)
          throw new ResearchActionConflict(
            "Supplementary research already requested. Review the previous outcome.",
          );
        const record = event(w, "lusha_lookup", {
          lookupKey,
          candidateId: id,
          integrationId: access.row.id,
          status: "supplementing",
          creditsCharged: null,
          expiresAt: row.payload.expiresAt,
        });
        await db.collection("events").insertOne(record, { session });
        return record;
      });
      try {
        const fresh = await connection.active(identity, w, "discovery");
        if (fresh.row.updatedAt.getTime() !== access.row.updatedAt.getTime())
          throw new ResearchActionConflict("Connection changed.");
        const response = await provider.supplement(
          fresh.key,
          result.details.domain,
          roles,
        );
        await db.collection("events").updateOne(
          { workspaceId: w, id: ledger.id },
          {
            $set: {
              "payload.creditsCharged": response.creditsCharged,
              "payload.status": "received",
              updatedAt: new Date(),
            },
          },
        );
        await candidate(identity, w, id);
        await connection.active(identity, w, "discovery");
        let count = 0;
        for (const person of response.contacts) {
          if (
            !person.firstName ||
            !person.lastName ||
            normaliseIdentity(person.company?.domain ?? "").replace(
              /^www\./,
              "",
            ) !== result.details.domain
          )
            continue;
          if (
            dossier.contacts.some(
              (p) =>
                normaliseIdentity(p.firstName ?? "") ===
                  normaliseIdentity(person.firstName!) &&
                normaliseIdentity(p.lastName ?? "") ===
                  normaliseIdentity(person.lastName!),
            )
          )
            continue;
          const duplicate = await db.collection("events").findOne({
            workspaceId: w,
            eventType: "research_discovery",
            "payload.result.details.domain": result.details.domain,
            "payload.result.details.firstName": person.firstName,
            "payload.result.details.lastName": person.lastName,
          });
          if (duplicate) continue;
          const e = event(w, "research_discovery", {
            jobId: row.payload.jobId,
            scope: row.payload.scope,
            expiresAt: row.payload.expiresAt,
            result: {
              kind: "person",
              type: "people",
              status: "candidate",
              name: `${person.firstName} ${person.lastName}`,
              reason:
                "Lusha suggestion: independent employment evidence is still required",
              evidenceIds: [],
              details: {
                firstName: person.firstName,
                lastName: person.lastName,
                title: person.jobTitle?.title ?? "",
                domain: result.details.domain,
                companyWebsite: `https://${result.details.domain}`,
                linkedinUrl: person.socialLinks?.linkedin ?? "",
              },
              lookupId: ledger.id,
            },
          });
          (e.payload.result as Document).candidateId = e.id;
          await db.collection("events").insertOne(e);
          count++;
        }
        await db
          .collection("events")
          .updateOne(
            { workspaceId: w, id: ledger.id },
            { $set: { "payload.status": "completed", updatedAt: new Date() } },
          );
        return { count };
      } catch (e) {
        await db.collection("events").updateOne(
          { workspaceId: w, id: ledger.id },
          {
            $set: {
              "payload.status": "needs_review",
              "payload.chargeUnknown":
                e instanceof LushaFailure ? e.chargeUnknown : true,
              updatedAt: new Date(),
            },
          },
        );
        throw e;
      }
    },
    async dossier(identity: AuthenticatedUser, w: string, id: string) {
      const { db, result } = await candidate(identity, w, id),
        matches = await organisations(db, w, result.details.domain);
      if (matches.length !== 1)
        return {
          organisation: null,
          matchCount: matches.length,
          executionAuthorised: false,
        };
      return readOrganisationDossier(db, w, matches[0]!.id);
    },
    async review(
      identity: AuthenticatedUser,
      w: string,
      id: string,
      raw: unknown,
    ) {
      const input = z
        .object({
          decision: z.enum(["select", "reject", "verify_employment"]),
          review: employmentReview.optional(),
        })
        .strict()
        .parse(raw);
      const { db, row, result } = await candidate(identity, w, id);
      if (["promoted", "ready", "enriching"].includes(result.status))
        throw new ResearchActionConflict(
          "This candidate has already progressed.",
        );
      if (input.decision === "reject") {
        await update(w, id, {
          status: "rejected",
          details: {},
          name: "Rejected candidate",
          reason: "Rejected by reviewer",
          evidenceIds: [],
        });
        return { status: "rejected" };
      }
      if (result.kind === "organisation") {
        await update(w, id, { status: "selected" });
        return { status: "selected" };
      }
      const review = employmentReview.parse(input.review),
        time = new Date(review.observedAt).getTime();
      if (time > Date.now() || time < Date.now() - 30 * 86400000)
        throw new ResearchActionConflict(
          "Check current employment using evidence observed within the last 30 days.",
        );
      const evidence = await db
        .collection("events")
        .find({
          workspaceId: w,
          eventType: "research_evidence",
          id: { $in: result.evidenceIds },
        })
        .toArray();
      if (
        !evidence.some(
          (e) =>
            e.payload.url === review.sourceUrl &&
            e.payload.extract.includes(review.quote),
        )
      )
        throw new ResearchActionConflict(
          "Select a quotation from this candidate's retrieved evidence.",
        );
      const orgs = await organisations(db, w, result.details.domain);
      if (orgs.length !== 1)
        throw new ResearchActionConflict(
          "Select and save the organisation first.",
        );
      await update(w, id, {
        status: "verified",
        employmentReview: review,
        organisationId: orgs[0]!.id,
        reviewedBy: identity.subject,
        reviewedAt: new Date().toISOString(),
        reason:
          "Employment and role reviewed; email enrichment can be requested",
      });
      return { status: "verified", jobId: row.payload.jobId };
    },
    async enrich(identity: AuthenticatedUser, w: string, id: string) {
      const { db, row, result } = await candidate(identity, w, id);
      if (
        result.kind !== "person" ||
        !["verified", "ready"].includes(result.status)
      )
        throw new ResearchActionConflict(
          "Review current employment and role first.",
        );
      if (
        new Date(result.employmentReview.observedAt).getTime() <
        Date.now() - 30 * 86400000
      )
        throw new ResearchActionConflict(
          "Employment evidence needs refreshing.",
        );
      const orgs = await organisations(db, w, result.details.domain);
      if (orgs.length !== 1)
        throw new ResearchActionConflict("Organisation identity needs review.");
      const dossier = await readOrganisationDossier(db, w, orgs[0]!.id);
      if (
        dossier.hasMore ||
        dossier.context.lifecycle === "customer" ||
        dossier.context.sourceCurrentCustomer ||
        dossier.context.sourceRestrictions.length ||
        dossier.context.inheritedRestrictions.length
      )
        throw new ResearchActionConflict(
          "Review the full organisation history before enrichment.",
        );
      const existing = dossier.contacts.filter(
        (p) =>
          normaliseIdentity(p.firstName ?? "") ===
            normaliseIdentity(result.details.firstName) &&
          normaliseIdentity(p.lastName ?? "") ===
            normaliseIdentity(result.details.lastName),
      );
      if (existing.length) {
        await update(w, id, {
          status: "matched",
          id: existing.length === 1 ? existing[0]!.id : null,
          reason:
            "Existing contact found. Review its details and restrictions; no credits spent.",
        });
        return { status: "matched" };
      }
      if (
        dossier.context.controls.doNotContact ||
        dossier.context.controls.commercialExclusion ||
        dossier.context.controls.marketingSuppressed ||
        dossier.context.controls.oneToOneSuppressed
      )
        throw new ResearchActionConflict(
          "Organisation restrictions require review before paid research.",
        );
      const { row: integration } = await connection.active(
        identity,
        w,
        "enrichment",
      );
      const lookupKey = digest([
        w,
        integration.id,
        normaliseIdentity(result.details.firstName),
        normaliseIdentity(result.details.lastName),
        result.details.domain,
      ]);
      if (!mongo.withTransaction) throw new Error("Transactions required");
      const ledger = await mongo.withTransaction(async (db, session) => {
        await contentAccess(db, config, identity, w, "update", session);
        await lockIcpWorkspace(db, w, session);
        const old = await db.collection("events").findOne(
          {
            workspaceId: w,
            eventType: "lusha_lookup",
            "payload.lookupKey": lookupKey,
          },
          { session },
        );
        if (old) return old;
        const e = event(w, "lusha_lookup", {
          lookupKey,
          candidateId: id,
          integrationId: integration.id,
          status: "reserved",
          creditsCharged: 0,
          expiresAt: row.payload.expiresAt,
        });
        await db.collection("events").insertOne(e, { session });
        return e;
      });
      if (
        ledger.payload.candidateId !== id ||
        ledger.payload.status !== "reserved"
      )
        throw new ResearchActionConflict(
          "This person already has a lookup. Review the previous outcome; it will not be charged again automatically.",
        );
      const claimed = await db
        .collection("events")
        .updateOne(
          { workspaceId: w, id: ledger.id, "payload.status": "reserved" },
          { $set: { "payload.status": "searching", updatedAt: new Date() } },
        );
      if (!claimed.matchedCount)
        throw new ResearchActionConflict("Lookup already in progress.");
      await update(w, id, {
        status: "enriching",
        reason: "Finding the matching Lusha profile",
      });
      let credits: number | null = 0;
      async function account(value: number | null, phase: string) {
        credits = credits === null || value === null ? null : credits + value;
        await db.collection("events").updateOne(
          { workspaceId: w, id: ledger.id },
          {
            $set: {
              "payload.creditsCharged": credits,
              "payload.status": phase,
              updatedAt: new Date(),
            },
          },
        );
      }
      try {
        await candidate(identity, w, id);
        const searchAccess = await connection.active(identity, w, "enrichment");
        if (
          searchAccess.row.updatedAt.getTime() !==
          integration.updatedAt.getTime()
        )
          throw new ResearchActionConflict("Connection changed.");
        const found = await provider.search(searchAccess.key, {
          firstName: result.details.firstName,
          lastName: result.details.lastName,
          companyDomain: result.details.domain,
        });
        await account(found.creditsCharged, "searched");
        const matches = found.contacts.filter(
          (c) => verifyLushaMatch(result.details, c).matched,
        );
        if (matches.length !== 1) {
          await update(w, id, {
            status: "rejected",
            details: {},
            name: "Unmatched candidate",
            reason: "Lusha could not identify one matching person",
            evidenceIds: [],
          });
          await account(0, "completed");
          return { status: "rejected" };
        }
        await candidate(identity, w, id);
        const revealAccess = await connection.active(identity, w, "enrichment");
        if (
          revealAccess.row.updatedAt.getTime() !==
          integration.updatedAt.getTime()
        )
          throw new ResearchActionConflict("Connection changed.");
        await db
          .collection("events")
          .updateOne(
            { workspaceId: w, id: ledger.id },
            { $set: { "payload.status": "revealing", updatedAt: new Date() } },
          );
        const enriched = await provider.enrich(
          revealAccess.key,
          matches[0]!.id,
        );
        await account(enriched.creditsCharged, "revealed");
        const accepted =
          enriched.contacts.length === 1
            ? verifyLushaMatch(result.details, enriched.contacts[0])
            : null;
        if (!accepted?.email) {
          await update(w, id, {
            status: "rejected",
            details: {},
            name: "Candidate without an A+ email",
            reason: "No matching Lusha A+ business email; no contact created",
            evidenceIds: [],
          });
          await account(0, "completed");
          return { status: "rejected" };
        }
        await candidate(identity, w, id);
        await connection.active(identity, w, "enrichment");
        await update(w, id, {
          status: "ready",
          verifiedEmail: accepted.email.email.toLowerCase(),
          emailGrade: "A+",
          emailVerifiedAt: new Date().toISOString(),
          lookupId: ledger.id,
          reason: "A+ business email available; ready to save",
        });
        await account(0, "completed");
        return { status: "ready" };
      } catch (e) {
        await db.collection("events").updateOne(
          { workspaceId: w, id: ledger.id },
          {
            $set: {
              "payload.status": "needs_review",
              "payload.chargeUnknown":
                e instanceof LushaFailure ? e.chargeUnknown : true,
              updatedAt: new Date(),
            },
          },
        );
        await update(w, id, {
          status: "needs_review",
          reason:
            "Lookup interrupted. Check the previous outcome before spending again.",
        }).catch(() => undefined); // Never resurrect an expired, rejected or promoted candidate.

        throw e;
      }
    },
    async promote(identity: AuthenticatedUser, w: string, id: string) {
      const { db, result } = await candidate(identity, w, id);
      if (result.status === "promoted")
        return { id: result.id, status: "promoted" };
      const d = result.details,
        orgs = await organisations(db, w, d.domain);
      if (result.kind === "organisation") {
        if (orgs.length === 1) {
          await update(w, id, { status: "promoted", id: orgs[0]!.id });
          return { id: orgs[0]!.id, status: "matched" };
        }
        if (orgs.length > 1)
          throw new ResearchActionConflict(
            "Multiple organisation matches require review.",
          );
        const record = await records.write(
          identity,
          w,
          "organisations",
          undefined,
          {
            fields: {
              name: d.name,
              website: d.website,
              industry: d.industry ?? "",
              description: d.description ?? "",
              country: "",
              region: "",
              type: "prospect",
            },
          },
          "save",
          undefined,
          id,
        );
        return { id: record.id, status: "promoted" };
      }
      if (result.status !== "ready" || orgs.length !== 1)
        throw new ResearchActionConflict(
          "Verify this candidate and its organisation first.",
        );
      const points = await db
        .collection("contact_points")
        .find({
          workspaceId: w,
          type: "email",
          normalizedValue: result.verifiedEmail,
        })
        .limit(2)
        .toArray();
      if (points.length)
        throw new ResearchActionConflict(
          "This email already exists. Review the existing contact; restrictions were preserved.",
        );
      const record = await records.write(
        identity,
        w,
        "contacts",
        undefined,
        {
          fields: {
            firstName: d.firstName,
            lastName: d.lastName,
            title: d.title,
            email: result.verifiedEmail,
            phone: "",
            organisationId: orgs[0]!.id,
          },
        },
        "save",
        undefined,
        id,
      );
      return { id: record.id, status: "promoted" };
    },
  };
}
