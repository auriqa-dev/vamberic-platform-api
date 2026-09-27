import { z } from "zod";
import {
  basePersistenceSchema,
  platformIdSchema,
  type Product,
  type Organisation,
  ProductSchema,
  OrganisationSchema,
} from "./schemas";
import { CrmWorkspaceSchema, type CrmWorkspace } from "./crm-records";
import { partnerHumanSchema } from "./partners";
const text = (max = 1000) => z.string().trim().min(1).max(max);
const list = (max = 40) => z.array(text()).max(max);
const humanBase = basePersistenceSchema.extend({
  workspaceId: platformIdSchema("workspace"),
  createdBy: partnerHumanSchema.optional(),
  updatedBy: partnerHumanSchema.optional(),
});
export const BrandRecordSchema = humanBase
  .extend({
    id: platformIdSchema("brand"),
    organisationId: platformIdSchema("org"),
    name: text(200),
    slug: z.string().regex(/^[a-z0-9][a-z0-9-]{0,99}$/),
    status: z.enum(["active", "retired"]),
    primaryDomain: z
      .string()
      .max(253)
      .regex(
        /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,63}$/,
      )
      .optional(),
    description: text(5000).optional(),
  })
  .strict();
function timestamps(
  v: { createdAt: Date; updatedAt: Date; archivedAt?: Date; archived: boolean },
  ctx: z.RefinementCtx,
) {
  if (
    v.updatedAt < v.createdAt ||
    (v.archivedAt &&
      (!v.archived || v.archivedAt < v.createdAt || v.archivedAt > v.updatedAt))
  )
    ctx.addIssue({
      code: "custom",
      message: "Inconsistent brand lifecycle timestamps",
    });
}
export const BrandSchema = BrandRecordSchema.superRefine(timestamps);
export const BRAND_ASSET_TYPES = [
  "logo",
  "photography",
  "product_imagery",
  "icon_set",
  "illustration",
  "graphic",
  "background",
  "email_header",
  "email_footer",
] as const;
export const BRAND_ASSET_VARIANTS = [
  "primary",
  "compact",
  "light",
  "dark",
  "monochrome",
  "favicon",
  "other",
] as const;
/** Object identity, never a signed URL, upload payload or binary data. */
export const BrandAssetSchema = z
  .object({
    type: z.enum(BRAND_ASSET_TYPES),
    variant: z.enum(BRAND_ASSET_VARIANTS).optional(),
    name: text(200),
    altText: text(1000).optional(),
    status: z.enum(["approved", "retired"]),
    object: z
      .object({
        store: z.literal("s3"),
        bucket: z
          .string()
          .min(3)
          .max(63)
          .regex(/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/),
        key: z
          .string()
          .min(1)
          .max(1024)
          .regex(/^[A-Za-z0-9][A-Za-z0-9/_.-]*$/)
          .refine((v) => !v.split("/").includes(".."), "Unsafe object key"),
        versionId: z
          .string()
          .min(1)
          .max(1024)
          .regex(/^[A-Za-z0-9_.+/-]+$/)
          .optional(),
      })
      .strict(),
  })
  .strict();
