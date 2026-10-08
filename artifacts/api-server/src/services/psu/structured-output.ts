import { z } from "zod4";

import type { Json } from "@workspace/agent-runtime-protocol";
type Schema = Record<string, unknown>;
const supported = new Set([
  "type",
  "enum",
  "const",
  "properties",
  "required",
  "additionalProperties",
  "items",
  "anyOf",
  "oneOf",
  "minLength",
  "maxLength",
  "pattern",
  "format",
  "minimum",
  "maximum",
  "minItems",
  "maxItems",
  "multipleOf",
  "description",
  "$schema",
]);
function wire(s: Schema): Schema {
  if (Object.keys(s).some((k) => !supported.has(k)))
    throw new Error("configuration_error");
  const result: Schema = {};
  for (const [k, v] of Object.entries(s)) {
    if (
      ["$schema", "required", "properties", "additionalProperties"].includes(k)
    )
      continue;
    // URI is valid JSON Schema but is not an OpenAI Structured Outputs format.
    // Keep URL validation in the original Zod schema after generation.
    if (k === "format" && v === "uri") continue;
    if (k === "const") result.enum = [v];
    else if (k === "oneOf" || k === "anyOf")
      result.anyOf = (v as Schema[]).map(wire);
    else if (k === "items") result.items = wire(v as Schema);
    else result[k] = v;
  }
  if (s.type === "object") {
    if (!s.properties || s.additionalProperties !== false)
      throw new Error("configuration_error");
    const required = s.required as string[] | undefined;
    result.properties = Object.fromEntries(
      Object.entries(s.properties as Record<string, Schema>).map(([k, v]) => [
        k,
        required?.includes(k)
          ? wire(v)
          : { anyOf: [wire(v), { type: "null" }] },
      ]),
    );
    result.required = Object.keys(s.properties);
    result.additionalProperties = false;
  }
  return result;
}
function restore(value: unknown, original: Schema): unknown {
  const branches = original.anyOf ?? original.oneOf;
  if (branches) {
    const branch = (branches as Schema[]).find(
      (s) => z.fromJSONSchema(wire(s)).safeParse(value).success,
    );
    if (!branch) throw new Error("model_output_invalid");
    return restore(value, branch);
  }
  if (original.type === "object") {
    const required = original.required as string[] | undefined;
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).flatMap(([k, v]) =>
        v === null && !required?.includes(k)
          ? []
          : [
              [
                k,
                restore(v, (original.properties as Record<string, Schema>)[k]!),
              ],
            ],
      ),
    );
  }
  if (original.type === "array")
    return (value as unknown[]).map((v) =>
      restore(v, original.items as Schema),
    );
  return value;
}
/** Provider shape is stricter about field presence; original local refinements
 * and bounds remain authoritative after optional-null normalization. */
export function structuredOutput(schema: z.ZodType<Json>) {
  try {
    const original = z.toJSONSchema(schema, { target: "draft-7" }) as Schema;
    const converted = wire(original);
    if (converted.type !== "object" || converted.anyOf)
      throw new Error("configuration_error");
    const providerSchema = z.fromJSONSchema(converted);
    return {
      schema: converted,
      parse(value: unknown): Json {
        try {
          return schema.parse(restore(providerSchema.parse(value), original));
        } catch {
          throw new Error("model_output_invalid");
        }
      },
    };
  } catch {
    throw new Error("configuration_error");
  }
}
