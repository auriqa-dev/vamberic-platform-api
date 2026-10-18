import { z } from "zod";
export const calendarDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => {
    const d = new Date(`${v}T00:00:00Z`);
    return Number.isFinite(+d) && d.toISOString().slice(0, 10) === v;
  }, "Use a valid calendar date.");
export const reportWindow = z
  .object({ startDate: calendarDate, endDate: calendarDate })
  .strict()
  .refine(
    (v) =>
      v.startDate <= v.endDate &&
      (+new Date(v.endDate) - +new Date(v.startDate)) / 86400000 < 366,
    "Choose an ordered period of up to 366 days.",
  );
export const metricNames = [
  "sessions",
  "totalUsers",
  "newUsers",
  "screenPageViews",
  "engagedSessions",
  "keyEvents",
] as const;
export const metricValues = z.object({
  sessions: z.number().nonnegative(),
  totalUsers: z.number().nonnegative(),
  newUsers: z.number().nonnegative(),
  screenPageViews: z.number().nonnegative(),
  engagedSessions: z.number().nonnegative(),
  keyEvents: z.number().nonnegative(),
});
export const attribution = z
  .object({
    field: z.enum(["sessionCampaignId", "sessionCampaignName"]),
    value: z.string().trim().min(1).max(200),
  })
  .strict()
  .refine(
    (v) =>
      !["(not set)", "(direct)", "(organic)", "(referral)"].includes(v.value),
    "Select a specific tagged campaign.",
  );
export const reportTable = z.object({
  rows: z.array(
    z.object({ dimensions: z.array(z.string()), metrics: metricValues }),
  ),
  rowCount: z.number(),
  truncated: z.boolean(),
  warnings: z.array(z.string()),
});
export const trafficReport = z.object({
  window: reportWindow,
  totals: metricValues.nullable(),
  daily: reportTable,
  sources: reportTable,
  campaigns: reportTable,
  warnings: z.array(z.string()),
  fetchedAt: z.string(),
  timeZone: z.string(),
});
export function propertyToday(timeZone: string, now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  return ["year", "month", "day"]
    .map((t) => parts.find((p) => p.type === t)!.value)
    .join("-");
}
export function defaultWindow(timeZone: string, now = new Date()) {
  const today = +new Date(propertyToday(timeZone, now));
  return {
    startDate: new Date(today - 28 * 86400000).toISOString().slice(0, 10),
    endDate: new Date(today - 86400000).toISOString().slice(0, 10),
  };
}
export function parseReport(raw: unknown, dimensions: string[]) {
  const r = z
    .object({
      dimensionHeaders: z.array(z.object({ name: z.string() })).default([]),
      metricHeaders: z.array(z.object({ name: z.string() })).default([]),
      kind: z.string().optional(),
      rows: z
        .array(
          z.object({
            dimensionValues: z
              .array(z.object({ value: z.string() }))
              .default([]),
            metricValues: z.array(z.object({ value: z.string() })),
          }),
        )
        .default([]),
      rowCount: z.number().int().nonnegative().default(0),
      metadata: z
        .object({
          subjectToThresholding: z.boolean().optional(),
          dataLossFromOtherRow: z.boolean().optional(),
          samplingMetadatas: z.array(z.unknown()).optional(),
          schemaRestrictionResponse: z
            .object({
              activeMetricRestrictions: z.array(z.unknown()).optional(),
            })
            .optional(),
          timeZone: z.string().optional(),
        })
        .optional(),
    })
    .parse(raw);
  const headerlessEmpty =
    r.metricHeaders.length === 0 &&
    r.dimensionHeaders.length === 0 &&
    r.rows.length === 0 &&
    r.rowCount === 0 &&
    r.kind === "analyticsData#runReport" &&
    Boolean(r.metadata?.timeZone);
  if (
    !headerlessEmpty &&
    (JSON.stringify(r.dimensionHeaders.map((h) => h.name)) !==
      JSON.stringify(dimensions) ||
      JSON.stringify(r.metricHeaders.map((h) => h.name)) !==
        JSON.stringify(metricNames))
  )
    throw new Error("Unexpected Analytics report columns");
  const rows = r.rows.map((row) => {
    if (
      row.dimensionValues.length !== dimensions.length ||
      row.metricValues.length !== metricNames.length
    )
      throw new Error("Incomplete Analytics report row");
    const values = row.metricValues.map((v) =>
      v.value.trim() === "" ? NaN : Number(v.value),
    );
    if (values.some((v) => !Number.isFinite(v) || v < 0))
      throw new Error("Invalid Analytics metric");
    return {
      dimensions: row.dimensionValues.map((v) => v.value),
      metrics: metricValues.parse(
        Object.fromEntries(metricNames.map((name, i) => [name, values[i]])),
      ),
    };
  });
  const warnings: string[] = [];
  if (headerlessEmpty)
    warnings.push(
      "Google returned no report rows for this selection; missing data is not zero.",
    );
  if (r.metadata?.subjectToThresholding)
    warnings.push(
      "Google applied privacy thresholding; some data may be withheld.",
    );
  if (r.metadata?.dataLossFromOtherRow)
    warnings.push("Google grouped high-cardinality data into an other row.");
  if (r.metadata?.samplingMetadatas?.length)
    warnings.push("Google returned sampled data.");
  if (r.metadata?.schemaRestrictionResponse?.activeMetricRestrictions?.length)
    throw new Error("Google restricted requested metrics");
  if (r.rowCount > rows.length)
    warnings.push("Breakdown is truncated; totals are queried separately.");
  return {
    rows,
    rowCount: r.rowCount,
    truncated: r.rowCount > rows.length,
    warnings,
    timeZone: r.metadata?.timeZone,
  };
}
