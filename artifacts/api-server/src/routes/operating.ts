import { registerLusha } from "../services/lusha/catalogue";
import {
  readMethodologyCatalogue,
  registerMethodology,
} from "../services/methodology-catalogue";
import {
  readWorkspaceBilling,
  mutateWorkspaceBilling,
} from "../services/workspace-billing";
import { Router, type ErrorRequestHandler } from "express";
import { z, ZodError } from "zod";
import { ApprovalRequest } from "../services/agreement-approval-contract";
import type { AppConfig } from "../config";
import type { MongoService } from "../services/mongo";
import { AuthorizationDenied } from "../authorization/policy";
import {
  OPERATING_PREFIXES,
  PLATFORM_OPERATING_RESOURCES,
  type OperatingResource,
} from "../domain/operating";
import {
  readOperating,
  reviewAgentRemoval,
  mutateOperating,
  readQueenCatalogue,
  OperatingConflict,
  readAgreementApprovals,
} from "../services/operating";
export function createOperatingRouter(config: AppConfig, mongo: MongoService) {
  const router = Router();
  router.post("/empress/lusha/register",async(req,res)=>res.json(await registerLusha(mongo,config,req.auth!)));
  router.get("/empress/offer-methodology-catalogue", async (req, res) =>
    res.json(await readMethodologyCatalogue(mongo, config, req.auth!)),
  );
  router.post(
    "/empress/offer-methodology-catalogue/register",
    async (req, res) => {
      const body = z
        .object({ id: z.string(), version: z.number().int().positive() })
        .strict()
        .parse(req.body);
      res.json(
        await registerMethodology(
          mongo,
          config,
          req.auth!,
          body.id,
          body.version,
        ),
      );
    },
  );
  router.get(
    "/empress/agent-definitions/:id/removal-review/:operation",
    async (req, res) =>
      res.json(
        await reviewAgentRemoval(
          mongo,
          config,
          req.auth!,
          String(req.params.id),
          String(req.params.operation),
        ),
      ),
  );
  router.get("/empress/workspace-billing/:workspaceId", async (req, res) =>
    res.json(
      await readWorkspaceBilling(
        mongo,
        config,
        req.auth!,
        String(req.params.workspaceId),
        true,
      ),
    ),
  );
  router.post("/empress/workspace-billing/:workspaceId", async (req, res) =>
    res.json(
      await mutateWorkspaceBilling(
        mongo,
        config,
        req.auth!,
        String(req.params.workspaceId),
        req.body,
      ),
    ),
  );
  router.get("/workspaces/:workspaceId/billing-treatment", async (req, res) =>
    res.json(
      await readWorkspaceBilling(
        mongo,
        config,
        req.auth!,
        String(req.params.workspaceId),
      ),
    ),
  );
  const approvalRoot = "/empress/agreement-approvals";
  router.get(approvalRoot, async (req, res) =>
    res.json(await readAgreementApprovals(mongo, config, req.auth!, req.query)),
  );
  router.get(approvalRoot + "/:agreementId", async (req, res) =>
    res.json(
      await readAgreementApprovals(
        mongo,
        config,
        req.auth!,
        req.query,
        String(req.params.agreementId),
      ),
    ),
  );
  router.post(approvalRoot + "/:agreementId/approve", async (req, res) => {
    z.object({}).strict().parse(req.query);
    const body = ApprovalRequest.parse(req.body);
    res.json(
      await mutateOperating(
        mongo,
        config,
        req.auth!,
        "swarm_agreements",
        "empress-approve",
        {
          ...body,
          id: String(req.params.agreementId),
        },
      ),
    );
  });
  for (const resource of Object.keys(
    OPERATING_PREFIXES,
  ) as OperatingResource[]) {
    const global = (PLATFORM_OPERATING_RESOURCES as readonly string[]).includes(
      resource,
    );
    const path = resource.replaceAll("_", "-");
    const root = global
      ? `/empress/${path}`
      : `/workspaces/:workspaceId/operating/${path}`;
    const ws = (v: unknown) => (typeof v === "string" ? v : undefined);
    router.get(root, async (req, res) =>
      res.json(
        await readOperating(
          mongo,
          config,
          req.auth!,
          resource,
          req.query,
          ws(req.params.workspaceId),
        ),
      ),
    );
    router.get(root + "/:id", async (req, res) =>
      res.json(
        await readOperating(
          mongo,
          config,
          req.auth!,
          resource,
          req.query,
          ws(req.params.workspaceId),
          String(req.params.id),
        ),
      ),
    );
    if (resource === "client_swarms")
      router.get(root + "/:id/readiness", async (req, res) =>
        res.json(
          await readOperating(
            mongo,
            config,
            req.auth!,
            resource,
            req.query,
            ws(req.params.workspaceId),
            String(req.params.id),
            true,
          ),
        ),
      );
    if (global)
      router.get(
        `/workspaces/:workspaceId/operating/catalogue/${path}`,
        async (req, res) =>
          res.json(
            await readQueenCatalogue(
              mongo,
              config,
              req.auth!,
              String(req.params.workspaceId),
              resource,
            ),
          ),
      );
    for (const operation of [
      "create",
      "update",
      "publish",
      "configure",
      "retire",
      ...(resource === "agent_definitions" ? ["delete"] : []),
      "approve",
      "empress-approve",
      "supersede",
    ])
      router.post(root + "/" + operation, async (req, res) =>
        res
          .status(operation === "create" ? 201 : 200)
          .json(
            await mutateOperating(
              mongo,
              config,
              req.auth!,
              resource,
              operation,
              req.body,
              ws(req.params.workspaceId),
            ),
          ),
      );
  }
  const errors: ErrorRequestHandler = (error, _req, res, _next) => {
    void _next;
    const status =
      error instanceof AuthorizationDenied
        ? 404
        : error instanceof ZodError
          ? 400
          : error instanceof OperatingConflict || error?.code === 11000
            ? 409
            : 503;
    res.status(status).json({
      error: {
        code:
          status === 404
            ? "NOT_FOUND"
            : status === 400
              ? "INVALID_INPUT"
              : status === 409
                ? "CONFLICT"
                : "HVM_UNAVAILABLE",
        message:
          status === 404
            ? "Resource not found"
            : status === 400
              ? "Invalid request"
              : status === 409
                ? "Configuration, policy or record conflict"
                : "HVM temporarily unavailable",
      },
    });
  };
  router.use(errors);
  return router;
}
