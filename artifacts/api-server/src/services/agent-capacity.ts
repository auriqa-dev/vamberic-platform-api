import { isDeepStrictEqual } from "node:util";
import type { ClientSession, Db } from "mongodb";
import { z } from "zod";
import {
  CapacityReleaseSchema,
  CapacityObservationSchema,
  ExecutionSlotSchema,
  SlotBindingSchema,
  capacityFresh,
  type CapacityRelease,
  type SlotBinding,
} from "../domain/agent-capacity";
import { AuthorizationDenied } from "../authorization/policy";
import type {
  AgentWorkloadPrincipal,
  createAgentWorkloadAuthority,
} from "../authorization/agent-workload";
import type { MongoService } from "./mongo";
import { withoutMongoId } from "./hvm-context";
import { EventSchema, generatePlatformId } from "../domain/schemas";
const Report = z
  .object({
    taskArn: z.string().min(1).max(256),
    release: CapacityReleaseSchema,
    ready: z.boolean(),
  })
  .strict();
export class CapacityUnavailable extends Error {}
/** Trusted server adapter performs the ECS read; no worker-provided observer result. */
export type DeploymentObserver = (
  taskArn: string,
  release: Readonly<CapacityRelease>,
) => Promise<boolean>;
export type OwnedInvocation = (
  db: Db,
  session: ClientSession,
  principal: AgentWorkloadPrincipal,
  binding: SlotBinding,
  action: "acquire" | "send" | "terminal" | "quarantine",
) => Promise<void>;
/** Inactive until explicitly composed. No startup DDL, expiry takeover or financial refund. */
export function createAgentCapacity(
  mongo: MongoService,
  authority: ReturnType<typeof createAgentWorkloadAuthority>,
  releaseValue: CapacityRelease,
  observer: DeploymentObserver,
  owned: OwnedInvocation,
  clock = () => new Date(),
  options?: {
    version: number;
    lock: (db: Db, session: ClientSession) => Promise<unknown>;
  },
) {
  const release = CapacityReleaseSchema.parse(releaseValue);
  async function transaction<T>(
    work: (db: Db, session: ClientSession) => Promise<T>,
  ) {
    if (!mongo.withTransaction) throw new CapacityUnavailable();
    return mongo.withTransaction(async (db, session) => {
      const ledger = await db
        .collection("schema_versions")
        .findOne({ _id: "vapp-v1" } as never, { session });
      if (
        !ledger ||
        !(
          options?.version === 23 ? [23, 24, 25] : [options?.version ?? 22]
        ).includes(ledger?.version ?? 0) ||
        (ledger.schemaVersion !== undefined &&
          ledger.schemaVersion !== ledger.version)
      )
        throw new CapacityUnavailable();
      await options?.lock(db, session);
      return work(db, session);
    });
  }
  function authenticate(principal: AgentWorkloadPrincipal) {
    authority.require(principal, "capacity");
    if (
      principal.environment !== release.environment ||
      principal.clientId !== release.workloadClientId ||
      principal.workloadClass !== release.workloadClass
    )
      throw new AuthorizationDenied();
  }
  const observationId = (principal: AgentWorkloadPrincipal) =>
    `${release.environment}:${release.workloadClass}:${principal.workerId}`;
  async function audit(
    db: Db,
    session: ClientSession,
    binding: SlotBinding,
    state: string,
    revision: number,
  ) {
    const now = clock();
    await db.collection("events").insertOne(
      EventSchema.parse({
        id: generatePlatformId("event"),
        workspaceId: binding.workspaceId,
        createdAt: now,
        updatedAt: now,
        occurredAt: now,
        eventType: "agent_run_changed",
        payload: {
          application: "hvmapp",
          operation: "provider_execution_slot",
          binding,
          state,
          revision,
        },
      }),
      { session },
    );
  }
  async function available(db: Db, session: ClientSession, lock: boolean) {
    const ledger = await db
      .collection("schema_versions")
      .findOne({ _id: "vapp-v1" } as never, { session });
    if (
      !ledger ||
      !(options?.version === 23 ? [23, 24, 25] : [options?.version ?? 22]).includes(
        ledger?.version ?? 0,
      ) ||
      (ledger.schemaVersion !== undefined &&
        ledger.schemaVersion !== ledger.version)
    )
      throw new CapacityUnavailable();
    const rows = await db
      .collection("agent_capacity_observations")
      .find(
        {
          "release.environment": release.environment,
          reportedAt: { $gt: new Date(clock().getTime() - 30000) },
        },
        { session },
      )
      .sort({ reportedAt: -1 })
      .limit(32)
      .toArray();
    for (const raw of rows) {
      const row = CapacityObservationSchema.parse(withoutMongoId(raw));
      if (
        !isDeepStrictEqual(row.release, release) ||
        !capacityFresh(row, clock())
      )
        continue;
      if (lock) {
        const changed = await db
          .collection("agent_capacity_observations")
          .updateOne(
            { id: row.id, revision: row.revision },
            { $set: { revision: row.revision + 1 } },
            { session },
          );
        if (changed.matchedCount !== 1) throw new CapacityUnavailable();
      }
      return true;
    }
    return false;
  }
  return {
    ready: (db: Db, session: ClientSession) => available(db, session, false),
    async report(principal: AgentWorkloadPrincipal, input: unknown) {
      authenticate(principal);
      const report = Report.parse(input);
      if (!isDeepStrictEqual(report.release, release))
        throw new AuthorizationDenied();
      return transaction(async (db, session) => {
        const collection = db.collection("agent_capacity_observations");
        const id = observationId(principal);
        const previous = await collection.findOne({ id }, { session });
        const parsed = CapacityObservationSchema.parse({
          id,
          release,
          workerId: principal.workerId,
          taskArn: report.taskArn,
          roles: ["maker", "evaluator", "revision"],
          ready: report.ready,
          reportedAt: clock(),
          deploymentMatches:
            previous?.taskArn === report.taskArn &&
            isDeepStrictEqual(previous.release, release)
              ? previous.deploymentMatches
              : false,
          ...(previous?.taskArn === report.taskArn && previous.observedAt
            ? { observedAt: previous.observedAt }
            : {}),
          revision: (previous?.revision ?? 0) + 1,
        });
        if (previous) {
          const changed = await collection.updateOne(
            { id, revision: previous.revision },
            { $set: parsed },
            { session },
          );
          if (changed.matchedCount !== 1) throw new CapacityUnavailable();
        } else await collection.insertOne(parsed, { session });
        return { accepted: true };
      });
    },
    /** Invoke from a trusted ten-second scheduler; never exposed to workloads. */
    async observe() {
      const db = await mongo.database();
      const rows = await db
        .collection("agent_capacity_observations")
        .find({
          "release.environment": release.environment,
          reportedAt: { $gt: new Date(clock().getTime() - 30_000) },
        })
        .sort({ reportedAt: -1 })
        .limit(32)
        .toArray();
      for (const raw of rows) {
        const row = CapacityObservationSchema.parse(withoutMongoId(raw));
        if (!isDeepStrictEqual(row.release, release)) continue;
        let matches = false;
        try {
          matches = await observer(row.taskArn, release);
        } catch {
          /* unavailable is false, no raw error logging */
        }
        const observedAt = clock();
        await transaction(async (db, session) => {
          await db.collection("agent_capacity_observations").updateOne(
            { id: row.id, revision: row.revision },
            {
              $set: {
                observedAt,
                deploymentMatches: matches,
                revision: row.revision + 1,
              },
            },
            { session },
          );
        });
      }
    },
    async available() {
      return transaction((db, session) => available(db, session, false));
    },
    async admit(db: Db, session: ClientSession) {
      return available(db, session, true);
    },
    async transition(
      principal: AgentWorkloadPrincipal,
      input: unknown,
      action: "acquire" | "terminal" | "quarantine",
    ) {
      authenticate(principal);
      const binding = SlotBindingSchema.parse(input);
      if (
        binding.workerId !== principal.workerId ||
        binding.workloadClientId !== principal.clientId ||
        !isDeepStrictEqual(binding.release, release)
      )
        throw new AuthorizationDenied();
      return transaction(async (db, session) => {
        // Must serialize existing Run/Attempt/authority dependencies in this same transaction.
        await owned(db, session, principal, binding, action);
        const collection = db.collection("agent_execution_slots"),
          id = "dev:agent_runtime";
        const raw = await collection.findOne({ id }, { session });
        const previous = raw
          ? ExecutionSlotSchema.parse(withoutMongoId(raw))
          : undefined;
        const exact = previous && isDeepStrictEqual(previous.binding, binding);
        if (action === "acquire") {
          // Replays never authorize another provider request, even after release.
          if (exact || (previous && previous.state !== "released"))
            throw new CapacityUnavailable();
          const observations = db.collection("agent_capacity_observations");
          const rawObservation = await observations.findOne(
            { id: observationId(principal) },
            { session },
          );
          if (!rawObservation) throw new CapacityUnavailable();
          const row = CapacityObservationSchema.parse(
            withoutMongoId(rawObservation),
          );
          if (
            !isDeepStrictEqual(row.release, release) ||
            !capacityFresh(row, clock())
          )
            throw new CapacityUnavailable();
          const lock = await observations.updateOne(
            { id: row.id, revision: row.revision },
            { $set: { revision: row.revision + 1 } },
            { session },
          );
          if (lock.matchedCount !== 1) throw new CapacityUnavailable();
          // An invocation cannot be reused after later invocations replaced the slot.
          if (
            await db.collection("events").findOne(
              {
                "payload.operation": "provider_execution_slot",
                "payload.binding.runId": binding.runId,
                "payload.binding.attemptId": binding.attemptId,
                "payload.binding.invocationId": binding.invocationId,
              },
              { session },
            )
          )
            throw new CapacityUnavailable();
        } else if (!exact || previous?.state !== "occupied")
          throw new CapacityUnavailable();
        const state =
          action === "acquire"
            ? "occupied"
            : action === "terminal"
              ? "released"
              : "quarantined";
        const next = ExecutionSlotSchema.parse({
          id,
          state,
          binding,
          revision: (previous?.revision ?? 0) + 1,
          updatedAt: clock(),
        });
        if (previous) {
          const changed = await collection.updateOne(
            { id, revision: previous.revision },
            { $set: next },
            { session },
          );
          if (changed.matchedCount !== 1) throw new CapacityUnavailable();
        } else await collection.insertOne(next, { session });
        await audit(db, session, binding, state, next.revision);
        return { accepted: true, state };
      });
    },
  };
}
