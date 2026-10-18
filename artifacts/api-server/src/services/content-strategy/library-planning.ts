import { createHash } from "node:crypto";
import type { ContentRecord } from "./model";
import { assetData } from "./model";
import type { IndexedPage } from "./library-discovery";
import { assetReuseEligibility } from "./execution";

export type ContentRequirement = {
  key: string;
  offerId: string;
  offerRevision: number;
  brandId: string;
  offerName: string;
  audienceIds: string[];
  buyerIds: string[];
  title: string;
  category: "message" | "evidence" | "question";
  priority: "high" | "medium" | "low";
  active: boolean;
  contextHash: string;
  suggestedStage: string;
  suggestedContentTypes: string[];
};
export type OfferPlanningSource = {
  id: string;
  revision: number;
  brandId: string;
  active: boolean;
  name: string;
  audienceIds: string[];
  buyerIds: string[];
  messages: string[];
  evidence: string[];
  questions: string[];
  audienceRevisions?: { id: string; revision: number }[];
  buyerRevisions?: { id: string; revision: number }[];
};
const hash = (v: unknown) =>
  createHash("sha256").update(JSON.stringify(v)).digest("hex");
const words = (s: string) =>
  new Set(
    s
      .toLowerCase()
      .match(/[a-z]{4,}/g)
      ?.filter(
        (w) =>
          ![
            "this",
            "that",
            "with",
            "from",
            "your",
            "their",
            "have",
            "will",
            "about",
            "content",
            "offer",
          ].includes(w),
      ) ?? [],
  );
export function similarity(a: string, b: string) {
  const x = words(a),
    y = words(b);
  if (!x.size || !y.size) return 0;
  return [...x].filter((w) => y.has(w)).length / Math.min(x.size, y.size);
}
export function requirementsForOffers(
  offers: OfferPlanningSource[],
): ContentRequirement[] {
  return offers.flatMap((o) =>
    (
      [
        ["message", o.messages],
        ["evidence", o.evidence],
        ["question", o.questions],
      ] as const
    ).flatMap(([category, values]) =>
      [...new Set(values.filter(Boolean))].map((title) => ({
        key: hash([o.id, category, title]),
        offerId: o.id,
        offerRevision: o.revision,
        brandId: o.brandId,
        offerName: o.name,
        audienceIds: o.audienceIds,
        buyerIds: o.buyerIds,
        title,
        category,
        priority:
          category === "evidence" ? ("high" as const) : ("medium" as const),
        active: o.active,
        contextHash: hash(o),
        suggestedStage:
          category === "message"
            ? "Awareness"
            : category === "question"
              ? "Consideration"
              : "Decision",
        suggestedContentTypes:
          category === "message"
            ? ["Article", "Overview"]
            : category === "question"
              ? ["Guide", "FAQ"]
              : ["Research", "Case study"],
      })),
    ),
  );
}
/** Deterministic first pass, deliberately labelled as a relevance suggestion, never an approval. */
export function assessRequirement(
  requirement: ContentRequirement,
  records: ContentRecord[],
  pages: IndexedPage[],
) {
  const assets = records
    .filter(
      (r) =>
        r.kind === "asset" &&
        r.status !== "removed" &&
        !r.data.archived &&
        (r.data.scope as { brandId?: string })?.brandId === requirement.brandId,
    )
    .map((r) => {
      const data = assetData.parse(r.data),
        association = data.associations.find(
          (a) =>
            a.offerId === requirement.offerId &&
            a.requirement === requirement.title,
        ),
        excluded = association?.decision === "excluded";
      const current =
        association?.offerRevision === requirement.offerRevision &&
        association.contextHash === requirement.contextHash &&
        association.contentHash === (data.contentHash || r.fingerprint);
      const score = excluded
        ? 0
        : association && current
          ? association.relevance
          : similarity(
              requirement.title,
              [
                data.title,
                data.description,
                data.text,
                ...data.topics,
                ...data.evidence,
              ].join(" "),
            );
      const approved =
        association?.decision === "accepted" &&
        current &&
        assetReuseEligibility(r, records).eligible;
      return {
        id: r.id,
        title: data.title,
        version: r.version,
        score,
        approved,
        associationCurrent: !!current,
        reason: approved
          ? "Approved asset and current accepted offer association; recorded use restrictions still apply."
          : "Possible relevance from the content and requirement wording. Review fit, evidence and usage rights.",
        contentHash: data.contentHash || r.fingerprint,
        contextHash: requirement.contextHash,
      };
    })
    .filter((a) => a.score >= 0.35)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);
  const discovered = pages
    .filter((p) => p.ingestion !== "imported")
    .map((p) => ({
      url: p.url,
      title: p.title,
      score: similarity(
        requirement.title,
        `${p.title} ${p.description} ${p.url}`,
      ),
      reason:
        p.status === "inspected"
          ? "Metadata suggests a match; import and review the actual content."
          : "URL-only candidate; relevance remains uncertain until inspected.",
    }))
    .filter((p) => p.score >= 0.35)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);
  return {
    requirement,
    assets,
    discovered,
    status: assets.some((a) => a.approved)
      ? "available"
      : assets.length
        ? "needs_improvement"
        : discovered.length
          ? "discovered_not_imported"
          : "missing",
    assessmentHash: hash([
      requirement.contextHash,
      assets.map((a) => [a.id, a.version, a.score]),
      discovered.map((p) => [p.url, p.score]),
    ]),
  };
}
export function sharedRequirements(requirements: ContentRequirement[]) {
  const groups: ContentRequirement[][] = [];
  for (const r of requirements.filter((r) => r.active)) {
    const group = groups.find(
      (g) =>
        g[0]!.brandId === r.brandId &&
        g[0]!.category === r.category &&
        similarity(g[0]!.title, r.title) >= 0.8,
    );
    if (group) group.push(r);
    else groups.push([r]);
  }
  return groups
    .filter((g) => new Set(g.map((r) => r.offerId)).size > 1)
    .map((g) => ({
      title: g[0]!.title,
      requirements: g.map((r) => r.key),
      offerIds: [...new Set(g.map((r) => r.offerId))],
      reason:
        "Similar needs across offers. Consider one shared asset; retain offer-specific claims and evidence.",
    }));
}

