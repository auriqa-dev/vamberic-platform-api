import type { Document } from "mongodb";
import { BrandKitRecordSchema } from "../domain/brands";
import { offerMongoStructure } from "./offer-validators";
/** Additive only. Historic schemas and existing records remain unchanged. */
export function extendInteractionValidators(
  previous: Record<string, Document>,
) {
  const next = structuredClone(previous);
  let count = 0;
  function visit(node: unknown) {
    if (!node || typeof node !== "object") return;
    const obj = node as Document;
    if (
      obj.properties?.emailDefaults &&
      obj.properties?.brandId &&
      obj.properties?.colours
    ) {
      if (obj.properties.chatPersonality)
        throw new Error("Unexpected existing chat personality schema");
      obj.properties.chatPersonality = offerMongoStructure(
        BrandKitRecordSchema.shape.chatPersonality.unwrap(),
      );
      count++;
    }
    for (const v of Object.values(obj)) visit(v);
  }
  visit(next.brand_kits);
  if (count !== 1) throw new Error("Unexpected Brand Kit predecessor");
  return next;
}
