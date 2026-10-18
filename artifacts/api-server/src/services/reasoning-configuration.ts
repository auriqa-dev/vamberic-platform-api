import {
  digest,
  JsonPayloadSchema,
  type Json,
} from "@workspace/agent-runtime-protocol";
import type { AgentTarget } from "../domain/agent-operator";
import { OperatingSchemas } from "../domain/operating";
import { withoutMongoId } from "./hvm-context";

export interface ConfigurationSelection {
  id: string;
  revision: number;
  contentHash: string;
}
/** Pure projection after transactional configuration-read authorization. The
 * caller must serialize this exact Client Agent dependency and recheck freshness
 * and read authority at each existing lifecycle boundary. It imports no bindings,
 * dependencies, permissions or quotas. Omission performs no Client Agent read. */
export function projectReasoningConfiguration(options: {
  target: Extract<AgentTarget, { kind: "workspace_agent" }>;
  defaults: Json;
  selection?: ConfigurationSelection;
  record?: unknown;
  authorized: boolean;
  /** Code-owned, operation-specific merge/schema; never client-supplied. */
  merge(defaults: Json, configuration: Json): Json;
}) {
  const { target, selection } = options;
  if (!selection)
    return {
      configuration: JsonPayloadSchema.parse(options.defaults),
      dependencies: [],
    };
  if (!options.authorized) throw new Error("Configuration read denied");
  const row = OperatingSchemas.client_agents.parse(
    withoutMongoId(options.record as Record<string, unknown>),
  );
  if (
    row.workspaceId !== target.workspaceId ||
    row.id !== selection.id ||
    row.revision !== selection.revision ||
    row.archived ||
    row.data.definition.id !== target.definition.id ||
    row.data.definition.version !== target.definition.version ||
    digest(JSON.parse(JSON.stringify(row))) !== selection.contentHash
  )
    throw new Error("Configuration overlay changed or mismatched");
  const configuration = JsonPayloadSchema.parse(
    options.merge(
      structuredClone(options.defaults),
      JsonPayloadSchema.parse(row.data.configuration),
    ),
  );
  return {
    configuration,
    dependencies: [
      {
        collection: "client_agents" as const,
        id: row.id,
        revision: row.revision,
        contentHash: selection.contentHash,
      },
    ],
  };
}
