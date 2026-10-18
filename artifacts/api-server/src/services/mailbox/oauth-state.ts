import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export interface OAuthBinding {
  workspaceId: string;
  subject: string;
  issuer: string;
  clientId: string;
  provider: "microsoft365" | "google_workspace" | "ga4";
}
export interface OAuthAttempt extends OAuthBinding {
  stateHash: string;
  browserHash: string;
  expiresAt: Date;
}
export const oauthHash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export function createOAuthAttempt(binding: OAuthBinding, now = Date.now()) {
  const state = randomBytes(32).toString("base64url");
  const browserSecret = randomBytes(32).toString("base64url");
  const verifier = randomBytes(48).toString("base64url");
  return {
    state,
    browserSecret,
    verifier,
    challenge: createHash("sha256").update(verifier).digest("base64url"),
    record: {
      ...binding,
      stateHash: oauthHash(state),
      browserHash: oauthHash(browserSecret),
      expiresAt: new Date(now + 600_000),
    } satisfies OAuthAttempt,
  };
}
/** The caller must atomically consume the matching persisted attempt before exchanging a code.
 * PKCE verifier stays in secure server storage; browserSecret remains only in the initiating window memory; completion also requires its authenticated HVM session.
 */
export function validOAuthAttempt(
  attempt: OAuthAttempt,
  binding: OAuthBinding,
  state: string,
  browserSecret: string,
  now = Date.now(),
) {
  if (
    attempt.expiresAt.getTime() <= now ||
    !/^[A-Za-z0-9_-]{43}$/.test(state) ||
    !/^[A-Za-z0-9_-]{43}$/.test(browserSecret)
  )
    return false;
  if (
    (
      ["workspaceId", "subject", "issuer", "clientId", "provider"] as const
    ).some((k) => attempt[k] !== binding[k])
  )
    return false;
  const same = (a: string, b: string) =>
    a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
  return (
    same(attempt.stateHash, oauthHash(state)) &&
    same(attempt.browserHash, oauthHash(browserSecret))
  );
}