const colour = z
  .object({
    role: z.enum(["primary", "secondary", "accent", "surface", "text"]),
    name: text(100),
    hex: z.string().regex(/^#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?$/),
    usage: text().optional(),
  })
  .strict();
const typography = z
  .object({
    role: z.enum(["primary", "secondary", "heading", "body"]),
    family: text(200),
    weights: z.array(z.number().int().min(1).max(1000)).max(20).optional(),
    styles: z
      .array(z.enum(["normal", "italic", "oblique"]))
      .max(3)
      .optional(),
    usage: text().optional(),
  })
  .strict();
export const BrandKitRecordSchema = humanBase
  .extend({
    id: platformIdSchema("brandkit"),
    brandId: platformIdSchema("brand"),
    status: z.enum(["draft", "approved", "retired"]),
    approvedAt: z.date().optional(),
    approvedBy: partnerHumanSchema.optional(),
    assets: z.array(BrandAssetSchema).max(100).default([]),
    colours: z.array(colour).max(100).default([]),
    typography: z.array(typography).max(20).default([]),
    visualRules: z
      .object({
        layout: text().optional(),
        spacing: text().optional(),
        borders: text().optional(),
        imageTreatment: text().optional(),
        icons: text().optional(),
        illustrations: text().optional(),
        do: list().optional(),
        dont: list().optional(),
      })
      .strict()
      .optional(),
    voice: z
      .object({
        descriptors: list().optional(),
        principles: list().optional(),
        writingStyle: text(5000).optional(),
        avoidLanguage: list().optional(),
        preferredTerminology: list().optional(),
        audiences: z
          .array(
            z.object({ audience: text(200), guidance: text(2000) }).strict(),
          )
          .max(30)
          .optional(),
      })
      .strict()
      .optional(),
    terminology: z
      .object({
        productNames: list().optional(),
        capabilityNames: list().optional(),
        use: list().optional(),
        avoid: list().optional(),
        acronyms: z
          .array(z.object({ short: text(100), meaning: text(500) }).strict())
          .max(100)
          .optional(),
        namingConventions: list().optional(),
      })
      .strict()
      .optional(),
    descriptions: z
      .object({
        short: text(1000).optional(),
        long: text(10000).optional(),
        tagline: text(300).optional(),
        about: text(10000).optional(),
        legalCompany: text(5000).optional(),
        footer: text(5000).optional(),
        products: z
          .array(
            z
              .object({
                productId: platformIdSchema("product"),
                description: text(5000),
              })
              .strict(),
          )
          .max(100)
          .optional(),
      })
      .strict()
      .optional(),
    imageryGuidance: z
      .object({
        photography: text().optional(),
        productImagery: text().optional(),
        icons: text().optional(),
        illustrations: text().optional(),
        motifs: text().optional(),
        backgrounds: text().optional(),
      })
      .strict()
      .optional(),
    emailDefaults: z
      .object({
        fromDisplayName: text(200).optional(),
        replyToLabel: text(200).optional(),
        replyToContactPointId: platformIdSchema("contact").optional(),
        footer: text(5000).optional(),
        signature: text(5000).optional(),
        legalFooter: text(5000).optional(),
        unsubscribeStyling: text().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export const BrandKitSchema = BrandKitRecordSchema.superRefine((v, ctx) => {
  timestamps(v, ctx);
  if (
    (v.status === "approved" &&
      (!v.approvedAt || !v.approvedBy || v.archived)) ||
    Boolean(v.approvedAt) !== Boolean(v.approvedBy) ||
    (v.approvedAt && (v.approvedAt < v.createdAt || v.approvedAt > v.updatedAt))
  )
    ctx.addIssue({
      code: "custom",
      message: "Inconsistent Brand Kit approval",
    });
  if (JSON.stringify(v).length > 200_000)
    ctx.addIssue({ code: "custom", message: "Brand Kit exceeds 200KB" });
});
export type Brand = z.infer<typeof BrandSchema>;
export type BrandKit = z.infer<typeof BrandKitSchema>;
/** Presence only, not approval or a quality score. */
export function brandKitReadiness(kit: BrandKit) {
  return {
    logo: kit.assets.some((a) => a.type === "logo" && a.status === "approved"),
    colours: kit.colours.length > 0,
    typography: kit.typography.length > 0,
    voice: Boolean(kit.voice && Object.values(kit.voice).some((v) => v.length)),
    descriptions: Boolean(
      kit.descriptions?.short ||
      kit.descriptions?.long ||
      kit.descriptions?.about,
    ),
    emailDefaults: Boolean(
      kit.emailDefaults && Object.keys(kit.emailDefaults).length,
    ),
  };
}
/** Proposed-state reference validation; future writers must authorize and recheck transactionally. */
export function validateBrandRelationships(model: {
  brands: readonly Brand[];
  kits: readonly BrandKit[];
  products: readonly Product[];
  organisations: readonly Organisation[];
  workspaces: readonly CrmWorkspace[];
  contactPoints?: readonly { id: string; workspaceId?: string }[];
}) {
  const brands = model.brands.map((b) => BrandSchema.parse(b));
  const kits = model.kits.map((k) => BrandKitSchema.parse(k));
  const products = model.products.map((p) => ProductSchema.parse(p));
  const organisations = model.organisations.map((o) =>
    OrganisationSchema.parse(o),
  );
  const workspaces = model.workspaces.map((w) => CrmWorkspaceSchema.parse(w));
  for (const rows of [brands, kits, products, organisations, workspaces])
    if (new Set(rows.map((r) => r.id)).size !== rows.length)
      throw new Error("Duplicate brand graph identity");
  for (const brand of brands) {
    const workspace = workspaces.find((w) => w.id === brand.workspaceId);
    const org = organisations.find((o) => o.id === brand.organisationId);
    if (
      !workspace ||
      !org ||
      (org.workspaceId !== undefined && org.workspaceId !== brand.workspaceId)
    )
      throw new Error("Invalid Brand workspace/Organisation reference");
  }
  for (const product of products)
    if (product.brandId) {
      const brand = brands.find((b) => b.id === product.brandId);
      if (!brand || product.workspaceId !== brand.workspaceId)
        throw new Error("Product Brand must share exact workspace");
    }
  const kitBrands = new Set<string>();
  for (const kit of kits) {
    const brand = brands.find((b) => b.id === kit.brandId);
    if (!brand || brand.workspaceId !== kit.workspaceId)
      throw new Error("Brand Kit must share Brand workspace");
    if (kit.status === "approved") {
      if (kitBrands.has(kit.brandId))
        throw new Error("One current approved Brand Kit per Brand");
      kitBrands.add(kit.brandId);
    }
    for (const copy of kit.descriptions?.products ?? [])
      if (
        !products.some(
          (p) =>
            p.id === copy.productId &&
            p.brandId === brand.id &&
            p.workspaceId === brand.workspaceId,
        )
      )
        throw new Error("Description must reference a Product of this Brand");
    if (
      kit.emailDefaults?.replyToContactPointId &&
      !(model.contactPoints ?? []).some(
        (c) =>
          c.id === kit.emailDefaults?.replyToContactPointId &&
          c.workspaceId === kit.workspaceId,
      )
    )
      throw new Error("Reply-to contact must share exact workspace");
  }
}
