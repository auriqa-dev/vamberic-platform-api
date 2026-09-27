import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BrandSchema,
  BrandKitSchema,
  BrandAssetSchema,
  brandKitReadiness,
  validateBrandRelationships,
  OrganisationSchema,
  ProductSchema,
  CrmWorkspaceSchema,
  generatePlatformId,
} from "../src/domain";
import { readCurrentBrandKit } from "../src/services/brand-kits";
import { createAuthorizationAuthority } from "../src/authorization/policy";
import { EnquiryMemoryDb } from "./helpers/enquiry-db";
import { BRAND_MONGO_VALIDATORS } from "../src/db/brand-validators";
const now = new Date("2026-09-27T12:00:00Z");
const dates = { createdAt: now, updatedAt: now };
const human = {
  type: "human",
  issuer: "https://identity.example.test",
  id: "operator",
} as const;
function fixture() {
  const organisation = OrganisationSchema.parse({
    ...dates,
    id: generatePlatformId("org"),
    name: "Operating company",
    type: "customer",
  });
  const workspace = CrmWorkspaceSchema.parse({
    ...dates,
    id: generatePlatformId("workspace"),
    name: "Client",
    kind: "client",
    clientOrganisationId: organisation.id,
  });
  const brand = BrandSchema.parse({
    ...dates,
    id: generatePlatformId("brand"),
    workspaceId: workspace.id,
    organisationId: organisation.id,
    name: "Brand",
    slug: "brand",
    status: "active",
    updatedBy: human,
  });
  const products = ["One", "Two"].map((name) =>
    ProductSchema.parse({
      ...dates,
      id: generatePlatformId("product"),
      workspaceId: workspace.id,
      brandId: brand.id,
      name,
      slug: name.toLowerCase(),
      productType: "software",
      lifecycleStatus: "idea",
    }),
  );
  const asset = BrandAssetSchema.parse({
    type: "logo",
    variant: "primary",
    name: "Primary mark",
    status: "approved",
    object: {
      store: "s3",
      bucket: "example-brand-assets",
      key: `workspaces/${workspace.id}/brands/${brand.id}/logo.png`,
      versionId: "example-version",
    },
  });
  const kit = BrandKitSchema.parse({
    ...dates,
    id: generatePlatformId("brandkit"),
    workspaceId: workspace.id,
    brandId: brand.id,
    status: "approved",
    approvedAt: now,
    approvedBy: human,
    updatedBy: human,
    assets: [asset],
    colours: [
      { role: "primary", name: "Forest", hex: "#123456", usage: "Headings" },
    ],
    typography: [{ role: "body", family: "DM Sans", weights: [400, 700] }],
    voice: {
      descriptors: ["clear"],
      principles: ["Be specific"],
      audiences: [{ audience: "Owners", guidance: "Explain evidence" }],
    },
    terminology: {
      productNames: ["One"],
      capabilityNames: ["Content"],
      use: ["evidence"],
      avoid: ["guaranteed"],
      acronyms: [{ short: "EPC", meaning: "Example" }],
      namingConventions: ["Sentence case"],
    },
    descriptions: {
      short: "Approved brand copy",
      products: [
        { productId: products[0].id, description: "Approved product copy" },
      ],
    },
    emailDefaults: { fromDisplayName: "Brand", footer: "Approved footer" },
  });
  return {
    brand,
    kit,
    asset,
    workspace,
    organisation,
    products,
    model: {
      brands: [brand],
      kits: [kit],
      workspaces: [workspace],
      organisations: [organisation],
      products,
    },
  };
}
test("Brand is distinct from Organisation and Product; one kit serves multiple branded Products without copying it", () => {
  const f = fixture();
  validateBrandRelationships(f.model);
  assert.notEqual(f.brand.id, f.organisation.id);
  for (const product of f.products) {
    assert.notEqual(f.brand.id, product.id);
    assert.equal(product.brandId, f.brand.id);
    assert.equal("brandKit" in product, false);
  }
  assert.deepEqual(brandKitReadiness(f.kit), {
    logo: true,
    colours: true,
    typography: true,
    voice: true,
    descriptions: true,
    emailDefaults: true,
  });
  assert.equal(
    brandKitReadiness(
      BrandKitSchema.parse({ ...f.kit, voice: { descriptors: [] } }),
    ).voice,
    false,
  );
});
test("reference graph rejects missing Brands, cross-workspace relationships and another Brand's approved Product copy", () => {
  const f = fixture();
  const other = generatePlatformId("workspace");
  for (const patch of [
    { brands: [] },
    { workspaces: [] },
    { organisations: [] },
    { kits: [{ ...f.kit, workspaceId: other }] },
    { products: f.products.map((p) => ({ ...p, workspaceId: other })) },
    { organisations: [{ ...f.organisation, workspaceId: other }] },
    {
      kits: [
        {
          ...f.kit,
          descriptions: {
            products: [
              {
                productId: generatePlatformId("product"),
                description: "Wrong",
              },
            ],
          },
        },
      ],
    },
  ])
    assert.throws(() => validateBrandRelationships({ ...f.model, ...patch }));
  assert.throws(() =>
    validateBrandRelationships({
      ...f.model,
      kits: [
        {
          ...f.kit,
          emailDefaults: {
            replyToContactPointId: generatePlatformId("contact"),
          },
        },
      ],
    }),
  );
  const contact = {
    id: generatePlatformId("contact"),
    workspaceId: f.workspace.id,
  };
  validateBrandRelationships({
    ...f.model,
    kits: [{ ...f.kit, emailDefaults: { replyToContactPointId: contact.id } }],
    contactPoints: [contact],
  });
});
test("asset references exclude blobs, signed URLs, credentials and path traversal", () => {
  const { asset, kit } = fixture();
  for (const patch of [
    { data: "base64-data" },
    { binary: Buffer.from("image") },
    { type: "font" },
    { variant: "invented" },
    {
      object: { store: "s3", bucket: "example-brand-assets", key: "../secret" },
    },
    {
      object: {
        ...asset.object,
        url: "https://signed.example.test?token=secret",
      },
    },
    { object: { ...asset.object, key: "data:image/png;base64,aaa" } },
  ])
    assert.equal(
      BrandAssetSchema.safeParse({ ...asset, ...patch }).success,
      false,
    );
  for (const field of [
    "apiKey",
    "password",
    "provider",
    "refreshToken",
    "credentials",
  ])
    assert.equal(
      BrandKitSchema.safeParse({ ...kit, emailDefaults: { [field]: "secret" } })
        .success,
      false,
    );
  assert.equal(
    BrandKitSchema.safeParse({ ...kit, assets: Array(101).fill(asset) })
      .success,
    false,
  );
});
test("colours, typography, bounded terminology/voice, approval and human audit fields validate", () => {
  const { kit } = fixture();
  for (const patch of [
    { colours: [{ role: "primary", name: "bad", hex: "red" }] },
    { typography: [{ role: "body", family: "DM Sans", weights: [1001] }] },
    { typography: [{ role: "body", family: "DM Sans", fontData: "base64" }] },
    { voice: { writingStyle: "x".repeat(5001) } },
    { terminology: { use: Array(41).fill("word") } },
    { updatedBy: { type: "agent", id: "writer" } },
    { approvedBy: undefined },
    { approvedAt: new Date(now.getTime() + 1) },
    { updatedAt: new Date(0) },
    { archived: true },
  ])
    assert.equal(BrandKitSchema.safeParse({ ...kit, ...patch }).success, false);
  const mongo = BRAND_MONGO_VALIDATORS.brand_kits.$and[0].$jsonSchema;
  assert.equal(mongo.additionalProperties, false);
  assert.equal(mongo.properties.emailDefaults.additionalProperties, false);
  assert.equal(
    mongo.properties.assets.items.properties.object.additionalProperties,
    false,
  );
  assert.equal(
    mongo.properties.colours.items.properties.hex.pattern,
    "^#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?$",
  );
});
test("one current approved kit allows drafts and retired history; replacement and workspace slugs are isolated", async () => {
  const f = fixture();
  const db = new EnquiryMemoryDb();
  await db.collection("brand_kits").insertOne(f.kit);
  await assert.rejects(
    db.collection("brand_kits").insertOne({
      ...f.kit,
      id: generatePlatformId("brandkit"),
      status: "approved",
    }),
  );
  assert.throws(
    () =>
      validateBrandRelationships({
        ...f.model,
        kits: [f.kit, { ...f.kit, id: generatePlatformId("brandkit") }],
      }),
    /One current approved/,
  );
  const retired = BrandKitSchema.parse({
    ...f.kit,
    id: generatePlatformId("brandkit"),
    status: "retired",
  });
  const draft = BrandKitSchema.parse({
    ...f.kit,
    id: generatePlatformId("brandkit"),
    status: "draft",
    approvedAt: undefined,
    approvedBy: undefined,
  });
  await db.collection("brand_kits").insertOne(retired);
  await db.collection("brand_kits").insertOne(draft);
  validateBrandRelationships({ ...f.model, kits: [f.kit, retired, draft] });
  const productsBefore = structuredClone(f.products);
  db.rows("brand_kits")[0].status = "retired";
  const replacement = { ...f.kit, id: generatePlatformId("brandkit") };
  await db.collection("brand_kits").insertOne(replacement);
  validateBrandRelationships({
    ...f.model,
    kits: [{ ...f.kit, status: "retired" }, retired, draft, replacement],
  });
  assert.deepEqual(f.products, productsBefore);
  await db.collection("brands").insertOne(f.brand);
  await assert.rejects(
    db
      .collection("brands")
      .insertOne({ ...f.brand, id: generatePlatformId("brand") }),
  );
  await db.collection("brands").insertOne({
    ...f.brand,
    id: generatePlatformId("brand"),
    workspaceId: generatePlatformId("workspace"),
  });
});
test("agent consumer returns current approved shared kit only under explicit workspace grants", async () => {
  const f = fixture();
  const db = new EnquiryMemoryDb();
  db.rows("brands").push(f.brand);
  db.rows("brand_kits").push({
    ...f.kit,
    assets: [f.asset, { ...f.asset, name: "Old", status: "retired" }],
  });
  db.rows("crm_workspaces").push(f.workspace);
  const agent = { type: "agent", id: "content-strategy" } as const;
  const authority = createAuthorizationAuthority({
    humanClients: [
      { issuer: human.issuer, clientId: "vapp", application: "vapp" },
    ],
    serviceGrants: (["brands", "brand_kits"] as const).map((resource) => ({
      actor: agent,
      application: "system",
      action: "read",
      resource,
      scope: { kind: "workspace", workspaceId: f.workspace.id },
    })),
  });
  const ctx = authority.service(agent, "system");
  const result = await readCurrentBrandKit(
    await db.mongo.database(),
    authority,
    ctx,
    f.workspace.id,
    f.brand.id,
  );
  assert.equal(result?.kit.id, f.kit.id);
  assert.equal(result?.kit.assets.length, 1);
  await assert.rejects(
    readCurrentBrandKit(
      await db.mongo.database(),
      authority,
      ctx,
      generatePlatformId("workspace"),
      f.brand.id,
    ),
  );
  const vapp = authority.authenticatedHuman({
    issuer: human.issuer,
    clientId: "vapp",
    subject: human.id,
  });
  await assert.rejects(
    readCurrentBrandKit(
      await db.mongo.database(),
      authority,
      vapp,
      f.workspace.id,
      f.brand.id,
    ),
  );
  assert.throws(() =>
    authority.service({ type: "agent", id: "ungranted" }, "system"),
  );
  for (const status of ["draft", "retired"]) {
    db.rows("brand_kits")[0].status = status;
    assert.equal(
      await readCurrentBrandKit(
        await db.mongo.database(),
        authority,
        ctx,
        f.workspace.id,
        f.brand.id,
      ),
      null,
    );
  }
  db.rows("brand_kits")[0].status = "approved";
  const replacement = { ...f.kit, id: generatePlatformId("brandkit") };
  db.rows("brand_kits")[0].status = "retired";
  db.rows("brand_kits").push(
    { ...f.kit, id: generatePlatformId("brandkit"), status: "draft" },
    replacement,
  );
  assert.equal(
    (
      await readCurrentBrandKit(
        await db.mongo.database(),
        authority,
        ctx,
        f.workspace.id,
        f.brand.id,
      )
    )?.kit.id,
    replacement.id,
  );
  // Fail closed even if an unprovisioned/corrupt store bypasses the unique index.
  db.rows("brand_kits").push({
    ...replacement,
    id: generatePlatformId("brandkit"),
  });
  await assert.rejects(
    readCurrentBrandKit(
      await db.mongo.database(),
      authority,
      ctx,
      f.workspace.id,
      f.brand.id,
    ),
    /Ambiguous current/,
  );
  db.rows("brand_kits").pop();
  db.rows("crm_workspaces")[0].archived = true;
  assert.equal(
    await readCurrentBrandKit(
      await db.mongo.database(),
      authority,
      ctx,
      f.workspace.id,
      f.brand.id,
    ),
    null,
  );
});
