import { CapacityUnavailable } from "../services/agent-capacity";
import { AgentProposalStale } from "../services/agent-proposal-freshness";
import { Router, json, type ErrorRequestHandler, type Request } from "express";
import { z, ZodError } from "zod";
import type { AppConfig } from "../config";
import type { MongoService } from "../services/mongo";
import { AuthorizationDenied } from "../authorization/policy";
import {
  createAgentControlPlane,
  AgentRunConflict,
} from "../services/agent-control-plane";
import { AgentAuthorityConflict } from "../services/agent-authority-serialization";
import {
  AgentControlPlaneUnavailable,
  AgentOperatorConflict,
} from "../services/agent-operators";
import type { AgentWorkloadPrincipal } from "../authorization/agent-workload";

export type AgentControlPlane = ReturnType<typeof createAgentControlPlane>;
/** Authentication is injected only by a trusted composition root; normal app
 * composition installs none. Headers, human tokens and body identities cannot
 * mint the WeakSet-issued principal required again by the lifecycle service. */
export type WorkloadAuthenticator = (
  request: Request,
) => Promise<AgentWorkloadPrincipal>;
const id = z.string().min(1).max(100);
const lease = z
  .object({
    runId: id,
    attemptId: id,
    generation: z.number().int().positive(),
    fence: z.number().int().positive(),
    leaseId: id,
  })
  .strict();
