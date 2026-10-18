import { digest, type ClaimedWork } from "@workspace/agent-runtime-protocol";

/** Exact explicit field paths only; a parent name is not an implicit wildcard.
 * Called after shared protocol validation has rejected prototype/path attacks. */
export function projectAgentPayload(
  payload: unknown,
  fields: readonly string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of fields) {
    const parts = field.split(".");
    let source: unknown = payload;
    for (const part of parts) {
      if (
        !source ||
        typeof source !== "object" ||
        Array.isArray(source) ||
        !Object.hasOwn(source, part)
      ) {
        source = undefined;
        break;
      }
      source = (source as Record<string, unknown>)[part];
    }
    if (source === undefined) continue;
    let target = out;
    for (const part of parts.slice(0, -1)) {
      if (
        !target[part] ||
        typeof target[part] !== "object" ||
        Array.isArray(target[part])
      )
        target[part] = {};
      target = target[part] as Record<string, unknown>;
    }
    target[parts.at(-1)!] = structuredClone(source);
  }
  return out;
}
export function requireProjectedSnapshots(context: ClaimedWork["context"]) {
  for (const snapshot of context.snapshots)
    if (
      digest(projectAgentPayload(snapshot.payload, snapshot.fields)) !==
      snapshot.payloadDigest
    )
      throw new Error("Context payload exceeds exact projection");
}
