import { countryCode, registrationIdentity, registrationReference } from "./registration";
import { contactContextAccess } from "../contact-context";
import {
  hubspotOptions,
  hubspotLifecycle,
  previewHubspot,
  commitHubspot,
} from "../hubspot-import";
import { checkRecovery, recoveryComplete } from "./esos-recovery";
import { isDeepStrictEqual } from "node:util";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { ClientSession, Db, Document } from "mongodb";
import type { AppConfig } from "../../config";
import type { AuthenticatedUser } from "../../middlewares/auth";
import type { MongoService } from "../mongo";
import {
  generatePlatformId,
  OrganisationSchema,
  PersonSchema,
  ContactPointSchema,
  OrganisationRelationshipSchema,
  ImportSchema,
  EventSchema,
  normalizeContactValue,
} from "../../domain";
import { normalizeOrganisationDomain } from "../../domain/crm-fields";
import { HiveConflict } from "../hive-definitions";
import { icpAccess, lockIcpWorkspace } from "./access";
import { originSchema, typedObservation } from "./import-observations";
const text = z.string().trim().max(1000);
export const importRowSchema = z
  .object({
    row: z.number().int().positive(),
    original: z
      .record(z.string().max(500), z.string().max(12000))
      .refine(
        (v) =>
          Object.keys(v).length <= 500 &&
          Buffer.byteLength(JSON.stringify(v)) <= 700000,
      ),
    company: text.optional(),
    registration: z.string().max(100).optional(),
    registrationJurisdiction: z.string().max(100).optional(),
    registrationType: z.string().max(100).optional(),
    sourceOnly: z.boolean().optional(),
    origin: originSchema.optional(),
    website: text.optional(),
    industry: text.optional(),
    country: text.optional(),
    region: text.optional(),
    employees: text.optional(),
    addressLine1: text.optional(),
    addressLine2: text.optional(),
    city: text.optional(),
    postalCode: text.optional(),
    addressRegion: text.optional(),
    firstName: text.optional(),
    lastName: text.optional(),
    email: text.optional(),
    phone: text.optional(),
    jobTitle: text.optional(),
    lifecycle: text.optional(),
    resolution: z
      .object({
        action: z.enum(["match", "create"]),
        id: z.string().max(100).optional(),
      })
      .strict()
      .optional(),
    skip: z.boolean().default(false),
  })
  .strict()
  .refine(
    (r) =>
      !r.origin?.notification ||
      r.sourceOnly ||
      r.origin.sheet === "Responsible Undertaking",
    "ESOS account candidates must come from Responsible Undertaking; other rows are supporting evidence.",
  );
export const importInputSchema = z
  .object({
    hubspot: hubspotOptions.optional(),
    requestKey: z.string().uuid(),
    filename: z.string().min(1).max(500),
    rows: z.array(importRowSchema).min(1).max(200),
    fieldMapping: z.record(z.string().max(500), z.string().max(100)),
    jobId: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    replacesJobId: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    batchIndex: z.number().int().nonnegative().optional(),
  })
  .strict()
  .refine(
    (v) => (v.jobId === undefined) === (v.batchIndex === undefined),
    "Job and batch must be supplied together",
  )
  .refine(
    (v) => new Set(v.rows.map((r) => r.row)).size === v.rows.length,
    "Duplicate row numbers",
  );
type Input = z.infer<typeof importInputSchema>;
type Row = Input["rows"][number];
type PreviewRow = {
  row: number;
  status: "create" | "existing" | "review" | "skip";
  issues: string[];
  companyId?: string;
  personId?: string;
  values: Record<string, unknown>;
};
const hash = (v: unknown) =>
  createHash("sha256").update(JSON.stringify(v)).digest("hex");
