import type { ClientSession, Db, Document } from "mongodb";
import { EventSchema, generatePlatformId } from "../../domain";
import { lockIcpWorkspace } from "./access";
import { ESOS_SUPPORTING_SOURCE } from "./esos-recovery";
export type RepairManifest = {
  workspaceId: string;
  jobId: string;
  expected: [string, string, boolean][];
  hashes: string[];
};
const requireMatch = (ok: unknown) => {
  if (!ok)
    throw new Error("Repair precondition failed; no partial repair permitted");
};
export async function inspectEsosRepair(
  db: Db,
  m: RepairManifest,
  session?: ClientSession,
) {
  const w = m.workspaceId;
  const receipts = await db
    .collection("events")
    .find(
      {
        workspaceId: w,
        eventType: "hive_import_completed",
        "payload.jobId": m.jobId,
      },
      { session },
    )
    .limit(m.hashes.length + 1)
    .toArray();
  requireMatch(receipts.length === m.hashes.length);
  const receiptMap = new Map(
    receipts.map((r) => [r.payload.importId, r.payload]),
  );
  requireMatch(
    new Set(receipts.map((r) => r.payload.batchIndex)).size === m.hashes.length,
  );
  for (const r of receipts)
    requireMatch(
      r.payload.verified === true &&
        r.payload.inputHash === m.hashes[r.payload.batchIndex],
    );
  const rows = await db
    .collection("events")
    .find(
      {
        workspaceId: w,
        eventType: "hive_import_row",
        "payload.importId": { $in: [...receiptMap.keys()] },
      },
      { session },
    )
    .limit(m.expected.length + 1)
    .toArray();
  requireMatch(
    rows.length === m.expected.length &&
      new Set(rows.map((r) => r.payload.row)).size === m.expected.length,
  );
  const companies = await db
    .collection("organisations")
    .find(
      { workspaceId: w, id: { $in: rows.map((r) => r.payload.companyId) } },
      { session },
    )
    .toArray();
  const byId = new Map(companies.map((c) => [c.id, c]));
  requireMatch(
    companies.length === m.expected.length && byId.size === m.expected.length,
  );
  const supporting: Document[] = [];
  for (const row of rows) {
    const p = row.payload,
      e = m.expected[p.row - 1],
      c = byId.get(p.companyId),
      receipt = receiptMap.get(p.importId);
    requireMatch(
      e &&
        c &&
        receipt &&
        p.status === "create" &&
        !p.sourceOnly &&
        receipt.batchIndex === Math.floor((p.row - 1) / 100),
    );
    requireMatch(
      p.normalized.company === e[0] &&
        (p.normalized.registration ?? "") === e[1],
    );
    requireMatch(
      c!.name === e[0] &&
        c!.source?.system === "hvm_hive_upload" &&
        c!.source.reference === (e[1] ? `GB:${e[1]}` : p.importId),
    );
    requireMatch(
      c!.archived === false &&
        +c!.createdAt === +row.occurredAt &&
        +c!.updatedAt === +c!.createdAt,
    );
    if (!e[2]) supporting.push(c!);
  }
  return { supporting, total: rows.length };
}
function event(w: string, type: string, payload: Document, now: Date) {
  return EventSchema.parse({
    id: generatePlatformId("event"),
    workspaceId: w,
    createdAt: now,
    updatedAt: now,
    occurredAt: now,
    eventType: type,
    actor: { type: "system", id: "esos-reconciliation" },
    payload,
  });
}
export async function applyEsosRepair(
  db: Db,
  m: RepairManifest,
  session: ClientSession,
) {
  await lockIcpWorkspace(db, m.workspaceId, session);
  const marker = await db.collection("events").findOne(
    {
      workspaceId: m.workspaceId,
      eventType: "hive_esos_reconciled",
      "payload.jobId": m.jobId,
    },
    { session },
  );
  if (marker) {
    requireMatch(marker.payload.status === "completed");
    return { status: "already_completed", changed: 0 };
  }
  const checked = await inspectEsosRepair(db, m, session),
    now = new Date();
  const audit = checked.supporting.map((c) =>
    event(
      m.workspaceId,
      "hive_esos_role_repaired",
      {
        jobId: m.jobId,
        companyId: c.id,
        beforeSource: structuredClone(c.source),
        beforeUpdatedAt: new Date(c.updatedAt),
        afterSource: { ...c.source, system: ESOS_SUPPORTING_SOURCE },
        afterUpdatedAt: now,
      },
      now,
    ),
  );
  if (audit.length) {
    const result = await db.collection("organisations").bulkWrite(
      audit.map(({ payload: p }) => ({
        updateOne: {
          filter: {
            workspaceId: m.workspaceId,
            id: p.companyId,
            source: p.beforeSource,
            updatedAt: p.beforeUpdatedAt,
          },
          update: {
            $set: { source: p.afterSource, updatedAt: p.afterUpdatedAt },
          },
        },
      })),
      { session, ordered: true },
    );
    requireMatch(result.matchedCount === audit.length);
    await db.collection("events").insertMany(audit, { session, ordered: true });
    const saved = await db
      .collection("organisations")
      .find(
        {
          workspaceId: m.workspaceId,
          id: { $in: audit.map((r) => r.payload.companyId) },
          "source.system": ESOS_SUPPORTING_SOURCE,
          updatedAt: now,
        },
        { session },
      )
      .toArray();
    requireMatch(saved.length === audit.length);
  }
  await db.collection("events").insertOne(
    event(
      m.workspaceId,
      "hive_esos_reconciled",
      {
        jobId: m.jobId,
        status: "completed",
        supporting: checked.supporting.length,
        total: checked.total,
      },
      now,
    ),
    { session },
  );
  return { status: "completed", changed: checked.supporting.length };
}
export async function rollbackEsosRepair(
  db: Db,
  m: RepairManifest,
  session: ClientSession,
) {
  await lockIcpWorkspace(db, m.workspaceId, session);
  const marker = await db.collection("events").findOne(
    {
      workspaceId: m.workspaceId,
      eventType: "hive_esos_reconciled",
      "payload.jobId": m.jobId,
    },
    { session },
  );
  requireMatch(marker?.payload.status === "completed");
  requireMatch(
    !(await db.collection("events").findOne(
      {
        workspaceId: m.workspaceId,
        eventType: "hive_import_completed",
        "payload.replacesJobId": m.jobId,
      },
      { session },
    )),
  );
  const rows = await db
    .collection("events")
    .find(
      {
        workspaceId: m.workspaceId,
        eventType: "hive_esos_role_repaired",
        "payload.jobId": m.jobId,
      },
      { session },
    )
    .toArray();
  requireMatch(rows.length === marker!.payload.supporting);
  if (rows.length) {
    const result = await db.collection("organisations").bulkWrite(
      rows.map(({ payload: p }) => ({
        updateOne: {
          filter: {
            workspaceId: m.workspaceId,
            id: p.companyId,
            updatedAt: p.afterUpdatedAt,
            source: p.afterSource,
          },
          update: {
            $set: { source: p.beforeSource, updatedAt: p.beforeUpdatedAt },
          },
        },
      })),
      { session, ordered: true },
    );
    requireMatch(result.matchedCount === rows.length);
  }

  await db.collection("events").updateOne(
    {
      workspaceId: m.workspaceId,
      id: marker!.id,
      "payload.status": "completed",
    },
    { $set: { "payload.status": "rolled_back", updatedAt: new Date() } },
    { session },
  );
  return { status: "rolled_back", restored: rows.length };
}
