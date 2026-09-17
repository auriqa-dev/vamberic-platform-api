import type { RequestHandler } from "express";
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import type { AppConfig } from "../config";

export type JwtKeyResolver = JWTVerifyGetKey;

export interface AuthenticatedUser {
  readonly subject: string;
  readonly issuer: string;
  readonly clientId: string;
}

declare global {
  // Express exposes this namespace specifically for request-context augmentation.
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthenticatedUser;
    }
  }
}

export function authenticate(
  config: AppConfig["cognito"],
  keyResolver: JwtKeyResolver = createRemoteJWKSet(
    new URL(`${config.issuer}/.well-known/jwks.json`),
    { timeoutDuration: 5_000, cooldownDuration: 30_000 },
  ),
): RequestHandler {
  return async (req, res, next): Promise<void> => {
    // Express routes are case-insensitive and permit a trailing slash.
    const path = req.path.toLowerCase().replace(/\/$/, "");
    if (
      (req.method === "GET" || req.method === "HEAD") &&
      (path === "/health" || path === "/ready")
    ) {
      next();
      return;
    }

    try {
      const header = req.headers.authorization;
      const match = header?.match(
        /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i,
      );
      if (!match) throw new Error("Unauthorized");

      const { payload, protectedHeader } = await jwtVerify(
        match[1],
        keyResolver,
        {
          algorithms: ["RS256"],
          issuer: config.issuer,
          requiredClaims: ["exp", "iat", "sub", "token_use", "client_id"],
        },
      );
      // Cognito access tokens identify the app with client_id, not aud.
      // ID tokens are not API credentials, even when their aud matches.
      if (
        payload.token_use !== "access" ||
        payload.client_id !== config.clientId ||
        typeof payload.sub !== "string" ||
        !payload.sub.trim() ||
        typeof protectedHeader.kid !== "string" ||
        !protectedHeader.kid ||
        typeof payload.iat !== "number" ||
        payload.iat > Date.now() / 1000
      )
        throw new Error("Unauthorized");

      req.auth = Object.freeze({
        subject: payload.sub,
        issuer: config.issuer,
        clientId: config.clientId,
      });
    } catch {
      // Do not forward verification errors to logging middleware: they can
      // contain token claims. Every authentication failure has the same body.
      res.setHeader("WWW-Authenticate", "Bearer");
      res.setHeader("Cache-Control", "no-store");
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    next();
  };
}
