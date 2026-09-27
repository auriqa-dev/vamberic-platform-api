import type { RequestHandler } from "express";
import type {
  AuthorizationAuthority,
  AuthorizationContext,
  Action,
  ResourceType,
} from "../authorization/policy";
import { isPlatformId } from "../domain/ids";
import { logger } from "../lib/logger";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      authorization?: AuthorizationContext;
    }
  }
}

/** Explicit current operational surface. Adding a route requires an access decision.
 * This adapter supports internal Vapp only; future workspace routes need their own
 * adapter using authority.scopeFilter and a server-resolved workspace membership.
 */
export function authorizeOperationalRequest(
  authority: AuthorizationAuthority,
): RequestHandler {
  return (req, res, next) => {
    const path = req.path.toLowerCase().replace(/\/$/, "");
    const read = req.method === "GET" || req.method === "HEAD";
    if (read && ["/health", "/ready"].includes(path)) {
      next();
      return;
    }
    const match =
      /^\/(products|people|organisations|opportunities)(?:\/([^/]+)(\/delete-preview)?)?$/.exec(
        path,
      );
    let resources: ResourceType[] = [];
    let action: Action | undefined;
    if (path === "/dashboard/summary" && read) {
      resources = ["products", "people", "organisations", "opportunities"];
      action = "read";
    } else if (match) {
      const [, kind, id, preview] = match;
      resources = [kind as ResourceType];
      if (preview) {
        if (read && kind !== "products") action = "delete-preview";
      } else if (read) action = "read";
      else if (req.method === "POST" && !id && kind === "products")
        action = "create";
      else if (req.method === "PATCH" && id && kind === "products")
        action = "update";
      else if (req.method === "DELETE" && id && kind !== "products")
        action = "delete";
    }
    const context = req.authorization;
    const allowed =
      action &&
      resources.every((type) => authority.authorize(context, action, { type }));
    if (context && action && action !== "read") {
      const audit = {
        actor: context.actor,
        application: context.application,
        workspace: "internal",
        action,
        resourceType: resources[0],
        ...(isPlatformId(match?.[2]) ? { resourceId: match![2] } : {}),
      };
      res.once("finish", () => {
        // Do not let audit transport failures change a committed operation's outcome.
        try {
          logger.info(
            {
              ...audit,
              ...(isPlatformId(res.locals.authorizationResourceId)
                ? { resourceId: res.locals.authorizationResourceId }
                : {}),
              timestamp: new Date().toISOString(),
              statusCode: res.statusCode,
              outcome: res.statusCode < 400 ? "succeeded" : "rejected",
            },
            "Operational authorization audit",
          );
        } catch {
          /* best effort */
        }
      });
    }
    if (!allowed) {
      res
        .status(404)
        .json({ error: { code: "NOT_FOUND", message: "Resource not found" } });
      return;
    }
    next();
  };
}
