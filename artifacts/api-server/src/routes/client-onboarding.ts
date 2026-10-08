import { Router } from "express";
import { z } from "zod";
import type { AppConfig } from "../config";
import type { MongoService } from "../services/mongo";
import {
  listClientOnboardings,
  mutateClientOnboarding,
} from "../services/client-onboarding";
export function createClientOnboardingRouter(
  config: AppConfig,
  mongo: MongoService,
) {
  const router = Router();
  for (const governance of [false, true]) {
    const root = governance
      ? "/empress/client-onboarding"
      : "/partners/:partnerId/client-onboarding";
    router.get(root, async (req, res) => {
      const query = z
        .object({ after: z.string().optional() })
        .strict()
        .parse(req.query);
      res.json(
        await listClientOnboardings(
          mongo,
          config,
          req.auth!,
          governance
            ? undefined
            : String((req.params as Record<string, string>).partnerId),
          query.after,
        ),
      );
    });
    if (!governance)
      router.post(root, async (req, res) => {
        z.object({}).strict().parse(req.query);
        res.json(
          await mutateClientOnboarding(
            mongo,
            config,
            req.auth!,
            String((req.params as Record<string, string>).partnerId),
            undefined,
            req.body,
          ),
        );
      });
    router.post(root + "/:id", async (req, res) => {
      z.object({}).strict().parse(req.query);
      res.json(
        await mutateClientOnboarding(
          mongo,
          config,
          req.auth!,
          governance
            ? undefined
            : String((req.params as Record<string, string>).partnerId),
          String(req.params.id),
          req.body,
        ),
      );
    });
  }
  return router;
}
