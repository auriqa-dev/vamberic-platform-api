import type { Document } from "mongodb";
import Outcome from "@workspace/agent-runtime-protocol/json-schema/Outcome" with { type: "json" };
import ClaimedWork from "@workspace/agent-runtime-protocol/json-schema/ClaimedWork" with { type: "json" };
import Manifest from "@workspace/agent-runtime-protocol/json-schema/ImplementationManifest" with { type: "json" };
import Checkpoint from "@workspace/agent-runtime-protocol/json-schema/Checkpoint" with { type: "json" };
import InputRequest from "@workspace/agent-runtime-protocol/json-schema/InputRequest" with { type: "json" };
import InputResponse from "@workspace/agent-runtime-protocol/json-schema/InputResponse" with { type: "json" };
import Usage from "@workspace/agent-runtime-protocol/json-schema/UsageObservation" with { type: "json" };
import { utf16Length } from "./agent-json-integrity";
export const protocolArtifacts: Record<string, Document> = {
  Outcome,
  ClaimedWork,
  Manifest,
  Checkpoint,
  InputRequest,
  InputResponse,
  Usage,
};

/** Structural projection of the actual generated Runtime artifacts. All unknown
 * schema keywords fail closed. Dynamic JSON is covered separately by bounded
 * expression traversal; Mongo has no recursive $ref support. */
export function protocolMongoStructure(schema: Document): Document {
  if (schema.$ref) {
    if (schema.$ref !== "#/$defs/__schema0")
      throw new Error("Unsupported Runtime schema reference");
    return {
      bsonType: [
        "object",
        "array",
        "string",
        "int",
        "long",
        "double",
        "bool",
        "null",
      ],
    };
  }
  const out: Document = {};
  for (const [key, value] of Object.entries(schema)) {
    if (
      [
        "$schema",
        "$defs",
        "x-protocol-version",
        "x-runtime-validation",
        "format",
        "minLength",
        "maxLength",
        "propertyNames",
      ].includes(key)
    )
      continue;
    if (key === "type") {
      const types: Record<string, unknown> = {
        string: "string",
        object: "object",
        array: "array",
        boolean: "bool",
        null: "null",
        integer: ["int", "long", "double"],
        number: ["int", "long", "double"],
      };
      if (!(value in types)) throw new Error("Unsupported Runtime type");
      out.bsonType = types[value];
      if (value === "integer") out.multipleOf = 1;
    } else if (key === "const") out.enum = [value];
    else if (key === "properties")
      out.properties = Object.fromEntries(
        Object.entries(value as Document).map(([name, child]) => [
          name,
          protocolMongoStructure(child),
        ]),
      );
    else if (["anyOf", "oneOf", "allOf"].includes(key))
      out[key] = value.map(protocolMongoStructure);
    else if (key === "items") out.items = protocolMongoStructure(value);
    else if (key === "additionalProperties")
      out.additionalProperties =
        typeof value === "boolean" ? value : protocolMongoStructure(value);
    else if (
      [
        "required",
        "enum",
        "pattern",
        "minimum",
        "maximum",
        "minItems",
        "maxItems",
        "uniqueItems",
      ].includes(key)
    )
      out[key] = value;
    else throw new Error(`Unsupported Runtime schema keyword: ${key}`);
  }
  // Necessary URL integrity; exact WHATWG normalization remains service-only.
  if (schema.format === "uri")
    out.pattern ??= String.raw`^https?://[^/@?#\s]+(?:[/?#]|$)`;
  return out;
}
/** Runtime Zod 4.6.5 uses code points. Platform Zod 3 bounds opt into UTF-16.
 * Runtime canonicalJson retains its separate UTF-16 safety cap. */
export function protocolTextBounds(
  schema: Document,
  path: string,
  platformUtf16 = false,
): Document {
  let serial = 0;
  function walk(node: Document, at: string): Document | boolean {
    const checks: unknown[] = [];
    if (
      node.type === "string" &&
      (node.minLength !== undefined || node.maxLength !== undefined)
    )
      checks.push({
        $cond: [
          { $eq: [{ $type: at }, "string"] },
          {
            $and: [
              ...(node.minLength === undefined
                ? []
                : [
                    {
                      $gte: [
                        platformUtf16 ? utf16Length(at) : { $strLenCP: at },
                        node.minLength,
                      ],
                    },
                  ]),
              ...(node.maxLength === undefined
                ? []
                : [
                    {
                      $lte: [
                        platformUtf16 ? utf16Length(at) : { $strLenCP: at },
                        node.maxLength,
                      ],
                    },
                  ]),
            ],
          },
          true,
        ],
      });
    if (node.properties)
      for (const [key, child] of Object.entries(node.properties))
        checks.push(walk(child as Document, `${at}.${key}`));
    if (node.items) {
      const variable = `textElement${serial++}`;
      checks.push({
        $allElementsTrue: [
          {
            $map: {
              input: { $cond: [{ $isArray: at }, at, []] },
              as: variable,
              in: walk(node.items, `$$${variable}`),
            },
          },
        ],
      });
    }
    for (const union of [node.anyOf, node.oneOf, node.allOf])
      if (union)
        for (const branch of union) {
          const discriminator = Object.entries(branch.properties ?? {}).find(
            ([, v]) => Object.hasOwn(v as object, "const"),
          );
          const body = walk(branch, at);
          checks.push(
            discriminator
              ? {
                  $cond: [
                    {
                      $eq: [
                        `${at}.${discriminator[0]}`,
                        { $literal: (discriminator[1] as Document).const },
                      ],
                    },
                    body,
                    true,
                  ],
                }
              : body,
          );
        }
    return checks.length ? { $and: checks } : true;
  }
  return { $and: [walk(schema, path)] };
}
