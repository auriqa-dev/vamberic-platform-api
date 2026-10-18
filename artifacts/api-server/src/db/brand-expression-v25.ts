import { BrandExpressionSchema } from "../domain/brand-expression";
import { offerMongoStructure } from "./offer-validators";
export const BRAND_EXPRESSION_MIGRATION_ID = "025-brand-expression";
export const BRAND_EXPRESSION_STRUCTURE = offerMongoStructure(
  BrandExpressionSchema,
);