const empty = z.object({}).strict();
export const agentControlPlaneErrors: ErrorRequestHandler = (
  error,
  _req,
  res,
  _next,
) => {
  void _next;
  // Deliberately do not forward raw protocol/provider errors to normal logging.
  if (error instanceof AuthorizationDenied)
    res.status(404).json({ error: "not_found" });
  else if (
    error instanceof ZodError ||
    error?.name === "ZodError" ||
    error?.type === "entity.parse.failed"
  )
    res.status(400).json({ error: "invalid_request" });
  else if (error?.type === "entity.too.large")
    res.status(413).json({ error: "request_too_large" });
  else if (
    error instanceof AgentProposalStale ||
    error instanceof AgentRunConflict ||
    error instanceof AgentAuthorityConflict ||
    error instanceof AgentOperatorConflict
  )
    res.status(409).json({ error: "agent_state_conflict" });
  else if (
    error instanceof AgentControlPlaneUnavailable ||
    error instanceof CapacityUnavailable
  )
    res.status(503).json({ error: "agent_control_plane_unavailable" });
  else res.status(500).json({ error: "agent_operation_failed" });
};
export function createAgentWorkloadRouter(
  service: AgentControlPlane,
  authenticate?: WorkloadAuthenticator,
  capacity?: ReturnType<
    typeof import("../services/agent-execution-reconciliation").createExecutionReconciliation
  >,
) {
  const router = Router();
  const principals = new WeakMap<Request, AgentWorkloadPrincipal>();
  router.use(async (req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    if (!authenticate) {
      res.status(503).json({ error: "workload_authentication_unavailable" });
      return;
    }
    principals.set(req, await authenticate(req));
    next();
  });
  router.use(json({ limit: "300kb", strict: true, inflate: false }));
  if (capacity) {
    router.post("/capacity", async (req, res) => {
      empty.parse(req.query);
      res.json(await capacity.report(principals.get(req)!, req.body));
    });
    router.post("/execution-prepare", async (req, res) => {
      empty.parse(req.query);
      res.json(await capacity.prepare(principals.get(req)!, req.body));
    });
    router.post("/execution-send", async (req, res) => {
      empty.parse(req.query);
      res.json(await capacity.issueSend(principals.get(req)!, req.body));
    });
    router.post("/execution-evidence", async (req, res) => {
      empty.parse(req.query);
      res.json(await capacity.evidence(principals.get(req)!, req.body));
    });
    router.post("/execution-quarantine", async (req, res) => {
      empty.parse(req.query);
      res.json(await capacity.quarantine(principals.get(req)!, req.body));
    });
  }
  router.post("/claim", async (req, res) => {
    empty.parse(req.query);
    const body = z
      .object({ dispatch: z.unknown(), claimId: id })
      .strict()
      .parse(req.body);
    res.json(
      await service.claim(principals.get(req)!, {
        dispatch: body.dispatch,
        claimId: body.claimId,
      }),
    );
  });
  router.post("/dispatch-status", async (req, res) => {
    empty.parse(req.query);
    const body = z.object({ dispatch: z.unknown() }).strict().parse(req.body);
    res.json(await service.dispatchStatus(principals.get(req)!, body.dispatch));
  });
  router.post("/rejection", async (req, res) => {
    empty.parse(req.query);
    const body = z
      .object({ lease, reason: z.string().max(64) })
      .strict()
      .parse(req.body);
    res.json(
      await service.rejectWork(principals.get(req)!, body.lease, body.reason),
    );
  });
  router.post("/heartbeat", async (req, res) => {
    empty.parse(req.query);
    const body = z.object({ lease }).strict().parse(req.body);
    res.json(await service.heartbeat(principals.get(req)!, body.lease));
  });
  router.post("/context", async (req, res) => {
    empty.parse(req.query);
    const body = z.object({ lease, snapshotId: id }).strict().parse(req.body);
    res.json(
      await service.context(principals.get(req)!, {
        ...body.lease,
        snapshotId: body.snapshotId,
      }),
    );
  });
  router.post("/receipt", async (req, res) => {
    empty.parse(req.query);
    const body = z
      .object({
        lease,
        submissionId: id,
        payloadDigest: z.string().regex(/^[a-f0-9]{64}$/),
      })
      .strict()
      .parse(req.body);
    res.json(
      (await service.receipt(principals.get(req)!, {
        ...body.lease,
        submissionId: body.submissionId,
        payloadDigest: body.payloadDigest,
      })) ?? null,
    );
  });
  for (const action of ["outcome", "usage"] as const)
    router.post("/" + action, async (req, res) => {
      empty.parse(req.query);
      const body = z
        .object({ lease, payload: z.unknown() })
        .strict()
        .parse(req.body);
      res.json(
        action === "outcome"
          ? await service.outcome(
              principals.get(req)!,
              body.lease,
              body.payload,
            )
          : await service.reportUsage(
              principals.get(req)!,
              body.lease,
              body.payload,
            ),
      );
    });
  router.use(agentControlPlaneErrors);
  return router;
}
export interface AgentHumanOperations {
  psuOptions?(
    identity: NonNullable<Request["auth"]>,
    workspaceId: string,
  ): Promise<unknown>;
  effectiveness?: ReturnType<
    typeof import("../services/agent-effectiveness").createAgentEffectiveness
  >;
  create(
    identity: NonNullable<Request["auth"]>,
    workspaceId: string,
    input: unknown,
  ): Promise<unknown>;
  readiness(
    identity: NonNullable<Request["auth"]>,
    workspaceId: string,
    input: unknown,
  ): Promise<unknown>;
  apply(
    identity: NonNullable<Request["auth"]>,
    runId: string,
    input: unknown,
  ): Promise<unknown>;
  reject(
    identity: NonNullable<Request["auth"]>,
    runId: string,
    input: unknown,
  ): Promise<unknown>;
}
export function createAgentHumanRouter(
  _config: AppConfig,
  _mongo: MongoService,
  service: AgentControlPlane,
  operations: AgentHumanOperations,
) {
  const router = Router();
  if (operations.psuOptions)
    router.get("/workspaces/:workspaceId/psu-options", async (req, res) => {
      empty.parse(req.query);
      res.json(
        await operations.psuOptions!(req.auth!, String(req.params.workspaceId)),
      );
    });
  if (operations.effectiveness) {
    const effects = operations.effectiveness;
    router.post(
      "/agent-effectiveness-cases/:caseId/re-evaluate",
      async (req, res) => {
        empty.parse(req.query);
        res
          .status(201)
          .json(
            await effects.requestExecution(
              req.auth!,
              String(req.params.caseId),
              "evaluator",
              req.body,
            ),
          );
      },
    );
    router.post(
      "/agent-effectiveness-cases/:caseId/revise",
      async (req, res) => {
        empty.parse(req.query);
        res
          .status(201)
          .json(
            await effects.requestExecution(
              req.auth!,
              String(req.params.caseId),
              "revision",
              req.body,
            ),
          );
      },
    );
    router.get(
      "/workspaces/:workspaceId/agent-effectiveness-cases",
      async (req, res) =>
        res.json(
          await effects.list(
            req.auth!,
            String(req.params.workspaceId),
            req.query,
          ),
        ),
    );
    router.post(
      "/workspaces/:workspaceId/agent-effectiveness-cases",
      async (req, res) => {
        empty.parse(req.query);
        res
          .status(201)
          .json(
            await effects.create(
              req.auth!,
              String(req.params.workspaceId),
              req.body,
            ),
          );
      },
    );
    router.get("/agent-effectiveness-cases/:caseId", async (req, res) => {
      empty.parse(req.query);
      res.json(await effects.read(req.auth!, String(req.params.caseId)));
    });
    router.post(
      "/agent-effectiveness-cases/:caseId/review",
      async (req, res) => {
        empty.parse(req.query);
        res.json(
          await effects.review(req.auth!, String(req.params.caseId), req.body),
        );
      },
    );
    router.post(
      "/agent-effectiveness-cases/:caseId/cancel",
      async (req, res) => {
        empty.parse(req.query);
        empty.parse(req.body);
        res.json(await effects.cancel(req.auth!, String(req.params.caseId)));
      },
    );
  }
  router.get("/workspaces/:workspaceId/agent-runs", async (req, res) =>
    res.json(
      await service.list(req.auth!, String(req.params.workspaceId), req.query),
    ),
  );
  router.post("/workspaces/:workspaceId/agent-runs", async (req, res) => {
    empty.parse(req.query);
    res
      .status(201)
      .json(
        await operations.create(
          req.auth!,
          String(req.params.workspaceId),
          req.body,
        ),
      );
  });
  router.post(
    "/workspaces/:workspaceId/agent-execution-readiness",
    async (req, res) => {
      empty.parse(req.query);
      res.json(
        await operations.readiness(
          req.auth!,
          String(req.params.workspaceId),
          req.body,
        ),
      );
    },
  );
  router.get("/agent-runs/:runId", async (req, res) => {
    empty.parse(req.query);
    res.json(await service.read(req.auth!, String(req.params.runId)));
  });
  router.get("/agent-runs/:runId/results", async (req, res) => {
    empty.parse(req.query);
    res.json(await service.results(req.auth!, String(req.params.runId)));
  });
  router.post("/agent-runs/:runId/input", async (req, res) => {
    empty.parse(req.query);
    const body = z
      .object({
        expectedUpdatedAt: z.string().datetime(),
        response: z.unknown(),
      })
      .strict()
      .parse(req.body);
    res.json(
      await service.respond(
        req.auth!,
        String(req.params.runId),
        body.expectedUpdatedAt,
        body.response,
      ),
    );
  });
  router.post("/agent-runs/:runId/cancel", async (req, res) => {
    empty.parse(req.query);
    const body = z
      .object({ expectedUpdatedAt: z.string().datetime() })
      .strict()
      .parse(req.body);
    res.json(
      await service.cancel(
        req.auth!,
        String(req.params.runId),
        body.expectedUpdatedAt,
      ),
    );
  });
  for (const action of ["apply", "reject"] as const)
    router.post(`/agent-runs/:runId/proposals/${action}`, async (req, res) => {
      empty.parse(req.query);
      res.json(
        await operations[action](req.auth!, String(req.params.runId), req.body),
      );
    });
  router.use(agentControlPlaneErrors);
  return router;
}
