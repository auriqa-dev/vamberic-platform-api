import type { Document } from "mongodb";

/** Offer-only adapter: Mongo's code-owned shape -> Responses strict JSON Schema.
 * Semantic/refinement checks stay in the existing local validators.
 */
export function offerResponseSchema(shape: Document): Document {
  if (shape.anyOf) return { anyOf: shape.anyOf.map(offerResponseSchema) };
  if (shape.enum)
    return {
      type: shape.enum[0] === null ? "null" : typeof shape.enum[0],
      enum: shape.enum,
    };
  if (shape.bsonType === "null") return { type: "null" };
  if (shape.bsonType === "object") {
    const required = new Set(shape.required ?? []);
    const properties = Object.fromEntries(
      Object.entries(shape.properties as Record<string, Document>).map(
        ([key, child]) => {
          const schema = offerResponseSchema(child);
          return [
            key,
            required.has(key) ? schema : { anyOf: [schema, { type: "null" }] },
          ];
        },
      ),
    );
    return {
      type: "object",
      properties,
      required: Object.keys(properties),
      additionalProperties: false,
    };
  }
  if (shape.bsonType === "array")
    return {
      type: "array",
      items: offerResponseSchema(shape.items),
      ...(shape.minItems !== undefined ? { minItems: shape.minItems } : {}),
      ...(shape.maxItems !== undefined ? { maxItems: shape.maxItems } : {}),
    };
  if (shape.bsonType === "string") return { type: "string" };
  if (shape.bsonType === "bool") return { type: "boolean" };
  if (
    Array.isArray(shape.bsonType) &&
    shape.bsonType.every((t: string) => ["int", "long", "double"].includes(t))
  )
    return { type: shape.multipleOf === 1 ? "integer" : "number" };
  throw new Error("Unsupported offer response schema");
}

/** Null represents an omitted optional field on the wire, never a made-up value.
 * Preserve required nulls and unknown keys so local validation still rejects them.
 */
export function omitOfferNulls(value: unknown, shape: Document): unknown {
  if (Array.isArray(value) && shape.bsonType === "array")
    return value.map((v) => omitOfferNulls(v, shape.items));
  if (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    shape.bsonType === "object"
  ) {
    const required = new Set(shape.required ?? []);
    return Object.fromEntries(
      Object.entries(value).flatMap(([key, child]) => {
        const field = shape.properties[key];
        if (field && child === null && !required.has(key)) return [];
        return [[key, field ? omitOfferNulls(child, field) : child]];
      }),
    );
  }
  return value;
}