function normalized(row: Row) {
  const values: Record<string, unknown> = {};
  for (const key of [
    "company",
    "addressLine1",
    "addressLine2",
    "city",
    "postalCode",
    "addressRegion",
    "industry",
    "region",
    "firstName",
    "lastName",
    "jobTitle",
  ] as const)
    if (row[key]?.trim()) values[key] = row[key]!.trim().replace(/\s+/g, " ");
  if (row.lifecycle?.trim()) {
    values.originalLifecycle = row.lifecycle.trim();
    values.lifecycle = hubspotLifecycle(row.lifecycle);
  }
  if (row.country?.trim()) values.country = countryCode(row.country);
  if (row.website?.trim()) {
    const url = new URL(
      /^https?:\/\//i.test(row.website)
        ? row.website
        : `https://${row.website}`,
    );
    if (
      !["https:", "http:"].includes(url.protocol) ||
      url.username ||
      url.password
    )
      throw new Error("Enter a valid public website URL.");
    values.website = url.toString();
    values.normalizedDomain = normalizeOrganisationDomain(url.hostname);
  }
  if (row.email?.trim())
    values.email = z
      .string()
      .email()
      .parse(normalizeContactValue("email", row.email));
  if (row.phone?.trim()) {
    const phone = normalizeContactValue("phone", row.phone);
    if (!/^\+?\d{7,15}$/.test(phone))
      throw new Error("Check the phone number.");
    values.phone = phone;
  }
  if (row.employees?.trim())
    values.employees = z.coerce
      .number()
      .int()
      .nonnegative()
      .parse(row.employees.replace(/,/g, ""));
  if (values.country && !/^[A-Z]{2}$/.test(String(values.country)))
    throw new Error("Use a two-letter country code.");
  if (row.registration?.trim()) {
    const registration=registrationIdentity(row.registration,row.registrationJurisdiction ?? "",row.registrationType ?? (countryCode(row.registrationJurisdiction ?? "") === "GB" ? "company_number" : "unspecified"));
    values.registration=registration.value;
    values.registrationIdentity=registration;
    values.registrationReference=registrationReference(registration);
    // Only the legacy supported UK scheme is an automatic matching key.
    if(registration.jurisdiction==="GB" && registration.type==="company_number") values.registrationMatch=values.registrationReference;
  }
  if (!row.sourceOnly && !values.company && !values.firstName)
    throw new Error("Enter a company name or a contact’s first name.");
  if (
    (values.email || values.phone || values.lastName || values.jobTitle) &&
    !values.firstName
  )
    throw new Error("Enter the contact’s first name.");
  for (const [key, max] of Object.entries({
    company: 300,
    addressLine1: 300,
    addressLine2: 300,
    city: 200,
    postalCode: 50,
    addressRegion: 200,
    industry: 200,
    region: 100,
    firstName: 100,
    lastName: 100,
    jobTitle: 200,
    email: 500,
  }))
    if (values[key] !== undefined) z.string().max(max).parse(values[key]);
  if (values.normalizedDomain)
    OrganisationSchema.shape.normalizedDomain.parse(values.normalizedDomain);
  return values;
}
async function plan(db: Db, w: string, input: Input, session?: ClientSession) {
  const output: PreviewRow[] = [];
  const seen = new Set<string>();
  const companies = new Map<string, Record<string, unknown>>();
  const normalizedRows = input.rows
    .filter((r) => !r.skip)
    .flatMap((r) => {
      try {
        return [normalized(r)];
      } catch {
        return [];
      }
    });
  const names = normalizedRows.map((r) => r.company).filter(Boolean),
    refs = normalizedRows
      .filter((r) => r.registrationMatch)
      .map((r) => r.registrationMatch),
    domains = normalizedRows.map((r) => r.normalizedDomain).filter(Boolean);
  const candidatesForBatch = names.length
    ? await db
        .collection("organisations")
        .find(
          {
            workspaceId: w,
            archived: { $ne: true },
            $or: [
              { name: { $in: names } },
              { "source.reference": { $in: refs } },
              { normalizedDomain: { $in: domains } },
            ],
          },
          { session },
        )
        .limit(2001)
        .toArray()
    : [];
  if (candidatesForBatch.length > 2000)
    throw new HiveConflict(
      "Too many matching companies; review duplicate identities.",
    );

  for (const row of input.rows) {
    const item: PreviewRow = {
      row: row.row,
      status: row.skip ? "skip" : "create",
      issues: [],
      values: {},
    };
    output.push(item);
    if (row.skip) continue;
    try {
      item.values = normalized(row);
    } catch {
      item.status = "review";
      item.issues.push(
        "Check names, registration jurisdiction/type, website, email, phone, country and employee count.",
      );
      continue;
    }
    const v = item.values;
    if (row.sourceOnly && !v.company) {
      item.status = "existing";
      continue;
    }
    if (v.company) {
      const candidates = candidatesForBatch.filter((c) =>
        v.registrationMatch
          ? c.source?.reference === v.registrationMatch
          : v.normalizedDomain
            ? c.normalizedDomain === v.normalizedDomain
            : !v.registration && c.name === v.company,
      );
      if (!candidates.length && v.registration) {
        const named = candidatesForBatch.filter((c) => c.name === v.company);
        if (named.length) {
          item.issues.push(
            "A company with this name already exists without this registration identity. Review the identity before importing.",
          );
        }
      }
      if (
        row.sourceOnly &&
        !candidates.length &&
        !companies.has(
          `company:${v.registrationReference || v.normalizedDomain || String(v.company).toLowerCase()}`,
        ) &&
        !item.issues.length
      )
        item.issues.push("Import company records before their observations.");
      if (candidates.length === 1) {
        item.companyId = candidates[0]!.id;
        if (
          !row.sourceOnly &&
          String(candidates[0]!.name).toLowerCase() !==
            String(v.company).toLowerCase()
        )
          item.issues.push(
            "Website matches an organisation with a different name. Correct the row or skip it.",
          );
        for (const key of ["industry", "country", "region"] as const)
          if (v[key] && candidates[0]![key] && v[key] !== candidates[0]![key])
            item.issues.push(
              `${key} differs from the saved company; existing details will not be overwritten. Correct the row or skip it.`,
            );
      } else if (candidates.length > 1)
        item.issues.push(
          "More than one company matches. Resolve the duplicate or skip this row.",
        );
      const key = `company:${v.registrationReference || v.normalizedDomain || String(v.company).toLowerCase()}`;
      const first = companies.get(key);
      if (
        first &&
        ["company", "industry", "country", "region", "employees"].some(
          (k) =>
            first[k] !== undefined &&
            v[k] !== undefined &&
            String(first[k]).toLowerCase() !== String(v[k]).toLowerCase(),
        )
      )
        item.issues.push(
          "Company details disagree with another row in this file. Correct the row or skip it.",
        );
      if (!first) companies.set(key, v);
      seen.add(key);
    }
    if (v.firstName) {
      if (v.email) {
        const contacts = await db
          .collection("contact_points")
          .find(
            {
              workspaceId: w,
              type: "email",
              normalizedValue: v.email,
              archived: { $ne: true },
            },
            { session },
          )
          .limit(3)
          .toArray();
        const ids = [...new Set(contacts.map((c) => c.personId))];
        if (ids.length === 1) {
          const person = await db
            .collection("people")
            .findOne(
              { workspaceId: w, id: ids[0], archived: { $ne: true } },
              { session },
            );
          if (
            !person ||
            String(person.firstName).toLowerCase() !==
              String(v.firstName).toLowerCase() ||
            (v.lastName &&
              String(person.lastName || "").toLowerCase() !==
                String(v.lastName).toLowerCase())
          )
            item.issues.push(
              "This email belongs to different contact details. Correct the row or skip it.",
            );
          else item.personId = person.id;
        } else if (ids.length > 1)
          item.issues.push(
            "This email matches multiple contacts. Resolve the duplicate or skip this row.",
          );
      } else
        item.issues.push(
          "Add an email to safely identify this contact before import.",
        );
      const key = `email:${v.email}`;
      if (seen.has(key))
        item.issues.push(
          "Email repeated within the file. Keep one row or correct the email.",
        );
      seen.add(key);
    }
    if (item.issues.length) item.status = "review";
    else if (row.sourceOnly) item.status = "existing";
    else if ((!v.company || item.companyId) && (!v.firstName || item.personId))
      item.status = "existing";
  }
  return {
    rows: output,
    digest: hash({ input, output }),
    counts: {
      total: output.length,
      created: output.filter((r) => r.status === "create").length,
      duplicate: output.filter((r) => r.status === "existing").length,
      rejected: output.filter(
        (r) => r.status === "review" || r.status === "skip",
      ).length,
    },
  };
}
export function createHiveImporter(config: AppConfig, mongo: MongoService) {
  return {
    async progress(identity: AuthenticatedUser, w: string, jobId: string) {
      z.string()
        .regex(/^[a-f0-9]{64}$/)
        .parse(jobId);
      const db = await mongo.database();
      await icpAccess(db, config, identity, w, "read");
      const rows = await db
        .collection("events")
        .find({
          workspaceId: w,
          eventType: "hive_import_completed",
          "payload.jobId": jobId,
        })
        .sort({ "payload.batchIndex": 1 })
        .limit(10000)
        .toArray();
      return {
        reconciled: await recoveryComplete(db, w, jobId),
        batches: rows.map((r) => ({
          index: r.payload.batchIndex,
          importId: r.payload.importId,
          counts: r.payload.counts,
          verified: r.payload.verified,
        })),
      };
    },
    async observations(identity: AuthenticatedUser, w: string, raw: unknown) {
      const { companyId, personId, notification, offset } = z
        .object({
          companyId: z.string().optional(),
          personId: z.string().optional(),
          notification: z.string().max(100).optional(),
          offset: z.coerce.number().int().min(0).default(0),
        })
        .strict()
        .refine(
          (v) =>
            [v.companyId, v.personId, v.notification].filter(Boolean).length ===
            1,
        )
        .parse(raw);
      const db = await mongo.database();
      await icpAccess(db, config, identity, w, "read");
      const rows = await db
        .collection("events")
        .find({
          workspaceId: w,
          eventType: "hive_import_observations",
          ...(personId
            ? { "payload.personId": personId }
            : companyId
              ? { "payload.companyId": companyId }
              : { "payload.origin.notification": notification }),
        })
        .sort({ id: 1 })
        .skip(offset)
        .limit(51)
        .toArray();
      return {
        items: rows.slice(0, 50).map((r) => ({ id: r.id, ...r.payload })),
        hasMore: rows.length > 50,
      };
    },
    async preview(identity: AuthenticatedUser, w: string, raw: unknown) {
      const input = importInputSchema.parse(raw),
        db = await mongo.database();
      await icpAccess(db, config, identity, w, "create");
      await checkRecovery(db, w, input);
      if (input.hubspot)
        await contactContextAccess(db, config, identity, w, "create");
      return input.hubspot ? previewHubspot(db, w, input) : plan(db, w, input);
    },
    async commit(identity: AuthenticatedUser, w: string, raw: unknown) {
      const { digest, ...rest } = z
        .object({ digest: z.string().regex(/^[a-f0-9]{64}$/) })
        .passthrough()
        .parse(raw);
      const input = importInputSchema.parse(rest);
      if (!mongo.withTransaction) throw new Error("Transactions required");
      return mongo.withTransaction(async (db, session) => {
        const actor = await icpAccess(
          db,
          config,
          identity,
          w,
          "create",
          session,
        );
        const now = await lockIcpWorkspace(db, w, session);
        await checkRecovery(db, w, input, session);
        if (input.hubspot) {
          await contactContextAccess(
            db,
            config,
            identity,
            w,
            "create",
            session,
          );
          await contactContextAccess(
            db,
            config,
            identity,
            w,
            "update",
            session,
          );
          return commitHubspot(db, w, input, digest, actor, now, session);
        }
        if (input.jobId) {
          const batch = await db.collection("events").findOne(
            {
              workspaceId: w,
              eventType: "hive_import_completed",
              "payload.jobId": input.jobId,
              "payload.batchIndex": input.batchIndex,
            },
            { session },
          );
          if (batch && batch.payload.inputHash !== hash(input))
            throw new HiveConflict(
              "This batch was already committed with different data",
            );
        }
        const previous = await db.collection("imports").findOne(
          {
            workspaceId: w,
            provider: "hvm_hive_upload",
            reference: input.requestKey,
          },
          { session },
        );
        if (previous) {
          const receipt = await db.collection("events").findOne(
            {
              workspaceId: w,
              eventType: "hive_import_completed",
              "payload.importId": previous.id,
            },
            { session },
          );
          if (receipt?.payload.inputHash !== hash(input))
            throw new HiveConflict("Import key reused with different data");
          const rows = await db
            .collection("events")
            .find(
              {
                workspaceId: w,
                eventType: "hive_import_row",
                "payload.importId": previous.id,
              },
              { session },
            )
            .sort({ "payload.row": 1 })
            .toArray();
          return {
            ...receipt!.payload,
            results: rows.map((r) => ({
              row: r.payload.row,
              status: r.payload.status,
              companyId: r.payload.companyId,
              personId: r.payload.personId,
            })),
          };
        }
        const preview = await plan(db, w, input, session);
        if (
          preview.digest !== digest ||
          preview.rows.some((r) => r.status === "review")
        )
          throw new HiveConflict("Review the changed import preview");
        const importId = generatePlatformId("import"),
          results: Document[] = [];
        const base = (prefix: Parameters<typeof generatePlatformId>[0]) => ({
          id: generatePlatformId(prefix),
          workspaceId: w,
          createdAt: now,
          updatedAt: now,
          createdBy: actor,
          updatedBy: actor,
          source: {
            system: "hvm_hive_upload",
            reference: importId,
            importedAt: now,
          },
        });
        const pending = new Map<string, Document[]>(),
          batchCompanies = new Map<string, string>();
        const insertVerified = async (collection: string, doc: Document) => {
          const records = pending.get(collection) ?? [];
          records.push(doc);
          pending.set(collection, records);
        };
        const flushVerified = async () => {
          for (const [collection, records] of pending) {
            await db
              .collection(collection)
              .insertMany(records, { session, ordered: true });
            const saved = await db
              .collection(collection)
              .find(
                { workspaceId: w, id: { $in: records.map((r) => r.id) } },
                { session },
              )
              .toArray();
            if (saved.length !== records.length)
              throw new Error("Readback failed");
            const byId = new Map(saved.map((r) => [r.id, r]));
            for (const doc of records) {
              const { _id: oldId, ...expected } = doc;
              const { _id: newId, ...actual } = byId.get(doc.id)!;
              void oldId;
              void newId;
              if (!isDeepStrictEqual(actual, expected))
                throw new Error("Readback differs");
            }
          }
        };
        for (let i = 0; i < preview.rows.length; i++) {
          const row = preview.rows[i]!,
            original = input.rows[i]!,
            v = row.values;
          let companyId = row.companyId,
            personId = row.personId;
          if (row.status !== "skip") {
            const companyKey = String(
              v.registrationReference ||
                v.normalizedDomain ||
                String(v.company).toLowerCase(),
            );
            if (!companyId) companyId = batchCompanies.get(companyKey);
            if (!original.sourceOnly && v.company && !companyId) {
              const doc = OrganisationSchema.parse({
                ...base("org"),
                name: v.company,
                ...(v.registration
                  ? {
                      source: {
                        system: "hvm_hive_upload",
                        reference: v.registrationReference,
                        importedAt: now,
                      },
                    }
                  : {}),
                type: "prospect",
                ...([
                  "addressLine1",
                  "addressLine2",
                  "city",
                  "postalCode",
                  "addressRegion",
                ].some((k) => v[k])
                  ? {
                      address: {
                        ...(v.addressLine1 ? { line1: v.addressLine1 } : {}),
                        ...(v.addressLine2 ? { line2: v.addressLine2 } : {}),
                        ...(v.city ? { city: v.city } : {}),
                        ...(v.postalCode ? { postalCode: v.postalCode } : {}),
                        ...(v.addressRegion ? { region: v.addressRegion } : {}),
                        ...(v.country ? { countryCode: v.country } : {}),
                      },
                    }
                  : {}),
                ...(v.website
                  ? { website: v.website, normalizedDomain: v.normalizedDomain }
                  : {}),
                ...(v.industry ? { industry: v.industry } : {}),
                ...(v.country ? { country: v.country } : {}),
                ...(v.region ? { region: v.region } : {}),
                ...(v.employees !== undefined
                  ? { size: { employees: v.employees } }
                  : {}),
              });
              await insertVerified("organisations", doc);
              companyId = doc.id;
              batchCompanies.set(companyKey, doc.id);
            }
            if (v.firstName && !personId) {
              const doc = PersonSchema.parse({
                ...base("person"),
                firstName: v.firstName,
                ...(v.lastName ? { lastName: v.lastName } : {}),
                displayName: [v.firstName, v.lastName]
                  .filter(Boolean)
                  .join(" "),
              });
              await insertVerified("people", doc);
              personId = doc.id;
              for (const type of ["email", "phone"] as const)
                if (v[type]) {
                  const contact = ContactPointSchema.parse({
                    ...base("contact"),
                    personId,
                    type,
                    value: v[type],
                    normalizedValue: v[type],
                  });
                  await insertVerified("contact_points", contact);
                }
            }
            if (companyId && personId) {
              const link = await db
                .collection("organisation_relationships")
                .findOne(
                  {
                    workspaceId: w,
                    personId,
                    organisationId: companyId,
                    archived: { $ne: true },
                  },
                  { session },
                );
              if (!link)
                await db.collection("organisation_relationships").insertOne(
                  OrganisationRelationshipSchema.parse({
                    ...base("orgrel"),
                    personId,
                    organisationId: companyId,
                    ...(v.jobTitle ? { jobTitle: v.jobTitle } : {}),
                    current: true,
                  }),
                  { session },
                );
            }
          }
          const result = {
            row: row.row,
            status: row.status,
            ...(companyId ? { companyId } : {}),
            ...(personId ? { personId } : {}),
          };
          results.push(result);
          // Source lifecycle is evidence, never a replacement for manually saved controls.
          // Existing records retain their current source context on generic re-import.
          const lifecycleSubject = v.firstName ? (!row.personId && personId ? {personId} : undefined)
            : (!row.companyId && companyId ? {companyId} : undefined);
          if (v.originalLifecycle && lifecycleSubject && row.status === "create") {
            await insertVerified("events", EventSchema.parse({
              ...base("event"), occurredAt: now, actor,
              eventType: "hive_import_contact_context",
              payload: {importId, ...lifecycleSubject, values: {
                lifecycle: v.lifecycle, originalLifecycle: v.originalLifecycle,
              }},
            }));
          }
          const originalBytes = Buffer.byteLength(
            JSON.stringify(original.original),
          );
          const fields = Object.entries(original.original).map(([label, raw]) =>
            typedObservation(label, raw),
          );
          let chunk: typeof fields = [],
            chunkBytes = 0,
            part = 0;
          const saveChunk = async () => {
            if (!chunk.length) return;
            await insertVerified(
              "events",
              EventSchema.parse({
                ...base("event"),
                occurredAt: now,
                actor,
                eventType: "hive_import_observations",
                payload: {
                  importId,
                  ...result,
                  part: part++,
                  origin: original.origin ?? {
                    sheet: input.filename,
                    row: original.row,
                    scope: "organisation",
                  },
                  fields: chunk,
                },
              }),
            );
            chunk = [];
            chunkBytes = 0;
          };
          for (const field of fields) {
            // Long source cells are retained in numbered fragments, never truncated.
            const encoded = JSON.stringify(field);
            if (Buffer.byteLength(encoded) > 10000) {
              await saveChunk();
              for (let offset = 0; offset < field.raw.length; offset += 1800) {
                const fragment = {
                  label: field.label,
                  raw: field.raw.slice(offset, offset + 1800),
                  type: "text_fragment",
                  value: field.raw.slice(offset, offset + 1800),
                  offset,
                  totalLength: field.raw.length,
                };
                await insertVerified(
                  "events",
                  EventSchema.parse({
                    ...base("event"),
                    occurredAt: now,
                    actor,
                    eventType: "hive_import_observations",
                    payload: {
                      importId,
                      ...result,
                      part: part++,
                      origin: original.origin ?? {
                        sheet: input.filename,
                        row: original.row,
                        scope: "organisation",
                      },
                      fields: [fragment],
                    },
                  }),
                );
              }
            } else {
              if (chunkBytes + Buffer.byteLength(encoded) > 11000)
                await saveChunk();
              chunk.push(field);
              chunkBytes += Buffer.byteLength(encoded);
            }
          }
          await saveChunk();
          await insertVerified(
            "events",
            EventSchema.parse({
              ...base("event"),
              occurredAt: now,
              actor,
              eventType: "hive_import_row",
              payload: {
                importId,
                ...result,
                original: originalBytes < 8000 ? original.original : {},
                originalInObservations: originalBytes >= 8000,
                sourceOnly: original.sourceOnly ?? false,
                normalized: v,
              },
            }),
          );
        }
        const record = ImportSchema.parse({
          ...base("import"),
          id: importId,
          provider: "hvm_hive_upload",
          reference: input.requestKey,
          filename: input.filename,
          importedAt: now,
          rowCounts: { ...preview.counts, updated: 0 },
          fieldMapping: Object.fromEntries(
            Object.entries(input.fieldMapping).map(([k, v]) => [
              k.length > 100 ? hash(k) : k,
              v,
            ]),
          ),
          status: "completed",
        });
        await insertVerified("imports", record);
        const payload = {
          importId,
          inputHash: hash(input),
          ...(input.replacesJobId
            ? { replacesJobId: input.replacesJobId }
            : {}),
          ...(input.jobId
            ? { jobId: input.jobId, batchIndex: input.batchIndex }
            : {}),
          counts: record.rowCounts,
          verified: true,
        };
        await insertVerified(
          "events",
          EventSchema.parse({
            ...base("event"),
            occurredAt: now,
            actor,
            eventType: "hive_import_completed",
            payload,
          }),
        );
        await flushVerified();
        return { ...payload, results };
      });
    },
  };
}
