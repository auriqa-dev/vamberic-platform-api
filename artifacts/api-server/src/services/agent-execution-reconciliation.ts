import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { digest } from "@workspace/agent-runtime-protocol";
import type { ClientSession, Db } from "mongodb";
import { AuthorizationDenied } from "../authorization/policy";
import type {
  AgentWorkloadPrincipal,
  createAgentWorkloadAuthority,
} from "../authorization/agent-workload";
import {
  ExecutionSlotSchema,
  SlotBindingSchema,
  CapacityObservationSchema,
  capacityFresh,
  type CapacityRelease,
  type SlotBinding,
} from "../domain/agent-capacity";
import {
  ExecutionControlSchema,
  InvocationJournalSchema,
  PrepareInvocationSchema,
  validateReceipt,
  type InvocationJournal,
} from "../domain/agent-execution-evidence";
import { EventSchema, generatePlatformId } from "../domain/schemas";
import type { MongoService } from "./mongo";
import { withoutMongoId } from "./hvm-context";
import {
  CapacityUnavailable,
  createAgentCapacity,
  type DeploymentObserver,
  type OwnedInvocation,
} from "./agent-capacity";
const controlId = "dev:agent_runtime";
const invocationFilter = (b: SlotBinding) => ({
  "binding.runId": b.runId,
  "binding.attemptId": b.attemptId,
  "binding.invocationId": b.invocationId,
});
/** v23 only. No production terminal contract is qualified by default. No caller-selected policy. */
export function createExecutionReconciliation(
  mongo: MongoService,
  authority: ReturnType<typeof createAgentWorkloadAuthority>,
  release: CapacityRelease,
  observer: DeploymentObserver,
  owned: OwnedInvocation,
  clock = () => new Date(),
  qualification: {
    projectReference?: string;
    terminalContracts?: readonly string[];
  } = {},
) {
  async function lock(db: Db, session: ClientSession) {
    const ledger = await db
      .collection("schema_versions")
      .findOne({ _id: "vapp-v1" } as never, { session });
    if (
      !ledger ||
      ![23, 24, 25].includes(ledger?.version ?? 0) ||
      (ledger.schemaVersion !== undefined &&
        ledger.schemaVersion !== ledger.version)
    )
      throw new CapacityUnavailable();
    const c = db.collection("agent_execution_controls"),
      raw = await c.findOne({ id: controlId }, { session });
    const previous = raw
      ? ExecutionControlSchema.parse(withoutMongoId(raw))
      : undefined;
    const next = ExecutionControlSchema.parse({
      id: controlId,
      state: "open",
      ...previous,
      revision: (previous?.revision ?? 0) + 1,
    });
    if (previous) {
      const r = await c.updateOne(
        { id: controlId, revision: previous.revision },
        { $set: next },
        { session },
      );
      if (r.matchedCount !== 1) throw new CapacityUnavailable();
    } else await c.insertOne(next, { session });
    return next;
  }
  async function transaction<T>(fn: (db: Db, s: ClientSession) => Promise<T>) {
    if (!mongo.withTransaction) throw new CapacityUnavailable();
    return mongo.withTransaction(async (db, s) => {
      await lock(db, s);
      return fn(db, s);
    });
  }
  const base = createAgentCapacity(
    mongo,
    authority,
    release,
    observer,
    owned,
    clock,
    { version: 23, lock },
  );
  function authenticate(
    p: AgentWorkloadPrincipal,
    b: SlotBinding,
    evidence = false,
  ) {
    authority.require(p, evidence ? "execution_evidence" : "capacity");
    if (
      p.environment !== b.release.environment ||
      p.workloadClass !== b.release.workloadClass ||
      p.clientId !== b.workloadClientId ||
      p.clientId !== b.release.workloadClientId ||
      p.workerId !== b.workerId ||
      (!evidence && !isDeepStrictEqual(b.release, release))
    )
      throw new AuthorizationDenied();
  }
  async function event(
    db: Db,
    s: ClientSession,
    b: SlotBinding,
    state: string,
    details: Record<string, unknown> = {},
  ) {
    const now = clock();
    await db.collection("events").insertOne(
      EventSchema.parse({
        id: generatePlatformId("event"),
        workspaceId: b.workspaceId,
        createdAt: now,
        updatedAt: now,
        occurredAt: now,
        eventType: "agent_run_changed",
        payload: {
          application: "hvmapp",
          operation: "provider_execution_slot",
          binding: b,
          state,
          ...details,
        },
      }),
      { session: s },
    );
  }
  async function journal(db: Db, s: ClientSession, b: SlotBinding) {
    const row = await db
      .collection("agent_execution_invocations")
      .findOne(invocationFilter(b), { session: s });
    if (!row) throw new AuthorizationDenied();
    const j = InvocationJournalSchema.parse(withoutMongoId(row));
    if (!isDeepStrictEqual(j.binding, b)) throw new AuthorizationDenied();
    return j;
  }
  async function save(
    db: Db,
    s: ClientSession,
    j: InvocationJournal,
    patch: Partial<InvocationJournal>,
  ) {
    const next = InvocationJournalSchema.parse({
      ...j,
      ...patch,
      revision: j.revision + 1,
    });
    const r = await db
      .collection("agent_execution_invocations")
      .updateOne(
        { id: j.id, revision: j.revision },
        { $set: next },
        { session: s },
      );
    if (r.matchedCount !== 1) throw new CapacityUnavailable();
    return next;
  }
  async function slot(db: Db, s: ClientSession) {
    const row = await db
      .collection("agent_execution_slots")
      .findOne({ id: controlId }, { session: s });
    return row ? ExecutionSlotSchema.parse(withoutMongoId(row)) : undefined;
  }
  async function setSlot(
    db: Db,
    s: ClientSession,
    b: SlotBinding,
    state: "occupied" | "released" | "quarantined",
  ) {
    const old = await slot(db, s);
    if (state !== "occupied" && (!old || !isDeepStrictEqual(old.binding, b)))
      return false;
    if (old?.state === state && isDeepStrictEqual(old.binding, b)) return false;
    const next = ExecutionSlotSchema.parse({
      id: controlId,
      state,
      binding: b,
      revision: (old?.revision ?? 0) + 1,
      updatedAt: clock(),
    });
    if (old) {
      const r = await db
        .collection("agent_execution_slots")
        .updateOne(
          { id: controlId, revision: old.revision },
          { $set: next },
          { session: s },
        );
      if (r.matchedCount !== 1) throw new CapacityUnavailable();
    } else
      await db
        .collection("agent_execution_slots")
        .insertOne(next, { session: s });
    return true;
  }
  async function open(db: Db, s: ClientSession) {
    return (
      (
        await db
          .collection("agent_execution_controls")
          .findOne({ id: controlId }, { session: s })
      )?.state === "open"
    );
  }
  async function status(
    db: Db,
    s: ClientSession,
  ): Promise<"idle" | "busy" | "unavailable"> {
    if (
      !qualification.projectReference ||
      !qualification.terminalContracts?.length ||
      !(await open(db, s)) ||
      !(await base.ready(db, s))
    )
      return "unavailable";
    const current = await slot(db, s);
    if (!current || current.state === "released") return "idle";
    if (
      current.state === "quarantined" ||
      !isDeepStrictEqual(current.binding.release, release)
    )
      return "unavailable";
    const b = current.binding;
    const row = await db
      .collection("agent_capacity_observations")
      .findOne(
        { id: `${release.environment}:${release.workloadClass}:${b.workerId}` },
        { session: s },
      );
    const attempt = await db.collection("agent_attempts").findOne(
      {
        id: b.attemptId,
        runId: b.runId,
        workspaceId: b.workspaceId,
        status: "running",
        generation: b.generation,
        fence: b.fence,
        leaseId: b.leaseId,
        workerId: b.workerId,
        workloadClientId: b.workloadClientId,
      },
      { session: s },
    );
    const run = await db.collection("agent_runs").findOne(
      {
        id: b.runId,
        activeAttemptId: b.attemptId,
        status: "running",
        generation: b.generation,
        fence: b.fence,
      },
      { session: s },
    );
    const known = await db
      .collection("agent_execution_invocations")
      .findOne(invocationFilter(b), { session: s });
    return row &&
      isDeepStrictEqual(row.release, release) &&
      capacityFresh(
        CapacityObservationSchema.parse(withoutMongoId(row)),
        clock(),
      ) &&
      attempt?.leaseUntil > clock() &&
      run &&
      known
      ? "busy"
      : "unavailable";
  }
  async function original(db: Db, s: ClientSession, b: SlotBinding) {
    const row = await db.collection("agent_attempts").findOne(
      {
        id: b.attemptId,
        runId: b.runId,
        workspaceId: b.workspaceId,
        generation: b.generation,
        fence: b.fence,
        leaseId: b.leaseId,
        workerId: b.workerId,
        workloadClientId: b.workloadClientId,
      },
      { session: s },
    );
    if (!row) throw new AuthorizationDenied();
  }
  const service = {
    report: base.report,
    observe: async () => {
      await base.observe();
      const db = await mongo.database();
      const rows = await db
        .collection("agent_execution_invocations")
        .find({ state: "prepared" })
        .sort({ preparedAt: 1 })
        .limit(32)
        .toArray();
      for (const row of rows)
        await service.reconcile(
          InvocationJournalSchema.parse(withoutMongoId(row)).binding,
        );
    },
    status: () => transaction(status),
    available: () =>
      transaction(async (db, s) => (await status(db, s)) === "idle"),
    admit: async (db: Db, s: ClientSession) => {
      await lock(db, s);
      return (await status(db, s)) === "idle";
    },
    /** Legacy unjournaled operations are intentionally rejected, including terminal resets. */
    transition: async (
      _p: AgentWorkloadPrincipal,
      _b: unknown,
      _a: "acquire" | "terminal" | "quarantine",
    ) => {
      void _p;
      void _b;
      void _a;
      throw new CapacityUnavailable();
    },
    prepare: async (p: AgentWorkloadPrincipal, input: unknown) => {
      const { binding: b, provider } = PrepareInvocationSchema.parse(input);
      authenticate(p, b);
      if (
        provider.projectReference !== qualification.projectReference ||
        !qualification.terminalContracts?.length
      )
        throw new CapacityUnavailable();
      return transaction(async (db, s) => {
        await owned(db, s, p, b, "acquire");
        if ((await status(db, s)) !== "idle") throw new CapacityUnavailable();
        if (
          await db
            .collection("agent_execution_invocations")
            .findOne(invocationFilter(b), { session: s })
        )
          throw new CapacityUnavailable();
        const run = await db
          .collection("agent_runs")
          .findOne({ id: b.runId }, { session: s });
        const role =
          run?.frozen.operation === "understand"
            ? "maker"
            : run?.frozen.operation === "evaluate_understanding"
              ? "evaluator"
              : run?.frozen.operation === "revise_understanding"
                ? "revision"
                : undefined;
        if (
          role !== provider.role ||
          provider.model !==
            (role === "evaluator" ? "gpt-6-astra" : "gpt-6.1-sol")
        )
          throw new AuthorizationDenied();
        const observation = await db
          .collection("agent_capacity_observations")
          .findOne(
            {
              id: `${release.environment}:${release.workloadClass}:${p.workerId}`,
            },
            { session: s },
          );
        if (
          !observation ||
          !isDeepStrictEqual(observation.release, release) ||
          !capacityFresh(
            CapacityObservationSchema.parse(withoutMongoId(observation)),
            clock(),
          )
        )
          throw new CapacityUnavailable();
        const j = InvocationJournalSchema.parse({
          id: `invocation:${randomUUID()}`,
          schemaVersion: 1,
          policy: "psu_execution_evidence_v1",
          binding: b,
          provider,
          correlationId: `correlation:${randomUUID()}`,
          preparedAt: clock(),
          revision: 1,
          state: "prepared",
          financialReconciliationPending: true,
        });
        await db
          .collection("agent_execution_invocations")
          .insertOne(j, { session: s });
        await setSlot(db, s, b, "occupied");
        await event(db, s, b, "occupied", { journalId: j.id });
        return {
          journalId: j.id,
          correlationId: j.correlationId,
          requestDigest: provider.requestDigest,
        };
      });
    },
    issueSend: async (p: AgentWorkloadPrincipal, input: unknown) => {
      const { binding: b, provider } = PrepareInvocationSchema.parse(input);
      authenticate(p, b);
      return transaction(async (db, s) => {
        const j = await journal(db, s, b);
        if (!isDeepStrictEqual(j.provider, provider))
          throw new AuthorizationDenied();
        if (j.state !== "prepared") return { permitted: false as const };
        await owned(db, s, p, b, "send");
        if (!(await open(db, s)) || (await status(db, s)) !== "busy")
          throw new CapacityUnavailable();
        const current = await slot(db, s);
        if (!current || !isDeepStrictEqual(current.binding, b))
          throw new CapacityUnavailable();
        const permissionId = `permission:${randomUUID()}`;
        await save(db, s, j, {
          state: "possibly_sent",
          permissionId,
          permissionAt: clock(),
        });
        await event(db, s, b, "send_permission", { journalId: j.id });
        return { permitted: true as const, permissionId };
      });
    },
    quarantine: async (p: AgentWorkloadPrincipal, input: unknown) => {
      const b = SlotBindingSchema.parse(input);
      authenticate(p, b, true);
      return transaction(async (db, s) => {
        const j = await journal(db, s, b);
        await original(db, s, b);
        if (clock().getTime() - j.preparedAt.getTime() >= 86400000)
          throw new AuthorizationDenied();
        if (
          j.state === "possibly_sent" &&
          (await setSlot(db, s, b, "quarantined"))
        )
          await event(db, s, b, "quarantined", { journalId: j.id });
        return { accepted: true };
      });
    },
    evidence: async (p: AgentWorkloadPrincipal, input: unknown) => {
      const receipt = validateReceipt(input),
        b = receipt.binding;
      authenticate(p, b, true);
      return transaction(async (db, s) => {
        const j = await journal(db, s, b);
        await original(db, s, b);
        if (
          clock().getTime() < j.preparedAt.getTime() ||
          clock().getTime() - j.preparedAt.getTime() >= 86400000 ||
          receipt.journalId !== j.id ||
          receipt.correlationId !== j.correlationId ||
          receipt.requestDigest !== j.provider.requestDigest ||
          !qualification.terminalContracts?.includes(receipt.terminalContract)
        )
          throw new AuthorizationDenied();
        const contentDigest = digest(receipt);
        if (j.receiptDigest) {
          if (j.receiptDigest === contentDigest)
            return { accepted: true, receiptDigest: contentDigest };
          if (!j.conflictDigest) {
            await save(db, s, j, { conflictDigest: contentDigest });
            await db
              .collection("agent_execution_controls")
              .updateOne(
                { id: controlId },
                { $set: { state: "integrity_hold", conflictJournalId: j.id } },
                { session: s },
              );
            await event(db, s, b, "evidence_conflict", { journalId: j.id });
          }
          return { accepted: false, conflict: true };
        }
        if (j.state !== "possibly_sent") throw new AuthorizationDenied();
        await save(db, s, j, {
          state: "terminal",
          receipt,
          receiptDigest: contentDigest,
          receivedAt: clock(),
        });
        await setSlot(db, s, b, "released");
        await event(db, s, b, "released", {
          journalId: j.id,
          receiptDigest: contentDigest,
        });
        return { accepted: true, receiptDigest: contentDigest };
      });
    },
    /** Internal only; no HTTP reset. Prepared CAS proves no permission was issued. */
    reconcile: async (input: unknown) => {
      const b = SlotBindingSchema.parse(input);
      return transaction(async (db, s) => {
        const j = await journal(db, s, b);
        if (j.state === "prepared") {
          const row = await db
            .collection("agent_attempts")
            .findOne({ id: b.attemptId }, { session: s });
          const run = await db
            .collection("agent_runs")
            .findOne({ id: b.runId }, { session: s });
          if (
            row?.status === "running" &&
            row.leaseUntil > clock() &&
            run?.status === "running" &&
            !run.cancellationRequestedAt
          )
            return { released: false };
          await save(db, s, j, { state: "no_send" });
          await setSlot(db, s, b, "released");
          await event(db, s, b, "no_send", { journalId: j.id });
          return { released: true };
        }
        if (
          j.state === "terminal" &&
          j.receipt &&
          j.receiptDigest === digest(j.receipt) &&
          qualification.terminalContracts?.includes(j.receipt.terminalContract)
        ) {
          await setSlot(db, s, b, "released");
          return { released: true };
        }
        return { released: false };
      });
    },
  };
  return service;
}
