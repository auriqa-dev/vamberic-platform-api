import { createHash, randomBytes } from "node:crypto";
import { isIP } from "node:net";
import { z } from "zod";
export const digest = (v: string) =>
  createHash("sha256").update(v).digest("hex");
export const secret = () => randomBytes(32).toString("base64url");
export function websiteOrigin(value: string) {
  const u = new URL(value);
  if (
    u.protocol !== "https:" ||
    u.username ||
    u.password ||
    u.port ||
    u.pathname !== "/" ||
    u.search ||
    u.hash ||
    isIP(u.hostname) ||
    !u.hostname.includes(".") ||
    /\.(local|internal|localhost|test|invalid)$/.test(u.hostname)
  )
    throw new Error("Use the public HTTPS website origin, without a path.");
  return u.origin;
}
export const settings = z
  .object({
    origin: z.string().transform((v, ctx) => {
      try {
        return websiteOrigin(v);
      } catch {
        ctx.addIssue({
          code: "custom",
          message: "Use a public HTTPS website origin without a path.",
        });
        return z.NEVER;
      }
    }),
    brandId: z.string().min(1),
    enabled: z.boolean(),
    testOnly: z.boolean(),
    retentionDays: z.number().int().min(1).max(365),
    policyConfirmed: z.boolean(),
    paths: z
      .array(
        z
          .string()
          .regex(/^\/[a-zA-Z0-9_\-/]*$/)
          .max(200),
      )
      .max(100)
      .default([]),
    events: z.array(z.string().regex(/^[a-z][a-z0-9_]{0,39}$/)).max(20),
  })
  .strict();
export const browserEvent = z
  .object({
    eventId: z.string().uuid(),
    session: z.string().max(160).optional(),
    link: z.string().max(160).optional(),
    kind: z.enum(["page_view", "engaged", "custom"]),
    // Only a path is retained, never query strings, fragments, form values or titles.
    path: z.string().max(1000),
    name: z.string().max(40).optional(),
    consent: z.literal(true),
  })
  .strict();
export function safePath(path: string) {
  if (!path.startsWith("/") || path.startsWith("//"))
    throw new Error("Invalid path");
  // Dynamic paths can contain identifiers. Retain no path except registered static paths.
  return path.split(/[?#]/)[0];
}
export function automated(agent: string, purpose: string) {
  return (
    /bot|crawler|spider|preview|scanner|safelinks|proofpoint|headless|curl|wget/i.test(
      agent,
    ) || /prefetch|preview/i.test(purpose)
  );
}
export function trackingBase() {
  const raw = process.env.HVM_TRACKING_PUBLIC_ORIGIN;
  return raw ? websiteOrigin(raw) + "/api/v1/public/tracking" : null;
}

/** Bounded in-memory abuse budget; only accounting is skipped, never navigation. */
export function recordingBudget() {
  let reset = 0,
    total = 0;
  const counts = new Map<string, number>();
  return (key: string, now = Date.now()) => {
    if (now >= reset) {
      reset = now + 60000;
      total = 0;
      counts.clear();
    }
    if (++total > 3000 || (counts.size >= 1000 && !counts.has(key)))
      return false;
    const count = (counts.get(key) || 0) + 1;
    counts.set(key, count);
    return count <= 120;
  };
}
