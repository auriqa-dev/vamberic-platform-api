import { createHash } from "node:crypto";
import { z } from "zod";
import type { Db, ClientSession, Document } from "mongodb";
import {
  EventSchema,
  PersonSchema,
  OrganisationSchema,
  ContactPointSchema,
  OrganisationRelationshipSchema,
  normalizeContactValue,
  generatePlatformId,
} from "../domain";
import { HiveConflict } from "./hive-definitions";

export const lifecycleStages = [
  "subscriber",
  "lead",
  "marketing_qualified",
  "sales_qualified",
  "opportunity",
  "customer",
  "advocate",
  "other",
  "unknown",
] as const;
export const hubspotOptions = z
  .object({
    account: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .regex(/^[\w.-]+$/)
      .optional(),
    timezone: z
      .string()
      .min(1)
      .max(100)
      .refine((v) => {
        try {
          new Intl.DateTimeFormat("en-GB", { timeZone: v });
          return true;
        } catch {
          return false;
        }
      }, "Choose a valid export timezone"),
    kind: z.enum(["companies", "contacts", "emails"]),
    associateByName: z.boolean().default(false),
    lifecycleMapping: z.record(z.enum(lifecycleStages)).default({}),
  })
  .strict();
type Options = z.infer<typeof hubspotOptions>;
type Input = {
  hubspot?: Options;
  rows: {
    row: number;
    original: Record<string, string>;
    skip?: boolean;
    resolution?: { action: "match" | "create"; id?: string };
  }[];
  requestKey: string;
  filename: string;
  jobId?: string;
  batchIndex?: number;
};
const hash = (v: unknown) =>
  createHash("sha256").update(JSON.stringify(v)).digest("hex");
const yes = (v: string | undefined) => /^(true|yes|1)$/i.test(v?.trim() ?? "");
const at = (r: Record<string, string>, ...keys: string[]) =>
  keys.map((k) => r[k]?.trim()).find(Boolean) ?? "";
