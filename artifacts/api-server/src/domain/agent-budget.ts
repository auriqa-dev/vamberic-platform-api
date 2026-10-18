import {
  ExactDecimalSchema,
  type BudgetLimits,
  type UsageObservation,
} from "@workspace/agent-runtime-protocol";

const SCALE = 1_000_000_000_000n;
export function decimalUnits(value: string): bigint {
  const parsed = ExactDecimalSchema.parse(value);
  const [whole, fraction = ""] = parsed.split(".");
  return BigInt(whole!) * SCALE + BigInt(fraction.padEnd(12, "0"));
}
export function decimalAmount(value: bigint): string {
  if (value < 0n) throw new RangeError("Negative allowance");
  const fraction = (value % SCALE)
    .toString()
    .padStart(12, "0")
    .replace(/0+$/, "");
  return ExactDecimalSchema.parse(
    `${value / SCALE}${fraction ? `.${fraction}` : ""}`,
  );
}
/** Persist reservations before dispatch/claim. Unknown costs never release them.
 * Corrections are immutable new observations and must be scope-checked by the
 * acceptance service before this calculation. Currencies are never converted.
 */
export function remainingCost(
  limit: BudgetLimits["cost"],
  reservations: readonly {
    amount: string;
    observations: readonly UsageObservation[];
    settled: boolean;
  }[],
): string {
  let used = 0n;
  for (const reservation of reservations) {
    const superseded = new Set(
      reservation.observations.flatMap((o) =>
        o.supersedes ? [o.supersedes] : [],
      ),
    );
    const current = reservation.observations.filter(
      (o) => !superseded.has(o.id),
    );
    let known = 0n;
    for (const observation of current)
      if (observation.cost.status !== "unknown") {
        if (observation.cost.currency !== limit.currency)
          throw new Error("Usage currency mismatch");
        known += decimalUnits(observation.cost.amount);
      }
    const reserved = decimalUnits(reservation.amount);
    // A receipt is not proof that every delayed provider observation has arrived.
    const canRelease =
      reservation.settled &&
      current.length > 0 &&
      current.every((o) => o.cost.status === "provider_confirmed");
    used += canRelease ? known : known > reserved ? known : reserved;
  }
  const available = decimalUnits(limit.amount) - used;
  return decimalAmount(available > 0n ? available : 0n);
}
