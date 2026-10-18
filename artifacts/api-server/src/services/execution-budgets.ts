import { isDeepStrictEqual } from "node:util";
import { generatePlatformId } from "../domain/ids";
import { decimalAmount, decimalUnits } from "../domain/agent-budget";
import {
  BudgetOperationSchema,
  ExecutionBudgetPolicySchema,
  ExecutionBudgetWindowSchema,
  ExecutionBudgetReservationSchema,
  validateBudgetAmount,
  type BudgetOperation,
  type BudgetPolicy,
  type BudgetWindow,
  type BudgetReservation,
} from "../domain/execution-budgets";

/** Trusted storage boundary. transaction MUST serialize all window and authority
 * reads/writes, retry conflicts from fresh state, and atomically append events.
 * No production adapter or human administration is registered by this module. */
export interface BudgetTransaction {
  policies: BudgetPolicy[];
  windows: BudgetWindow[];
  reservations: BudgetReservation[];
  receiptSeen(receiptId: string): boolean;
  appendEvent(event: {
    kind: string;
    reservationId: string;
    receiptId?: string;
    amounts?: string[];
    supersedes?: string;
  }): void;
}
export interface BudgetStore {
  transaction<T>(work: (tx: BudgetTransaction) => Promise<T>): Promise<T>;
}
export interface BudgetAuthority {
  /** Must recheck/serialize current grants, integration, revision, Attempt/fence and
   * complete policy set. Missing policy or verified provider account fails closed. */
  authorize(
    tx: BudgetTransaction,
    operation: BudgetOperation,
  ): Promise<
    | {
        allocations: { windowId: string; amount: string }[];
        verifiedAccountDigest?: string;
        sharedAccount?: boolean;
      }
    | undefined
  >;
  /** Only trusted provider evidence/reconciliation, never a worker/user assertion.
   * It may accept a late receipt without granting a stale Attempt new authority. */
  receipt(
    tx: BudgetTransaction,
    reservation: BudgetReservation,
    receipt: unknown,
  ): Promise<
    | {
        id: string;
        amounts: string[];
        supersedes?: string;
      }
    | undefined
  >;
}
function identity(o: BudgetOperation) {
  const { attemptId, fence, ...identity } = o;
  void attemptId;
  void fence;
  return identity;
}
function policyFor(tx: BudgetTransaction, w: BudgetWindow) {
  const matches = tx.policies.filter(
    (p) =>
      p.id === w.policyId &&
      p.version === w.policyVersion &&
      p.workspaceId === w.workspaceId,
  );
  if (matches.length !== 1) throw new Error("Budget policy unavailable");
  return ExecutionBudgetPolicySchema.parse(matches[0]);
}
export function createExecutionBudgets(
  store: BudgetStore,
  authority: BudgetAuthority,
  clock: () => Date,
) {
  async function checked(tx: BudgetTransaction, op: BudgetOperation) {
    if (op.expiresAt <= clock()) throw new Error("Operation expired");
    const permitted = await authority.authorize(tx, op);
    if (
      !permitted ||
      !permitted.allocations.length ||
      permitted.allocations.length > 20
    )
      throw new Error("Budget authority unavailable");
    if (
      new Set(permitted.allocations.map((a) => a.windowId)).size !==
      permitted.allocations.length
    )
      throw new Error("Duplicate budget window");
    const applicable = tx.policies.filter(
      (p) =>
        p.workspaceId === op.workspaceId &&
        p.effectiveFrom <= clock() &&
        p.effectiveUntil > clock() &&
        p.operations.includes(op.operation) &&
        (p.scope.kind === "configuration"
          ? p.scope.configurationId === op.configurationId &&
            p.scope.binding === op.binding
          : p.scope.verifiedAccountDigest === permitted.verifiedAccountDigest),
    );
    if (
      permitted.sharedAccount &&
      (!permitted.verifiedAccountDigest ||
        !applicable.some((p) => p.scope.kind === "account"))
    )
      throw new Error("Shared account quota required");
    for (const p of applicable)
      if (
        !permitted.allocations.some((a) =>
          tx.windows.some(
            (w) =>
              w.id === a.windowId &&
              w.policyId === p.id &&
              w.policyVersion === p.version &&
              w.workspaceId === op.workspaceId,
          ),
        )
      )
        throw new Error("Incomplete budget policy set");
    let configuration = false;
    for (const a of permitted.allocations) {
      const matches = tx.windows.filter(
        (w) => w.id === a.windowId && w.workspaceId === op.workspaceId,
      );
      if (matches.length !== 1) throw new Error("Budget window unavailable");
      const w = ExecutionBudgetWindowSchema.parse(matches[0]);
      const p = policyFor(tx, w);
      if (
        w.start > clock() ||
        w.end <= clock() ||
        p.effectiveFrom > w.start ||
        p.effectiveUntil < w.end ||
        w.blocked ||
        !p.operations.includes(op.operation)
      )
        throw new Error("Budget window not usable");
      if (p.scope.kind === "configuration") {
        if (
          p.scope.configurationId !== op.configurationId ||
          p.scope.binding !== op.binding
        )
          throw new Error("Configuration budget mismatch");
        configuration = true;
      } else if (
        !permitted.verifiedAccountDigest ||
        p.scope.verifiedAccountDigest !== permitted.verifiedAccountDigest
      )
        throw new Error("Account budget mismatch");
      const siblings = tx.windows.filter(
        (x) =>
          x.workspaceId === w.workspaceId &&
          x.policyId === w.policyId &&
          x.id !== w.id,
      );
      if (
        siblings.some(
          (x) =>
            (x.start < w.end && w.start < x.end) ||
            (x.end <= w.start && (decimalUnits(x.reserved) > 0n || x.blocked)),
        )
      )
        throw new Error("Overlapping or unresolved budget window");
      validateBudgetAmount(p, a.amount);
      validateBudgetAmount(p, w.reserved);
      validateBudgetAmount(p, w.consumed);
    }
    if (!configuration) throw new Error("Configuration quota required");
    return permitted.allocations
      .slice()
      .sort((a, b) => a.windowId.localeCompare(b.windowId));
  }
  return {
    async reserve(value: unknown) {
      const op = BudgetOperationSchema.parse(value);
      return store.transaction(async (tx) => {
        const allocations = await checked(tx, op);
        const old = tx.reservations.find(
          (r) =>
            r.workspaceId === op.workspaceId && r.logicalOperation.id === op.id,
        );
        if (old) {
          if (
            !isDeepStrictEqual(identity(old.logicalOperation), identity(op)) ||
            !isDeepStrictEqual(old.allocations, allocations)
          )
            throw new Error("Logical operation conflict");
          if (old.state === "unknown")
            throw new Error("Unknown completion requires reconciliation");
          // Reservation reuse is accounting only, never permission to replay a side effect.
          return structuredClone(old);
        }
        for (const a of allocations) {
          const w = tx.windows.find((w) => w.id === a.windowId)!;
          const p = policyFor(tx, w);
          if (
            decimalUnits(w.consumed) +
              decimalUnits(w.reserved) +
              decimalUnits(a.amount) >
            decimalUnits(p.limit)
          )
            throw new Error("Quota exhausted");
        }
        const reservation = ExecutionBudgetReservationSchema.parse({
          id: generatePlatformId("budgetreservation"),
          workspaceId: op.workspaceId,
          logicalOperation: op,
          allocations,
          state: "reserved",
          executionSerial: 0,
        });
        for (const a of allocations) {
          const w = tx.windows.find((w) => w.id === a.windowId)!;
          if (w.executionSerial === Number.MAX_SAFE_INTEGER)
            throw new Error("Budget serial exhausted");
          w.reserved = decimalAmount(
            decimalUnits(w.reserved) + decimalUnits(a.amount),
          );
          w.executionSerial++;
        }
        tx.reservations.push(reservation);
        tx.appendEvent({
          kind: "budget_reserved",
          reservationId: reservation.id,
        });
        return structuredClone(reservation);
      });
    },
    async markUnknown(value: unknown) {
      const op = BudgetOperationSchema.parse(value);
      return store.transaction(async (tx) => {
        await checked(tx, op);
        const r = tx.reservations.find(
          (r) =>
            r.workspaceId === op.workspaceId && r.logicalOperation.id === op.id,
        );
        if (
          !r ||
          !isDeepStrictEqual(r.logicalOperation, op) ||
          r.state === "settled"
        )
          throw new Error("Reservation ownership mismatch");
        if (r.state !== "unknown") {
          if (r.executionSerial === Number.MAX_SAFE_INTEGER)
            throw new Error("Budget serial exhausted");
          r.executionSerial++;
          r.state = "unknown";
          tx.appendEvent({ kind: "budget_unknown", reservationId: r.id });
        }
      });
    },
    async reconcile(workspaceId: string, reservationId: string, raw: unknown) {
      return store.transaction(async (tx) => {
        const r = tx.reservations.find(
          (r) => r.id === reservationId && r.workspaceId === workspaceId,
        );
        if (!r) throw new Error("Reservation unavailable");
        const receipt = await authority.receipt(tx, structuredClone(r), raw);
        if (
          !receipt ||
          receipt.amounts.length !== r.allocations.length ||
          !/^[a-f0-9]{64}$/.test(receipt.id)
        )
          throw new Error("Receipt unavailable");
        if (r.settlement?.receiptId === receipt.id) {
          if (!isDeepStrictEqual(r.settlement.amounts, receipt.amounts))
            throw new Error("Receipt replay mismatch");
          return;
        }
        if (tx.receiptSeen(receipt.id))
          throw new Error("Receipt already consumed");
        if (r.executionSerial === Number.MAX_SAFE_INTEGER)
          throw new Error("Budget serial exhausted");
        if (
          r.settlement
            ? receipt.supersedes !== r.settlement.receiptId
            : receipt.supersedes !== undefined
        )
          throw new Error("Receipt correction mismatch");
        for (let i = 0; i < r.allocations.length; i++) {
          const a = r.allocations[i]!;
          const w = tx.windows.find(
            (w) => w.id === a.windowId && w.workspaceId === r.workspaceId,
          );
          if (!w) throw new Error("Settlement window unavailable");
          const actual = validateBudgetAmount(
            policyFor(tx, w),
            receipt.amounts[i]!,
          );
          const previous = r.settlement
            ? decimalUnits(r.settlement.amounts[i]!)
            : 0n;
          const reserved = r.settlement ? 0n : decimalUnits(a.amount);
          if (
            decimalUnits(w.reserved) < reserved ||
            decimalUnits(w.consumed) < previous ||
            w.executionSerial === Number.MAX_SAFE_INTEGER
          )
            throw new Error("Accounting invariant");
          w.reserved = decimalAmount(decimalUnits(w.reserved) - reserved);
          w.consumed = decimalAmount(
            decimalUnits(w.consumed) - previous + actual,
          );
          // Over-ceiling observations are retained honestly; administrative unblock is unavailable.
          w.blocked ||= actual > decimalUnits(a.amount);
          w.executionSerial++;
        }
        r.executionSerial++;
        r.state = "settled";
        r.settlement = { receiptId: receipt.id, amounts: receipt.amounts };
        tx.appendEvent({
          kind: "budget_settled",
          reservationId: r.id,
          receiptId: receipt.id,
          amounts: receipt.amounts,
          ...(receipt.supersedes ? { supersedes: receipt.supersedes } : {}),
        });
      });
    },
  };
}
