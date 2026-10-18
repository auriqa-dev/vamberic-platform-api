import { z } from "zod";

// Contract: https://docs.lusha.com/openapi.json, retrieved 2026-10-14.
// Keep search separate from reveal: enrich explicitly disables third-party waterfall.
export const lushaIdentity = z
  .object({
    firstName: z.string().trim().min(1).max(100),
    lastName: z.string().trim().min(1).max(100),
    companyDomain: z
      .string()
      .trim()
      .min(3)
      .max(253)
      .regex(/^[a-z0-9.-]+$/i),
  })
  .strict();
export const lushaContact = z.object({
  id: z.string().min(1),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  company: z
    .object({ domain: z.string().optional(), name: z.string().optional() })
    .optional(),
  jobTitle: z.object({ title: z.string().optional() }).optional(),
  emails: z
    .array(
      z.object({
        email: z.string().email(),
        type: z.string(),
        confidence: z.string().nullable().optional(),
        updateDate: z.string().optional(),
        dataSource: z.string().optional(),
      }),
    )
    .default([]),
  socialLinks: z.object({ linkedin: z.string().optional() }).optional(),
  error: z.unknown().optional(),
});
const response = z.object({
  requestId: z.string().optional(),
  results: z.array(lushaContact),
  billing: z
    .object({ creditsCharged: z.number().int().nonnegative().optional() })
    .optional(),
});
export const lushaUsage = z.object({
  credits: z
    .object({
      total: z.number().nonnegative(),
      used: z.number().nonnegative(),
      remaining: z.number().nonnegative(),
    })
    .optional(),
});
export class LushaFailure extends Error {
  constructor(
    readonly code:
      | "invalid_credentials"
      | "not_permitted"
      | "no_credits"
      | "rate_limited"
      | "outcome_unknown"
      | "invalid_response",
    readonly chargeUnknown: boolean,
  ) {
    super(code);
  }
}
export function acceptedLushaEmail(contact: z.infer<typeof lushaContact>) {
  if (contact.error) return null;
  return (
    contact.emails.find(
      (e) =>
        e.type === "work" &&
        e.confidence === "A+" &&
        (!e.dataSource || e.dataSource === "lusha"),
    ) ?? null
  );
}
export function createLushaProvider(request: typeof fetch = fetch) {
  async function call(key: string, path: string, body?: unknown) {
    let r: Response;
    try {
      r = await request(`https://api.lusha.com/v3/${path}`, {
        method: body ? "POST" : "GET",
        headers: {
          api_key: key,
          Accept: "application/json",
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(20000),
        redirect: "error",
      });
    } catch {
      throw new LushaFailure("outcome_unknown", Boolean(body));
    }
    if (!r.ok) {
      await r.body?.cancel();
      const code =
        r.status === 401
          ? "invalid_credentials"
          : r.status === 402
            ? "no_credits"
            : [403, 451].includes(r.status)
              ? "not_permitted"
              : r.status === 429
                ? "rate_limited"
                : "outcome_unknown";
      throw new LushaFailure(
        code,
        Boolean(body) && ![400, 401, 402, 403, 429, 451].includes(r.status),
      );
    }
    // Never log or persist the raw provider response. Bound transport before parsing.
    const reader = r.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    if (!reader) throw new LushaFailure("invalid_response", Boolean(body));
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.length;
      if (size > 2_000_000) {
        await reader.cancel();
        throw new LushaFailure("invalid_response", Boolean(body));
      }
      chunks.push(next.value);
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
    } catch {
      throw new LushaFailure("invalid_response", Boolean(body));
    }
  }
  async function results(key: string, path: string, body: unknown) {
    const raw = await call(key, path, body);
    const parsed = response.safeParse(raw);
    if (!parsed.success) throw new LushaFailure("invalid_response", true);
    return {
      contacts: parsed.data.results,
      creditsCharged: parsed.data.billing?.creditsCharged ?? null,
      requestId: parsed.data.requestId ?? null,
    };
  }
  return {
    async usage(key: string) {
      const p = lushaUsage.safeParse(await call(key, "account/usage"));
      if (!p.success) throw new LushaFailure("invalid_response", false);
      return p.data;
    },
    search(key: string, identity: z.infer<typeof lushaIdentity>) {
      return results(key, "contacts/search", {
        contacts: [lushaIdentity.parse(identity)],
        options: { includePartialProfiles: false },
      });
    },
    enrich(key: string, id: string) {
      return results(key, "contacts/enrich", {
        ids: [z.string().min(1).max(200).parse(id)],
        reveal: ["emails"],
        waterfallEnabled: false,
      });
    },
    supplement(key: string, domain: string, roles: string[]) {
      return results(key, "contacts/prospecting", {
        pagination: { page: 0, size: 20 },
        filters: {
          companies: {
            include: {
              domains: [lushaIdentity.shape.companyDomain.parse(domain)],
            },
          },
          contacts: {
            include: {
              jobTitles: z
                .array(z.string().min(1).max(200))
                .min(1)
                .max(20)
                .parse(roles),
            },
          },
        },
        options: { includePartialProfiles: false, excludeDnc: true },
      });
    },
  };
}
export type LushaProvider = ReturnType<typeof createLushaProvider>;
