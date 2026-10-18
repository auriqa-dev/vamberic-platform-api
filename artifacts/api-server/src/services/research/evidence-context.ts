import type { Db } from "mongodb";
/** Destination generation consumes reviewed evidence; it never treats research as execution permission. */
export async function reviewedResearchContext(
  db: Db,
  w: string,
  brandId: string,
  ids: string[],
) {
  if (!ids.length) return { instructions: "", findings: [] };
  const rows = await db
    .collection("events")
    .find({
      workspaceId: w,
      eventType: "research_finding",
      "payload.brandId": brandId,
      "payload.decision": "accepted",
      "payload.destinations.id": { $in: ids },
    })
    .sort({ updatedAt: -1 })
    .limit(20)
    .toArray();
  const findings = [];
  for (const row of rows) {
    const sources = await db
      .collection("events")
      .find({
        workspaceId: w,
        eventType: "research_evidence",
        id: { $in: row.payload.evidenceIds },
      })
      .toArray();
    findings.push({
      id: row.id,
      statement: row.payload.statement,
      kind: row.payload.kind,
      reviewNote: row.payload.reviewNote,
      reviewedAt: row.updatedAt,
      sources: sources.map((s) => ({
        id: s.id,
        url: s.payload.url,
        title: s.payload.title,
        retrievedAt: s.payload.retrievedAt,
        access: s.payload.access,
        restrictions: s.payload.restrictions ?? [],
        excerpt: s.payload.extract.slice(0, 1500),
      })),
    });
  }
  return {
    instructions:
      "Research findings were reviewed by a human, but may contain assessments rather than proven facts. Preserve source age, restrictions, uncertainty and provenance. Review does not approve publication or execution.",
    findings,
  };
}