/** Review cues only: they never resolve a conflict or reorder approved strategy priorities. */
export function planningAttention(requirements: ContentRequirement[]) {
  const active = requirements.filter((r) => r.active),
    result: {
      kind: string;
      title: string;
      offerIds: string[];
      reason: string;
    }[] = [];
  for (let i = 0; i < active.length; i++)
    for (let j = i + 1; j < active.length; j++) {
      const a = active[i]!,
        b = active[j]!;
      if (a.offerId === b.offerId || a.brandId !== b.brandId) continue;
      const overlap = a.audienceIds.some((id) => b.audienceIds.includes(id));
      if (
        a.category === "message" &&
        b.category === "message" &&
        similarity(a.title, b.title) >= 0.5 &&
        /\b(no|not|never|without)\b/i.test(a.title) !==
          /\b(no|not|never|without)\b/i.test(b.title)
      )
        result.push({
          kind: "message_review",
          title: "Check apparently different claims",
          offerIds: [a.offerId, b.offerId],
          reason: `${a.title} / ${b.title}. Similar wording differs in its exclusions; check whether the contexts explain the difference.`,
        });
      if (overlap && a.priority === "high" && b.priority === "high")
        result.push({
          kind: "priority_review",
          title: "Shared audience with competing evidence needs",
          offerIds: [a.offerId, b.offerId],
          reason:
            "Use the approved commercial priorities to choose production order. Consider shared evidence before commissioning separate assets.",
        });
    }
  return [
    ...new Map(
      result.map((r) => [JSON.stringify([r.kind, [...r.offerIds].sort()]), r]),
    ).values(),
  ];
}
