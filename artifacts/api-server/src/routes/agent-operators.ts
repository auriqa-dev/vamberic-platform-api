import { Router, type ErrorRequestHandler } from "express";
import { z, ZodError } from "zod";
import { AuthorizationDenied } from "../authorization/policy";
import type { AppConfig } from "../config";
import type { MongoService } from "../services/mongo";
import {
  createAgentOperatorService,
  AgentOperatorConflict,
  AgentControlPlaneUnavailable,
  type AgentOperationCatalogue,
} from "../services/agent-operators";

export function createAgentOperatorRouter(
  config: AppConfig,
  mongo: MongoService,
  catalogue?: AgentOperationCatalogue,
) {
  const router = Router();
  const service = createAgentOperatorService(config, mongo, catalogue);
  const root = "/workspaces/:workspaceId";
  router.post(root + "/member-agent-operation-grant", async (req, res) => {
    z.object({}).strict().parse(req.query);
    res.json(
      await service.grant(req.auth!, String(req.params.workspaceId), req.body),
    );
  });
  router.post(root + "/member-agent-operation-revoke", async (req, res) => {
    z.object({}).strict().parse(req.query);
    res.json(
      await service.revoke(req.auth!, String(req.params.workspaceId), req.body),
    );
  });
  router.get(
    root + "/members/:membershipId/agent-operation-grants",
    async (req, res) => {
      z.object({}).strict().parse(req.query);
      res.json(
        await service.readGrants(
          req.auth!,
          String(req.params.workspaceId),
          String(req.params.membershipId),
        ),
      );
    },
  );
  router.get(root + "/agent-operation-context", async (req, res) => {
    res.json(
      await service.discover(
        req.auth!,
        String(req.params.workspaceId),
        req.query,
      ),
    );
  });
  const errors: ErrorRequestHandler = (error, _req, res, next) => {
    if (error instanceof AuthorizationDenied) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    if (error instanceof ZodError) {
      res.status(400).json({ error: "invalid_request" });
      return;
    }
    if (error instanceof AgentOperatorConflict) {
      res.status(409).json({ error: "operator_grant_conflict" });
      return;
    }
    if (error instanceof AgentControlPlaneUnavailable) {
      res.status(503).json({ error: "agent_control_plane_unavailable" });
      return;
    }
    next(error);
  };
  router.use(errors);
  return router;
}
