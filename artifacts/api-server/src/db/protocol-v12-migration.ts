import { createHash } from "node:crypto";
import type { Document } from "mongodb";
export const PROTOCOL_V12_COLLECTIONS = [
  "agent_runs",
  "agent_results",
  "agent_definitions",
  "pricing_recommendations",
  "swarm_agreements",
] as const;
const predecessors: Record<string, string> = {
  agent_runs:
    "0cd2c7dc531002b063a795b645ace5cbbd775195ad763f32b0a29f2145197613",
  agent_results:
    "ab317a8dbb49d610016ac847ca8751a577f78efd91df601984caeef866ea46cb",
  agent_definitions:
    "df0526cae20bafb5261a97485f3f1371de796428b8142444af1049e21d0b0528",
  pricing_recommendations:
    "e97ef179f82f795de533e31336fdddc5a8bdfa709fb19ce1357f8bdd11627ff3",
  swarm_agreements:
    "13bc33028ff6c8d9e19c11704c68357d72bfc7551de9fa7a1baee29c7ef3851e",
};
function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value !== null && typeof value === "object")
    return (
      "{" +
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => JSON.stringify(k) + ":" + canonical(v))
        .join(",") +
      "}"
    );
  return JSON.stringify(value);
}
/** Exact schema-11 predecessor; no weakening, backfill, collection or index changes. */
export function isProtocolV11Predecessor(
  name: string,
  validator: Document,
): boolean {
  return (
    predecessors[name] ===
    createHash("sha256").update(canonical(validator)).digest("hex")
  );
}
/** Historic v9/v10 projections retain their declared protocol literal. */
export function historicalProtocolValidator(value: Document): Document {
  function visit(v: unknown): unknown {
    if (!v || typeof v !== "object") return v;
    if (Array.isArray(v)) return v.map(visit);
    const row = v as Document;
    // Zod literal byte-size projection was constant before the dual-version enum.
    const path = row.$let?.vars?.text?.$cond?.[1];
    if (
      typeof path === "string" &&
      path.endsWith(".executionImplementation.protocolVersion")
    )
      return 5;
    return Object.fromEntries(
      Object.entries(row).map(([key, child]) => [
        key,
        key === "enum" && JSON.stringify(child) === '["1.1","1.2"]'
          ? ["1.1"]
          : visit(child),
      ]),
    );
  }
  return visit(value) as Document;
}
