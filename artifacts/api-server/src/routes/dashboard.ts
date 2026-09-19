import { readProduct } from "../domain/product-migration";
import { Router, type IRouter } from "express";
import { GetDashboardSummaryResponse } from "@workspace/api-zod";
import { getDomainCollections } from "../db";
import type { MongoService } from "../services/mongo";

export function createDashboardRouter(mongo: MongoService): IRouter {
  const router: IRouter = Router();

  router.get("/api/v1/dashboard/summary", async (_req, res): Promise<void> => {
    const db = await mongo.database();
    const collections = getDomainCollections(db);
    const products = (
      await collections.products.find({}).sort({ updatedAt: -1 }).toArray()
    ).map(readProduct);
    const liveCount = products.filter(
      (product) => product.lifecycleStatus === "live",
    ).length;
    const [
      totalProducts,
      activeProducts,
      draftOrInactiveProducts,
      totalOrganisations,
      totalPeople,
      totalOpportunities,
    ] = await Promise.all([
      Promise.resolve(products.length),
      Promise.resolve(liveCount),
      Promise.resolve(products.length - liveCount),
      collections.organisations.countDocuments(),
      collections.people.countDocuments(),
      collections.opportunities.countDocuments(),
    ]);

    res.json(
      GetDashboardSummaryResponse.parse({
        totalProducts,
        activeProducts,
        draftOrInactiveProducts,
        totalOrganisations,
        totalPeople,
        totalOpportunities,
      }),
    );
  });

  return router;
}