export function hubspotDate(s: string, timezone: string): Date | null {
  if (!s) return null;
  if (/(?:Z|[+-]\d{2}:?\d{2})$/i.test(s)) {
    const d = new Date(s);
    return Number.isFinite(d.valueOf()) ? d : null;
  }
  const m = s.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/,
  );
  if (!m) return null;
  const target = Date.UTC(
    +m[1]!,
    +m[2]! - 1,
    +m[3]!,
    +(m[4] ?? 0),
    +(m[5] ?? 0),
    +(m[6] ?? 0),
  );
  const format = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const local = (ms: number) => {
    const p = Object.fromEntries(
      format.formatToParts(new Date(ms)).map((p) => [p.type, p.value]),
    );
    return Date.UTC(
      +p.year!,
      +p.month! - 1,
      +p.day!,
      +p.hour!,
      +p.minute!,
      +p.second!,
    );
  };
  let result = target;
  for (let i = 0; i < 3; i++) result += target - local(result);
  // Missing or repeated local times require an explicit timestamp offset, never a guessed instant.
  if (
    local(result) !== target ||
    local(result - 3600000) === target ||
    local(result + 3600000) === target
  )
    return null;
  return new Date(result);
}
export function hubspotLifecycle(
  raw: string,
  mapping: Options["lifecycleMapping"] = {},
) {
  const standard: Record<string, string> = {
    subscriber: "subscriber",
    lead: "lead",
    "marketing qualified lead": "marketing_qualified",
    marketingqualifiedlead: "marketing_qualified",
    "sales qualified lead": "sales_qualified",
    salesqualifiedlead: "sales_qualified",
    opportunity: "opportunity",
    customer: "customer",
    evangelist: "advocate",
    other: "other",
  };
  if (mapping[raw]) return mapping[raw];
  if ((lifecycleStages as readonly string[]).includes(raw.trim().toLowerCase())) return raw.trim().toLowerCase();
  return standard[raw.trim().toLowerCase().replace(/[_\s-]+/g, " ")] ?? "unknown";
}
export function assessEmailResponse(subject: string, body: string) {
  // Evidence triage only. Never silently mutate people/permissions from a phrase match.
  const text = (subject + "\n" + body)
    .split(/\n(?:On .+wrote:|From:|_{3,}|-{3,})/i)[0]!
    .replace(/<[^>]*>/g, " ");
  let category = "ordinary_reply";
  if (/unsubscribe|do not (?:email|contact)|remove me from/i.test(text))
    category = "objection";
  else if (
    /no longer (?:works?|with|employed)|has left (?:the |our )?(?:company|organisation|organization)|left the (?:company|organisation|organization)/i.test(
      text,
    )
  )
    category = "departure";
  else if (
    /out of (?:the )?office|annual leave|away until|on holiday/i.test(text)
  )
    category = "temporary_absence";
  else if (
    /delivery (?:failed|failure)|undeliverable|mailbox unavailable/i.test(text)
  )
    category = "delivery_failure";
  else if (/auto.?reply|automatic reply/i.test(subject))
    category = "needs_review";
  return {
    category,
    status: "needs_review",
    reason:
      "Source text is evidence, not authority. Review the original reply before changing contact records.",
  };
}
export function normaliseHubspot(r: Record<string, string>, o: Options) {
  const id = at(r, "Record ID");
  if (!id || !/^\d+$/.test(id))
    throw new Error("A numeric HubSpot Record ID is required.");
  const originalLifecycle = at(r, "Lifecycle Stage"),
    lifecycle = hubspotLifecycle(originalLifecycle, o.lifecycleMapping);
  const restrictions = [
    ...[
      "Unsubscribed from all email",
      "Opted out of email: Marketing Information",
      "Opted out of email: One to One",
    ].filter((k) => yes(r[k])),
  ];
  const addressRestricted = [
    "Email Address Quarantined",
    "Invalid email address",
  ].filter((k) => yes(r[k]));
  if (at(r, "Email hard bounce reason"))
    addressRestricted.push("Email hard bounce reason");
  const values: Record<string, unknown> = {
    sourceId: id,
    sourceTimezone: o.timezone,
    sourceReference: "",
    originalLifecycle,
    lifecycle,
    restrictions,
    addressRestricted,
    sourceUpdatedAt:
      hubspotDate(
        at(r, "Last Modified Date", "Last modified date"),
        o.timezone,
      )?.toISOString() ?? null,
    lastEngagedAt:
      hubspotDate(
        at(r, "Last Engagement Date", "Last Contacted"),
        o.timezone,
      )?.toISOString() ?? null,
    currentCustomer: yes(r["Current Customer"]),
    subscriptionStatus: at(r, "Subscription Status"),
    leadStatus: at(r, "Lead Status"),
    marketingContactStatus: at(r, "Marketing contact status"),
    company: at(r, "Company name", "Company Name"),
    firstName: at(r, "First Name"),
    lastName: at(r, "Last Name"),
    email: at(r, "Email").toLowerCase(),
    phone: at(r, "Phone Number", "Mobile Phone Number"),
    jobTitle: at(r, "Job Title"),
    industry: at(r, "Industry"),
    country: at(r, "Country/Region Code"),
    city: at(r, "City"),
    postalCode: at(r, "Postal Code"),
    address: at(r, "Street Address"),
    associationIds: at(
      r,
      "Associated Company IDs",
      "Associated Company ID",
      "Company ID",
    )
      .split(/[;,]/)
      .map((s) => s.trim())
      .filter(Boolean),
  };
  if (o.kind === "companies") {
    if (!values.company) throw new Error("Company name is required.");
    const website = at(r, "Website URL", "Company Domain Name");
    if (website) {
      const u = new URL(
        /^https?:\/\//i.test(website) ? website : `https://${website}`,
      );
      if (!["http:", "https:"].includes(u.protocol) || u.username || u.password)
        throw new Error("Check the company website.");
      values.website = u.toString();
      values.normalizedDomain = u.hostname.toLowerCase().replace(/^www\./, "");
    }
    const employees = at(r, "Number of Employees");
    if (employees && /^\d[\d,]*$/.test(employees))
      values.employees = Number(employees.replaceAll(",", ""));
  }
  if (o.kind === "contacts") {
    if (!values.firstName)
      throw new Error("First name is required; retain this row for review.");
    if (values.email && !z.string().email().safeParse(values.email).success)
      throw new Error("Check the contact email; do not invent an address.");
  }
  if (o.kind === "emails") {
    const occurredAt = hubspotDate(at(r, "Activity date"), o.timezone);
    if (!occurredAt || occurredAt > new Date())
      throw new Error("A valid historical activity date is required.");
    const direction = at(r, "Email Direction");
    if (!["Incoming", "Outgoing", "Forwarded"].includes(direction))
      throw new Error("Review the email direction.");
    const participants = Object.fromEntries(
      ["From", "To", "CC", "BCC"].map((k) => [
        k.toLowerCase(),
        at(r, `Email ${k} Address`),
      ]),
    );
    const addresses = [
      ...new Set(
        Object.values(participants).flatMap(
          (v) =>
            v
              .toLowerCase()
              .match(/[\w.!#$%&'*+/=?^`{|}~-]+@[\w.-]+\.[a-z]{2,}/g) ?? [],
        ),
      ),
    ];
    values.emailData = {
      subject: at(r, "Email subject") || "(No subject)",
      body: r["Email body"] ?? "",
      direction,
      participants,
      addresses,
      occurredAt: occurredAt.toISOString(),
      inReplyTo: at(r, "In reply to Engagement Id"),
      sendStatus: at(r, "Email send status"),
      assessment:
        direction === "Incoming"
          ? assessEmailResponse(at(r, "Email subject"), r["Email body"] ?? "")
          : null,
      metrics: Object.fromEntries(
        [
          "Number of Email Clicks",
          "Number of Email Opens",
          "Number of Email Replies",
          "Number of Emails Sent",
        ].map((k) => [k, r[k] ?? ""]),
      ),
    };
  }
  for (const [key, max] of Object.entries({
    company: 300,
    firstName: 100,
    lastName: 100,
    jobTitle: 200,
    industry: 200,
    phone: 100,
    address: 300,
    city: 200,
    postalCode: 50,
  }))
    if (String(values[key] ?? "").length > max)
      throw new Error(
        `Review ${key}: exceeds the supported field length (${max}). Original data is not truncated.`,
      );
  if (JSON.stringify(values).length > 14000)
    throw new Error(
      "This source record is too large for the history record. Split long supporting content into a Library document before importing; nothing has been truncated.",
    );
  // Source IDs are provenance, never a global identity. Include corroborating identity.
  const identity =
    o.kind === "companies"
      ? [values.normalizedDomain ?? "", normalName(values.company)]
      : o.kind === "contacts"
        ? [
            values.email,
            normalName(values.firstName),
            normalName(values.lastName),
            values.email ? "" : normalName(values.company),
          ]
        : emailIdentity(
            values.emailData as Document,
            id,
            at(r, "Message ID", "Email Message ID"),
          );
  values.sourceReference = `hubspot-v2:${o.kind}:${hash(identity)}`;
  return values;
}
const normalName = (v: unknown) =>
  String(v ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
const exactName = (v: unknown) =>
  new RegExp(
    "^" +
      normalName(v)
        .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
        .replace(/ /g, "\\s+") +
      "$",
    "i",
  );
function emailIdentity(e: Document, sourceId: string, messageId = "") {
  // Corroborate message IDs with content. An ID alone can collide across source accounts.
  return [
    messageId || sourceId,
    e.occurredAt,
    e.direction,
    e.subject,
    e.body,
    ...["from", "to", "cc", "bcc"].map((k) =>
      String(e.participants?.[k] ?? "")
        .trim()
        .toLowerCase(),
    ),
  ];
}
export async function previewHubspot(
  db: Db,
  w: string,
  input: Input,
  session?: ClientSession,
) {
  const o = input.hubspot!;
  const rows: Document[] = [];
  const seen = new Set<string>();
  for (const row of input.rows) {
    const item: Document = {
      row: row.row,
      status: row.skip ? "skip" : "create",
      issues: [],
      values: {},
    };
    rows.push(item);
    if (row.skip) continue;
    try {
      item.values = normaliseHubspot(row.original, o);
    } catch (e) {
      item.status = "review";
      item.issues.push((e as Error).message);
      continue;
    }
    const v = item.values;
    if (seen.has(v.sourceReference)) {
      item.status = "review";
      item.issues.push(
        "Repeated identity in this batch. Review and skip the duplicate row.",
      );
      continue;
    }
    seen.add(v.sourceReference);
    item.sourceHash = hash({
      original: row.original,
      options: { ...o, account: undefined },
    });
    const col =
      o.kind === "contacts"
        ? "people"
        : o.kind === "companies"
          ? "organisations"
          : "events";
    let candidates: Document[] = [];
    let confident = false;
    if (o.kind === "contacts") {
      const points = v.email
        ? await db
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
            .limit(101)
            .toArray()
        : [];
      const ids = [...new Set(points.map((p) => p.personId))];
      candidates = await db
        .collection("people")
        .find(
          {
            workspaceId: w,
            archived: { $ne: true },
            ...(ids.length
              ? { id: { $in: ids } }
              : {
                  firstName: exactName(v.firstName),
                  ...(v.lastName
                    ? { lastName: exactName(v.lastName) }
                    : {
                        $or: [
                          { lastName: { $exists: false } },
                          { lastName: "" },
                        ],
                      }),
                }),
          },
          { session },
        )
        .limit(21)
        .toArray();
      confident =
        points.length <= 100 &&
        ids.length === 1 &&
        candidates.length === 1 &&
        normalName(candidates[0]!.firstName) === normalName(v.firstName) &&
        normalName(candidates[0]!.lastName) === normalName(v.lastName) &&
        !/^(info|sales|hello|support|admin|office|contact|enquiries|accounts)@/i.test(
          v.email,
        );
    } else if (o.kind === "companies") {
      candidates = await db
        .collection("organisations")
        .find(
          {
            workspaceId: w,
            archived: { $ne: true },
            $or: [
              { name: exactName(v.company) },
              ...(v.normalizedDomain
                ? [{ normalizedDomain: v.normalizedDomain }]
                : []),
            ],
          },
          { session },
        )
        .limit(21)
        .toArray();
      confident =
        candidates.length === 1 &&
        !!v.normalizedDomain &&
        candidates[0]!.normalizedDomain === v.normalizedDomain &&
        normalName(candidates[0]!.name) === normalName(v.company);
    }
    item.candidates = [];
    for (const c of candidates.slice(0, 20)) {
      const label =
        c.name ??
        c.displayName ??
        [c.firstName, c.lastName].filter(Boolean).join(" ");
      let context = c.normalizedDomain ?? c.title ?? "";
      if (o.kind === "contacts" && !confident) {
        const relationships = await db
          .collection("organisation_relationships")
          .find(
            {
              workspaceId: w,
              personId: c.id,
              current: true,
              archived: { $ne: true },
            },
            { session },
          )
          .limit(3)
          .toArray();
        const organisations = await db
          .collection("organisations")
          .find(
            {
              workspaceId: w,
              id: { $in: relationships.map((r) => r.organisationId) },
              archived: { $ne: true },
            },
            { session },
          )
          .limit(3)
          .toArray();
        context = [context, ...organisations.map((o) => o.name)]
          .filter(Boolean)
          .join(" · ");
      }
      item.candidates.push({
        id: c.id,
        name: [label, context].filter(Boolean).join(" — "),
      });
    }
    // Exact source replay is safe even for a person with no email; legacy snapshots remain readable.
    let previous = await db
      .collection("events")
      .find(
        {
          workspaceId: w,
          eventType: "hubspot_import_record",
          "payload.sourceReference": v.sourceReference,
        },
        { session },
      )
      .sort({ createdAt: -1, id: -1 })
      .limit(1)
      .next();
    if (!previous && o.kind === "emails") {
      const legacy = await db
        .collection("events")
        .find(
          {
            workspaceId: w,
            eventType: "hubspot_import_record",
            "payload.kind": "emails",
            "payload.values.emailData.occurredAt": v.emailData.occurredAt,
          },
          { session },
        )
        .limit(201)
        .toArray();
      if (legacy.length > 200) {
        item.status = "review";
        item.issues.push(
          "Too many possible messages at this timestamp; review before importing.",
        );
        continue;
      }
      previous =
        legacy.find(
          (p) =>
            hash(
              emailIdentity(p.payload.values.emailData, p.payload.sourceId),
            ) === hash(emailIdentity(v.emailData, v.sourceId)),
        ) ?? null;
    }
    const targetKey =
      o.kind === "contacts"
        ? "personId"
        : o.kind === "companies"
          ? "companyId"
          : "eventId";
    // No-email source replay requires the full original record to agree, not just a name.
    if (
      previous &&
      o.kind !== "emails" &&
      !confident &&
      previous.payload.sourceHash !== item.sourceHash
    )
      previous = null;
    let target: Document | null = null;
    if (previous) {
      target = await db.collection(col).findOne(
        {
          workspaceId: w,
          id: previous.payload[targetKey],
          archived: { $ne: true },
        },
        { session },
      );
      if (!target) {
        item.status = "review";
        item.issues.push(
          "Previously imported record is missing or deleted. Restore or resolve it before reimporting.",
        );
        continue;
      }
      // A newly shared email/domain must be reviewed even if an earlier import matched.
      if (candidates.length > 1 && !row.resolution) {
        item.status = "review";
        item.issues.push(
          "Multiple records share this identity. Choose a record or skip this row.",
        );
        continue;
      }
    }
    if (row.resolution?.action === "match") {
      target = candidates.find((c) => c.id === row.resolution!.id) ?? null;
      if (!target || candidates.length > 20) {
        item.status = "review";
        item.issues.push(
          "Selected match is no longer available. Review the current candidates.",
        );
        continue;
      }
      if (previous?.payload[targetKey] !== target.id) previous = null;
    } else if (!target && confident) target = candidates[0]!;
    if (row.resolution?.action === "create") {
      if (previous) {
        item.status = "review";
        item.issues.push(
          "This exact source was already imported. It cannot be imported again as a new record.",
        );
        continue;
      }
      target = null;
    } else if (!target && candidates.length) {
      item.status = "review";
      item.issues.push(
        "Possible existing records found. Choose the correct record, confirm this is a separate record, or skip. Names alone are not merged.",
      );
      continue;
    }
    if (target) {
      item[targetKey] = target.id;
      item.status = "existing";
      if (!previous && o.kind !== "emails") {
        previous = await db
          .collection("events")
          .find(
            {
              workspaceId: w,
              eventType: "hubspot_import_record",
              [`payload.${targetKey}`]: target.id,
            },
            { session },
          )
          .sort({ createdAt: -1, id: -1 })
          .limit(1)
          .next();
      }
      item.unchanged = previous?.payload.sourceHash === item.sourceHash;
      item.conflicts = [];
      const pairs =
        o.kind === "contacts"
          ? [
              ["firstName", "firstName"],
              ["lastName", "lastName"],
              ["jobTitle", "title"],
            ]
          : [
              ["company", "name"],
              ["industry", "industry"],
              ["normalizedDomain", "normalizedDomain"],
            ];
      for (const [source, field] of pairs)
        if (
          v[source!] &&
          target[field!] &&
          normalName(v[source!]) !== normalName(target[field!])
        ) {
          item.conflicts.push(
            `${source}: saved “${target[field!]}”; imported “${v[source!]}”`,
          );
        }
      if (item.conflicts.length)
        item.issues.push(
          "Conflicting values retained as source evidence; saved record values will not be overwritten.",
          ...item.conflicts,
        );
      if (!item.unchanged)
        item.issues.push(
          "Matched existing record. Source history and restrictions will be retained; existing fields stay unchanged.",
        );
    }
    item.previous = previous?.id ?? null;
    if (
      previous?.payload.values.sourceUpdatedAt &&
      v.sourceUpdatedAt &&
      v.sourceUpdatedAt < previous.payload.values.sourceUpdatedAt
    ) {
      item.status = "review";
      item.issues.push(
        "This export predates the saved source version. Use the latest export.",
      );
      continue;
    }
    if (o.kind === "contacts") {
      item.organisationIds = [];
      for (const sid of v.associationIds) {
        const evidence = await db
          .collection("events")
          .find(
            {
              workspaceId: w,
              eventType: "hubspot_import_record",
              "payload.kind": "companies",
              "payload.sourceId": sid,
            },
            { session },
          )
          .limit(101)
          .toArray();
        const ids = [...new Set(evidence.map((e) => e.payload.companyId))];
        const matches = v.company
          ? await db
              .collection("organisations")
              .find(
                {
                  workspaceId: w,
                  id: { $in: ids },
                  name: exactName(v.company),
                  archived: { $ne: true },
                },
                { session },
              )
              .limit(2)
              .toArray()
          : [];
        if (matches.length === 1 && evidence.length <= 100)
          item.organisationIds.push(matches[0]!.id);
        else
          item.issues.push(
            "Source company association could not be confirmed by name. Company reference retained as evidence; no employment link created.",
          );
      }
      if (!v.associationIds.length && v.company && o.associateByName) {
        const candidates = await db
          .collection("organisations")
          .find(
            { workspaceId: w, name: v.company, archived: { $ne: true } },
            { session },
          )
          .limit(2)
          .toArray();
        if (candidates.length === 1) {
          item.organisationIds.push(candidates[0]!.id);
          item.issues.push(
            "Employment will be linked to the unique company-name match you authorised for this import.",
          );
        } else {
          item.status = "review";
          item.issues.push(
            "Company-name association is missing or ambiguous. Review or disable name-based association.",
          );
        }
      }
      if (!v.associationIds.length && v.company && !o.associateByName)
        item.issues.push(
          "Company name retained as evidence; no explicit company ID was exported, so employment is not inferred.",
        );
      if (!v.email)
        item.issues.push(
          "Person retained with no current email; this does not establish departure.",
        );
    }
    if (v.currentCustomer && v.lifecycle !== "customer")
      item.issues.push(
        "Current Customer is true but Lifecycle Stage differs. Both source values are retained; resolve customer status before acquisition.",
      );
    if (v.originalLifecycle && v.lifecycle === "unknown")
      item.issues.push(
        "Unmapped lifecycle retained as unknown. Select a mapping before import if known; acquisition remains unresolved.",
      );
    if (o.kind === "emails") {
      const points = await db
        .collection("contact_points")
        .find(
          {
            workspaceId: w,
            type: "email",
            normalizedValue: { $in: v.emailData.addresses },
            archived: { $ne: true },
          },
          { session },
        )
        .limit(101)
        .toArray();
      const ambiguous = v.emailData.addresses.some(
        (address: string) =>
          new Set(
            points
              .filter((p) => p.normalizedValue === address)
              .map((p) => p.personId),
          ).size > 1,
      );
      item.personIds = ambiguous
        ? []
        : [...new Set(points.map((p) => p.personId))];
      if (ambiguous)
        item.issues.push(
          "An address matches multiple people. Message retained unlinked for review.",
        );
      if (points.length > 100) {
        item.status = "review";
        item.issues.push("Too many participants; review this message.");
      }
      if (!item.personIds.length)
        item.issues.push(
          "No participant matched. Retained as unlinked email history for later review.",
        );
      item.values.company = v.emailData.subject;
    }
  }
  return {
    rows,
    digest: hash({ input, rows }),
    counts: {
      total: rows.length,
      created: rows.filter((r) => r.status === "create").length,
      duplicate: rows.filter((r) => r.status === "existing").length,
      rejected: rows.filter((r) => ["review", "skip"].includes(r.status))
        .length,
    },
  };
}
export async function commitHubspot(
  db: Db,
  w: string,
  input: Input,
  digest: string,
  actor: Document,
  now: Date,
  session: ClientSession,
) {
  const previous = await db.collection("events").findOne(
    {
      workspaceId: w,
      eventType: "hive_import_completed",
      "payload.requestKey": input.requestKey,
    },
    { session },
  );
  if (previous) {
    if (previous.payload.inputHash !== hash(input))
      throw new HiveConflict("Import key reused with different data");
    return {
      ...previous.payload,
      results: (
        await db
          .collection("events")
          .find(
            {
              workspaceId: w,
              eventType: "hubspot_import_results",
              "payload.importId": previous.payload.importId,
            },
            { session },
          )
          .sort({ "payload.part": 1 })
          .toArray()
      ).flatMap((e) => e.payload.results),
    };
  }
  const preview = await previewHubspot(db, w, input, session);
  if (
    preview.digest !== digest ||
    preview.rows.some((r) => r.status === "review")
  )
    throw new HiveConflict("Review changed or unresolved import rows.");
  const importId = generatePlatformId("import"),
    o = input.hubspot!;
  const base = (
    prefix: Parameters<typeof generatePlatformId>[0],
    reference: string,
  ) => ({
    id: generatePlatformId(prefix),
    workspaceId: w,
    createdAt: now,
    updatedAt: now,
    createdBy: actor,
    updatedBy: actor,
    source: { system: "hubspot", reference, importedAt: now },
  });
  const event = async (type: string, payload: Document, reference: string) => {
    const doc = EventSchema.parse({
      ...base("event", reference),
      eventType: type,
      occurredAt: now,
      payload,
    });
    await db.collection("events").insertOne(doc, { session });
    return doc.id;
  };
  const results: Document[] = [];
  let updated = 0;
  for (const item of preview.rows) {
    const original = input.rows.find((r) => r.row === item.row)!.original;
    const v = item.values;
    if (item.status === "skip") {
      results.push({ row: item.row, status: "skip" });
      continue;
    }
    if (item.unchanged) {
      results.push({
        row: item.row,
        status: "existing",
        personId: item.personId,
        companyId: item.companyId,
        eventId: item.eventId,
      });
      continue;
    }
    let personId = item.personId,
      companyId = item.companyId,
      eventId = item.eventId;
    if (o.kind === "companies" && !companyId) {
      const doc = OrganisationSchema.parse({
        ...base("org", v.sourceReference),
        name: v.company,
        type: v.lifecycle === "customer" ? "customer" : "prospect",
        ...(v.website
          ? { website: v.website, normalizedDomain: v.normalizedDomain }
          : {}),
        ...(v.industry ? { industry: v.industry } : {}),
        ...(v.phone ? { telephone: { label: "main", value: v.phone } } : {}),
        ...(v.address || v.city || v.postalCode
          ? {
              address: {
                line1: v.address,
                city: v.city,
                postalCode: v.postalCode,
              },
            }
          : {}),
        ...(v.country && /^[A-Z]{2}$/i.test(v.country)
          ? { country: v.country.toUpperCase() }
          : {}),
        ...(v.employees !== undefined
          ? { size: { employees: v.employees } }
          : {}),
      });
      await db.collection("organisations").insertOne(doc, { session });
      companyId = doc.id;
    }
    if (o.kind === "contacts" && !personId) {
      const doc = PersonSchema.parse({
        ...base("person", v.sourceReference),
        firstName: v.firstName,
        ...(v.lastName ? { lastName: v.lastName } : {}),
        displayName: [v.firstName, v.lastName].filter(Boolean).join(" "),
        ...(v.jobTitle ? { title: v.jobTitle } : {}),
      });
      await db.collection("people").insertOne(doc, { session });
      personId = doc.id;
      if (v.phone && /^[+\d\s().-]{5,100}$/.test(v.phone)) {
        await db.collection("contact_points").insertOne(
          ContactPointSchema.parse({
            ...base("contact", v.sourceReference),
            personId,
            type: "phone",
            value: v.phone,
            normalizedValue: normalizeContactValue("phone", v.phone),
            primary: true,
          }),
          { session },
        );
      }
      if (v.email) {
        const point = ContactPointSchema.parse({
          ...base("contact", v.sourceReference),
          personId,
          type: "email",
          value: v.email,
          normalizedValue: v.email,
          primary: true,
          suppressed: v.addressRestricted.length > 0,
        });
        await db.collection("contact_points").insertOne(point, { session });
      }
    }
    // Existing HVM facts are never overwritten on re-import. Source context is versioned separately.
    if (o.kind === "contacts") {
      for (const orgId of item.organisationIds) {
        if (
          !(await db.collection("organisation_relationships").findOne(
            {
              workspaceId: w,
              personId,
              organisationId: orgId,
              archived: { $ne: true },
            },
            { session },
          ))
        )
          await db.collection("organisation_relationships").insertOne(
            OrganisationRelationshipSchema.parse({
              ...base("orgrel", v.sourceReference),
              personId,
              organisationId: orgId,
              current: true,
              ...(v.jobTitle ? { jobTitle: v.jobTitle } : {}),
            }),
            { session },
          );
      }
      if (v.addressRestricted.length) {
        await db.collection("contact_points").updateMany(
          {
            workspaceId: w,
            personId,
            type: "email",
            normalizedValue: v.email,
          },
          { $set: { suppressed: true, updatedAt: now, updatedBy: actor } },
          { session },
        );
      }
    }
    if (o.kind === "emails" && !eventId) {
      const e = v.emailData;
      const linked = item.personIds.length > 0;
      const doc = EventSchema.parse({
        ...base("event", v.sourceReference),
        eventType:
          linked && e.direction !== "Forwarded"
            ? "email"
            : "hubspot_email_history",
        occurredAt: new Date(e.occurredAt),
        ...(linked ? { personIds: item.personIds } : {}),
        ...(linked && e.direction !== "Forwarded"
          ? {
              interaction: {
                subject: e.subject,
                body: e.body,
                actor: { type: actor.type, id: actor.id },
                details: {
                  type: "email",
                  direction:
                    e.direction === "Incoming" ? "inbound" : "outbound",
                  outcome:
                    e.direction === "Incoming"
                      ? "received"
                      : e.sendStatus === "Sent"
                        ? "sent"
                        : "unknown",
                  references: {
                    messageId: v.sourceReference,
                    ...(e.inReplyTo && o.account
                      ? { threadId: `${o.account}:emails:${e.inReplyTo}` }
                      : {}),
                  },
                },
              },
            }
          : {}),
        payload: { hubspotEmail: e, importId, unlinked: !linked },
      });
      await db.collection("events").insertOne(doc, { session });
      eventId = doc.id;
    }
    if (
      v.lastEngagedAt &&
      new Date(v.lastEngagedAt) <= now &&
      (personId || companyId)
    ) {
      await db.collection("events").insertOne(
        EventSchema.parse({
          ...base("event", v.sourceReference),
          eventType: "hubspot_engagement_observed",
          occurredAt: new Date(v.lastEngagedAt),
          ...(personId ? { personId } : { organisationId: companyId }),
          payload: {
            sourceField: "Last Engagement Date / Last Contacted",
            importId,
          },
        }),
        { session },
      );
    }
    const snapshot = {
      sourceReference: v.sourceReference,
      sourceHash: item.sourceHash,
      kind: o.kind,
      ...(o.account ? { account: o.account } : {}),
      sourceId: v.sourceId,
      matchingVersion: 2,
      resolution:
        input.rows.find((r) => r.row === item.row)?.resolution ?? null,
      conflicts: item.conflicts ?? [],
      personId,
      companyId,
      eventId,
      values: v,
      importId,
    };
    // Original export remains recoverable in bounded observations (including unknown fields).
    let fields: Document[] = [];
    let bytes = 0,
      part = 0;
    const flush = async () => {
      if (!fields.length) return;
      await event(
        "hubspot_source_field",
        { sourceReference: v.sourceReference, importId, part: part++, fields },
        v.sourceReference,
      );
      fields = [];
      bytes = 0;
    };
    for (const [key, value] of Object.entries(original)) {
      if (!value) continue;
      for (let start = 0; start < value.length; start += 3000) {
        const field = {
          key,
          value: value.slice(start, start + 3000),
          offset: start,
        };
        const size = Buffer.byteLength(JSON.stringify(field));
        if (bytes + size > 10000) await flush();
        fields.push(field);
        bytes += size;
      }
    }
    await flush();
    await event("hubspot_import_record", snapshot, v.sourceReference);
    const target =
      o.kind === "companies"
        ? "organisations"
        : o.kind === "contacts"
          ? "people"
          : "events";
    if (
      !(await db
        .collection(target)
        .findOne(
          { workspaceId: w, id: companyId ?? personId ?? eventId },
          { session },
        ))
    )
      throw new Error("Imported record readback failed");
    if (item.status === "existing") updated++;
    results.push({
      row: item.row,
      status: item.status,
      personId,
      companyId,
      eventId,
    });
  }
  const payload = {
    importId,
    requestKey: input.requestKey,
    inputHash: hash(input),
    jobId: input.jobId,
    batchIndex: input.batchIndex,
    counts: { ...preview.counts, updated },
    verified: true,
    results,
  };
  // Receipts stay small even for a 200-row batch; replay returns the same bounded result chunks.
  for (let i = 0; i < results.length; i += 40)
    await event(
      "hubspot_import_results",
      { importId, part: i / 40, results: results.slice(i, i + 40) },
      input.requestKey,
    );
  const { results: unused, ...receipt } = payload;
  void unused;
  await event("hive_import_completed", receipt, input.requestKey);
  return payload;
}
