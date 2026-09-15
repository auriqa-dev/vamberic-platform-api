import { Router, type IRouter } from "express";
import { GetDashboardSummaryResponse } from "@workspace/api-zod";
import { getDomainCollections } from "../db";
import type { MongoService } from "../services/mongo";

export function createDashboardRouter(mongo: MongoService): IRouter {
  const router: IRouter = Router();

  router.get("/api/v1/dashboard/summary", async (_req, res): Promise<void> => {
    const db = await mongo.database();
    const collections = getDomainCollections(db);
    const [
      totalProducts,
      activeProducts,
      draftOrInactiveProducts,
      totalOrganisations,
      totalPeople,
      totalOpportunities,
    ] = await Promise.all([
      collections.products.countDocuments(),
      collections.products.countDocuments({ status: "active" }),
      collections.products.countDocuments({ status: { $ne: "active" } }),
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
