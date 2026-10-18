import type { ClientSession, Db } from "mongodb";
import { HiveConflict } from "../hive-definitions";
export const ESOS_SUPPORTING_SOURCE = "hvm_esos_supporting";
export const ESOS_RECOVERY_WORKSPACE = "workspace_01m48b67s2hnqnhwkyj1tkb3qw";
export const ESOS_RECOVERY_JOB =
  "4121b56bb1a1a8f0ac917e5d04bc534000339e352b63b4039c1ac51f5d2896bb";
export async function recoveryComplete(
  db: Db,
  workspaceId: string,
  jobId: string,
  session?: ClientSession,
) {
  return Boolean(
    await db.collection("events").findOne(
      {
        workspaceId,
        eventType: "hive_esos_reconciled",
        "payload.jobId": jobId,
        "payload.status": "completed",
      },
      { session },
    ),
  );
}
export async function checkRecovery(
  db: Db,
  workspaceId: string,
  input: { jobId?: string; replacesJobId?: string },
  session?: ClientSession,
) {
  if (
    workspaceId === ESOS_RECOVERY_WORKSPACE &&
    input.jobId === ESOS_RECOVERY_JOB
  )
    throw new HiveConflict(
      "This earlier ESOS import is closed. Review the workbook again using the corrected importer.",
    );
  if (
    input.replacesJobId &&
    (!input.jobId ||
      input.jobId === input.replacesJobId ||
      !(await recoveryComplete(db, workspaceId, input.replacesJobId, session)))
  )
    throw new HiveConflict(
      "The earlier import must be reconciled before starting this import.",
    );
}
