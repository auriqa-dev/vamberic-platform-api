import type { Db, ClientSession } from "mongodb";
import { HiveConflict } from "../hive-definitions";
import { executorData, executionData, type ContentRecord } from "./model";

/** Operational resources are workspace records, never fake software integrations. */
export async function validateExecutor(
  db: Db,
  session: ClientSession,
  workspaceId: string,
  raw: unknown,
) {
  const data = executorData.parse(raw);
  for (const id of data.capabilityIds) {
    if (
      !(await db
        .collection("capabilities")
        .findOne({ id, archived: { $ne: true } }, { session }))
    )
      throw new HiveConflict("Select an available registered capability.");
  }
  if (data.executorType === "internal_hvm" && !data.capabilityIds.length)
    throw new HiveConflict(
      "An internal executor requires a registered capability.",
    );
  if (data.executorType === "external_application") {
    if (
      !data.integrationId ||
      !(await db.collection("workspace_integrations").findOne(
        {
          id: data.integrationId,
          workspaceId,
          status: "connected",
          archived: { $ne: true },
        },
        { session },
      ))
    )
      throw new HiveConflict(
        "Select a connected application in this workspace.",
      );
  } else if (data.integrationId)
    throw new HiveConflict(
      "Human and internal resources are not software integrations.",
    );
  if (!data.capabilities.length && !data.capabilityIds.length)
    throw new HiveConflict(
      "Describe at least one capability this executor provides.",
    );
}

export async function validateExecution(
  db: Db,
  session: ClientSession,
  workspaceId: string,
  raw: unknown,
  all: ContentRecord[],
  previous?: ContentRecord,
) {
  const data = executionData.parse(raw);
  if (
    previous &&
    ["briefId", "briefVersion", "executorId"].some(
      (k) => previous.data[k] !== data[k as keyof typeof data],
    )
  )
    throw new HiveConflict(
      "Cancel this assignment and create a new one to change its approved brief or executor.",
    );
  const brief = all.find(
    (r) =>
      r.id === data.briefId && r.kind === "brief" && r.status !== "removed",
  );
  const executor = all.find(
    (r) =>
      r.id === data.executorId &&
      r.kind === "executor" &&
      r.status !== "removed",
  );
  const history = await db.collection("events").findOne(
    {
      workspaceId,
      eventType: "content_strategy_record",
      "payload.record.id": data.briefId,
      "payload.record.version": data.briefVersion,
      "payload.record.status": "approved",
    },
    { session },
  );
  if (
    !brief ||
    !history ||
    !executor ||
    (!previous &&
      (!executor.data.available ||
        brief.status !== "approved" ||
        brief.version !== data.briefVersion))
  )
    throw new HiveConflict(
      "Assign a current approved brief to an available executor.",
    );
  if (
    JSON.stringify(data.scope) !==
    JSON.stringify(history.payload.record.data.scope)
  )
    throw new HiveConflict(
      "The assignment must retain the approved brief's business scope.",
    );
  if (
    previous &&
    ["completed", "cancelled"].includes(String(previous.data.progress)) &&
    data.progress !== previous.data.progress
  )
    throw new HiveConflict(
      "A completed or cancelled execution cannot be restarted. Create a new assignment.",
    );
  const order = [
    "proposed",
    "approved",
    "assigned",
    "accepted",
    "in_progress",
    "awaiting_input",
    "completed",
    "cancelled",
  ];
  if (!previous && !["proposed", "assigned"].includes(data.progress))
    throw new HiveConflict("Start with a proposed or assigned execution.");
  if (
    previous &&
    data.progress !== "cancelled" &&
    !["in_progress", "awaiting_input"].includes(data.progress) &&
    order.indexOf(data.progress) < order.indexOf(String(previous.data.progress))
  )
    throw new HiveConflict(
      "Progress cannot move backwards. Record a note or create a new assignment.",
    );
  if (data.progress === "completed" && !data.completedAt)
    throw new HiveConflict("Record the completion date.");
  if (data.progress !== "completed" && data.completedAt)
    throw new HiveConflict(
      "A completion date is only valid for completed work.",
    );
  return history.payload.record as ContentRecord;
}

/** Read-side eligibility is deliberately narrower than "published externally" or "completed". */
export function assetReuseEligibility(
  asset: ContentRecord,
  all: ContentRecord[],
) {
  const allowedUses = Array.isArray(asset.data.allowedUses)
    ? (asset.data.allowedUses as string[])
    : [];
  const fresh = asset.sourceVersions.every((ref) =>
    all.some(
      (r) =>
        r.id === ref.id &&
        r.status !== "removed" &&
        (r.version === ref.version ||
          ["executor", "execution"].includes(r.kind)),
    ),
  );
  const eligible =
    asset.kind === "asset" &&
    asset.data.archived !== true &&
    asset.status === "approved" &&
    fresh &&
    ["owned", "licensed", "reference_only"].includes(
      String(asset.data.usageRights),
    ) &&
    allowedUses.length > 0;
  return {
    eligible,
    allowedUses,
    reason: eligible
      ? "Use only for the recorded purposes and restrictions; channel and recipient policies still apply."
      : "Requires approval, current sources and explicit rights with permitted uses.",
  };
}
