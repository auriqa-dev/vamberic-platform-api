import { z } from "zod";
import { logger } from "../../lib/logger";
import {
  reportWindow,
  metricNames,
  parseReport,
  attribution,
  propertyToday,
} from "./reporting";
import type { GoogleConfig } from "../mailbox/google";
export const GA4_SCOPE = "https://www.googleapis.com/auth/analytics.readonly";
export const propertyId = z.string().regex(/^properties\/[0-9]{1,20}$/);
export const ga4Tokens = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
  expiresAt: z.number(),
  scopes: z.array(z.string()),
});
export class Ga4Error extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export function googleAnalytics(
  config: GoogleConfig,
  request: typeof fetch = fetch,
) {
  async function json(url: string, init: RequestInit = {}) {
    let response: Response;
    try {
      response = await request(url, {
        ...init,
        redirect: "error",
        signal: AbortSignal.timeout(12000),
      });
    } catch {
      throw new Ga4Error(
        "PROVIDER_UNAVAILABLE",
        "Google Analytics did not respond. Try again.",
      );
    }
    if (!response.ok)
      throw new Ga4Error(
        response.status === 401 ||
          (response.status === 400 && url.includes("/token"))
          ? "RECONNECT_REQUIRED"
          : response.status === 403
            ? "ACCESS_DENIED"
            : response.status === 429
              ? "QUOTA_EXCEEDED"
              : "PROVIDER_UNAVAILABLE",
        response.status === 401 ||
          (response.status === 400 && url.includes("/token"))
          ? "Google access has expired or been revoked. Connect GA4 again."
          : response.status === 403
            ? "Google Analytics access was denied. Check your property permissions and that HVM’s Analytics APIs are enabled."
            : response.status === 429
              ? "Google Analytics is temporarily limiting requests. Try again later."
              : "Google Analytics could not complete this request. Try again.",
      );
    return response.json();
  }
  async function token(
    body: URLSearchParams,
    previous?: z.infer<typeof ga4Tokens>,
  ) {
    body.set("client_id", config.clientId);
    body.set("client_secret", config.clientSecret);
    const t = z
      .object({
        access_token: z.string(),
        refresh_token: z.string().optional(),
        expires_in: z.number().positive(),
        scope: z.string().optional(),
      })
      .parse(
        await json("https://oauth2.googleapis.com/token", {
          method: "POST",
          body,
        }),
      );
    const scopes = t.scope?.split(" ") ?? previous?.scopes ?? [];
    if (
      !scopes.includes(GA4_SCOPE) ||
      !(t.refresh_token ?? previous?.refreshToken)
    )
      throw new Ga4Error(
        "CONSENT_REQUIRED",
        "Allow read-only Analytics access, then connect again.",
      );
    return ga4Tokens.parse({
      accessToken: t.access_token,
      refreshToken: t.refresh_token ?? previous?.refreshToken,
      expiresAt: Date.now() + t.expires_in * 1000,
      scopes,
    });
  }
  const api = (access: string, url: string, body?: unknown) =>
    json(url, {
      headers: {
        Authorization: `Bearer ${access}`,
        "Content-Type": "application/json",
      },
      ...(body ? { method: "POST", body: JSON.stringify(body) } : {}),
    });
  return {
    authorise(state: string, challenge: string) {
      const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      u.search = new URLSearchParams({
        client_id: config.clientId,
        redirect_uri: config.redirectUri,
        response_type: "code",
        scope: GA4_SCOPE,
        access_type: "offline",
        prompt: "consent select_account",
        state,
        code_challenge: challenge,
        code_challenge_method: "S256",
      }).toString();
      return u.toString();
    },
    exchange: (code: string, verifier: string) =>
      token(
        new URLSearchParams({
          grant_type: "authorization_code",
          code,
          code_verifier: verifier,
          redirect_uri: config.redirectUri,
        }),
      ),
    refresh: (previous: z.infer<typeof ga4Tokens>) =>
      token(
        new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: previous.refreshToken,
        }),
        previous,
      ),
    async properties(access: string, pageToken = "") {
      const query = new URLSearchParams({
        pageSize: "50",
        ...(pageToken ? { pageToken } : {}),
      });
      const result = z
        .object({
          accountSummaries: z
            .array(
              z.object({
                displayName: z.string(),
                propertySummaries: z
                  .array(
                    z.object({ property: propertyId, displayName: z.string() }),
                  )
                  .default([]),
              }),
            )
            .default([]),
          nextPageToken: z.string().optional(),
        })
        .parse(
          await api(
            access,
            `https://analyticsadmin.googleapis.com/v1beta/accountSummaries?${query}`,
          ),
        );
      return {
        properties: result.accountSummaries.flatMap((a) =>
          a.propertySummaries.map((p) => ({
            ...p,
            accountName: a.displayName,
          })),
        ),
        nextPageToken: result.nextPageToken ?? null,
      };
    },
    async report(
      access: string,
      property: string,
      rawWindow: unknown,
      timeZone: string,
      filter?: z.infer<typeof attribution>,
    ) {
      propertyId.parse(property);
      const window = reportWindow.parse(rawWindow);
      if (window.endDate >= propertyToday(timeZone))
        throw new Ga4Error(
          "INVALID_PERIOD",
          "Choose complete days ending before today in the property timezone.",
        );
      const scope = filter ? attribution.parse(filter) : undefined;
      const run = async (dimensions: string[]) => {
        const raw = await api(
            access,
            `https://analyticsdata.googleapis.com/v1beta/${property}:runReport`,
            {
              dateRanges: [window],
              metrics: metricNames.map((name) => ({ name })),
              dimensions: dimensions.map((name) => ({ name })),
              ...(scope
                ? {
                    dimensionFilter: {
                      filter: {
                        fieldName: scope.field,
                        stringFilter: {
                          matchType: "EXACT",
                          value: scope.value,
                          caseSensitive: true,
                        },
                      },
                    },
                  }
                : {}),
              limit: dimensions.length ? "1000" : "1",
              returnPropertyQuota: true,
              ...(dimensions[0] === "date"
                ? { orderBys: [{ dimension: { dimensionName: "date" } }] }
                : dimensions.length
                  ? {
                      orderBys: [
                        { metric: { metricName: "sessions" }, desc: true },
                      ],
                    }
                  : {}),
            },
          );
        try {
          return parseReport(raw, dimensions);
        } catch (e) {
          // Schema paths only: never log response values, credentials or campaign tags.
          logger.warn({
            dimensions,
            issues: e instanceof z.ZodError
              ? e.issues.map((issue) => ({ code: issue.code, path: issue.path }))
              : [{ code: "report_shape" }],
          }, "GA4 report response validation failed");
          throw new Ga4Error("INVALID_REPORT", "Google Analytics returned an unexpected report. Campaign settings are preserved; website metrics are unavailable. Retry after the reporting connection has been checked.");
        }
      };
      // Separate aggregate query: unique users must never be summed across days or channels.
      const [total, daily, sources, campaigns] = await Promise.all([
        run([]),
        run(["date"]),
        run(["sessionSourceMedium"]),
        run(["sessionCampaignId", "sessionCampaignName"]),
      ]);
      const tables = [total, daily, sources, campaigns];
      if (tables.some((t) => t.timeZone && t.timeZone !== timeZone))
        throw new Ga4Error(
          "PROPERTY_CHANGED",
          "The property timezone changed. Test the connection and refresh the report.",
        );
      return {
        window,
        totals: total.rows[0]?.metrics ?? null,
        daily,
        sources,
        campaigns,
        timeZone,
        fetchedAt: new Date().toISOString(),
        warnings: [...new Set(tables.flatMap((t) => t.warnings))],
      };
    },
    async verify(access: string, property: string) {
      propertyId.parse(property);
      const info = z
        .object({
          name: propertyId,
          displayName: z.string().min(1).max(200),
          timeZone: z.string(),
          currencyCode: z.string(),
        })
        .parse(
          await api(
            access,
            `https://analyticsadmin.googleapis.com/v1beta/${property}`,
          ),
        );
      if (info.name !== property)
        throw new Ga4Error(
          "PROPERTY_CHANGED",
          "Google returned a different property. Connect again.",
        );
      // A zero-row report still proves access. Never infer that tracking is installed or traffic is zero.
      const report = z
        .object({ rowCount: z.number().int().nonnegative().default(0) })
        .parse(
          await api(
            access,
            `https://analyticsdata.googleapis.com/v1beta/${property}:runReport`,
            {
              dateRanges: [{ startDate: "7daysAgo", endDate: "yesterday" }],
              metrics: [{ name: "sessions" }],
              limit: "1",
              returnPropertyQuota: true,
            },
          ),
        );
      return { ...info, hasReportRows: report.rowCount > 0 };
    },
  };
}
