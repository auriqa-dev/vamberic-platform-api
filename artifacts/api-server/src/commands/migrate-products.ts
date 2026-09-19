import { MongoClient } from "mongodb";
import { normalizeProduct } from "../domain/product-migration";
import { ProductSchema } from "../domain";
import { DATABASE_NAME } from "../services/mongo";

// No default URI: operators must deliberately target an environment.
const mode = process.argv[2];
if (!["--dry-run", "--apply"].includes(mode) || !process.env.MONGODB_URI) {
  console.error("Set MONGODB_URI and run migrate-products --dry-run | --apply");
  process.exitCode = 1;
} else {
  const client = new MongoClient(process.env.MONGODB_URI, {
    serverSelectionTimeoutMS: 5000,
  });
  try {
    await client.connect();
    const products = client.db(DATABASE_NAME).collection("products");
    const records = await products
      .find({ productModelVersion: { $ne: 2 } })
      .toArray();
    // Validate the complete plan before the first write. Originals stay in each document.
    const plan = records.map((record) => ({
      record,
      updated: normalizeProduct(record),
    }));
    for (const { updated } of plan) ProductSchema.parse(updated);
    console.log(
      JSON.stringify(
        plan.map(({ record, updated }) => ({
          id: record.id,
          name: record.name,
          previousStatus: record.status,
          previousType: record.productType,
          previousCommercialModel: record.commercialModel,
          previousDomains: record.domains,
          previousCurrency: record.currency,
          previousOneOffPurchaseAvailable: record.oneOffPurchaseAvailable,
          previousSubscriptionAvailable: record.subscriptionAvailable,
          proposed: {
            productType: updated.productType,
            lifecycleStatus: updated.lifecycleStatus,
            businessModel: updated.businessModel,
            revenueModels: updated.revenueModels,
            primaryDomain: updated.primaryDomain,
            additionalDomains: updated.additionalDomains,
            currency: updated.currency,
          },
          warnings: updated.migrationWarnings,
        })),
        null,
        2,
      ),
    );
    if (mode === "--apply") {
      for (const { record, updated } of plan) {
        const fields = Object.fromEntries(
          Object.entries(updated).filter(([key]) => key !== "_id"),
        );
        const result = await products.updateOne(
          {
            _id: record._id,
            updatedAt: record.updatedAt,
            productModelVersion: { $ne: 2 },
          },
          { $set: fields },
        );
        if (result.matchedCount !== 1)
          throw new Error("Concurrent edit; rerun preflight");
      }
    }
    console.log(
      `${mode}: ${plan.length} products; no documents deleted or recreated.`,
    );
  } catch {
    console.error(
      "Product migration failed. No data removed; rerun dry-run to inspect remaining records.",
    );
    process.exitCode = 1;
  } finally {
    await client.close();
  }
}
