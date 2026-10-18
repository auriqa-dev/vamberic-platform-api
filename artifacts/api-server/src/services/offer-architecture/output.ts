import { createHash } from "node:crypto";
import type { Db, ClientSession, Document } from "mongodb";
import { EventSchema, generatePlatformId } from "../../domain";
import { assetData, record } from "../content-strategy/model";
import { requireLibrarySchema } from "../content-strategy/library-text";

const hash = (v: unknown) =>
  createHash("sha256").update(JSON.stringify(v)).digest("hex");
const label = (s: string) =>
  s.replace(/([a-z])([A-Z])/g, "$1 $2").replaceAll("_", " ");
function prose(value: unknown): string {
  if (value == null || value === "") return "Not specified";
  if (Array.isArray(value))
    return value.length ? value.map(prose).join("\n") : "Not specified";
  if (
    typeof value === "object" &&
    "amountMinor" in value &&
    "currency" in value
  ) {
    const money = value as { amountMinor: number; currency: string };
    try {
      const format = new Intl.NumberFormat("en-GB", {
        style: "currency",
        currency: money.currency,
      });
      const digits = format.resolvedOptions().maximumFractionDigits ?? 2;
      return format.format(money.amountMinor / 10 ** digits);
    } catch {
      return "Price requires review";
    }
  }
  if (typeof value === "object")
    return Object.entries(value)
      .filter(([k]) => !/Ids?$/.test(k))
      .map(([k, v]) => `${label(k)}: ${prose(v)}`)
      .join("\n");
  return String(value);
}
export function offerOutput(offer: Document, design: Document | null) {
  const d = offer.definition;
  const sections = [
    ["Value proposition", d.valueProposition],
    ["Offer", d.headlineProposition],
    ["Customer promise", d.promise],
    ["Differentiation", d.differentiators],
    ["Alternatives and positioning", d.competitivePositioning],
    ["What the customer receives", d.components],
    ["Customer responsibilities", d.customerCommitments],
    ["Risk reduction", d.riskReduction],
    ["Why choose this offer", d.whyChooseThisOffer],
    ["Exclusions", d.exclusions],
    ["Pricing and terms", d.commercialTerms],
    ["Evidence", d.proofPoints],
    ["Evidence still needed", d.evidenceRequirements],
    ["Supportable claims", d.supportableClaims],
    ["Next step", d.primaryCallToAction],
    ["Desired conversion outcome", d.conversionOutcome],
    ["Meaningful intermediate outcomes", d.intermediateOutcomes],
    [
      "Essential qualification criteria and supporting evidence",
      d.qualificationCriteria,
    ],
    ["Desirable qualification information", d.desirableQualification],
    ["Information that may remain unknown", d.acceptableUnknowns],
    ["Qualification disqualifiers", d.qualificationDisqualifiers],
    ["When a person should review", d.humanReviewTriggers],
    ["Ready for a useful sales conversation when", d.salesReadiness],
    ["Handover person or team", d.handoverRecipient],
    ["Information to include in a handover", d.handoverRequirements],
    ["Next step after handover", d.afterHandover],
    ["Booking page URL", d.bookingUrl],
    ["Meeting purpose", d.meetingPurpose],
  ].map(([title, value]) => ({ title: String(title), text: prose(value) }));
  const decisions = (design?.work?.stages ?? []).map((s: Document) => ({
    title: label(s.stageKey),
    text: [
      `${s.status === "completed" ? "Reviewed" : "Still in review"}`,
      ...s.userInputs.map((a: Document) => `${a.question}\n${a.answer}`),
      ...s.notes,
      ...(s.evidence ?? []).map((e: Document) => `Source: ${e.reference}`),
      ...s.unknowns
        .filter(
          (q: string) => !s.userInputs.some((a: Document) => a.question === q),
        )
        .map((q: string) => `Unresolved: ${q}`),
    ].join("\n\n"),
  }));
  return {
    sections,
    decisions,
    text: `${d.name}\n${offer.status} · version ${offer.revision}\n\n${[...sections, ...decisions].map((s) => `${s.title}\n${s.text}`).join("\n\n")}`,
    fingerprint: hash([
      offer.definition,
      offer.revision,
      offer.status,
      design?.work,
      design?.methodologyId,
      design?.methodologyVersion,
    ]),
  };
}
export async function outputAsset(
  db: Db,
  w: string,
  id: string,
  session?: ClientSession,
) {
  return (
    await db
      .collection("events")
      .find(
        {
          workspaceId: w,
          eventType: "content_strategy_record",
          "payload.record.data.sourceType": "offer_output",
          "payload.record.data.offerOutput.offerId": id,
        },
        { session },
      )
      .sort({ createdAt: -1, id: -1 })
      .limit(1)
      .toArray()
  )[0];
}
export async function registerOfferOutput(
  db: Db,
  session: ClientSession,
  w: string,
  offer: Document,
  design: Document,
  actor: Document,
  now: Date,
  onlyExisting = false,
) {
  const previous = (await outputAsset(db, w, offer.id, session))?.payload
    .record;
  if (onlyExisting && (!previous || previous.status === "removed")) return;
  const output = offerOutput(offer, design);
  if (
    previous?.data.offerOutput.fingerprint === output.fingerprint &&
    previous.status !== "removed"
  )
    return previous;
  const product = await db
    .collection("offerings")
    .findOne({ workspaceId: w, id: offer.offeringId }, { session });
  if (!product) throw new Error("Offer product unavailable");
  const id = previous?.id ?? generatePlatformId("event");
  await requireLibrarySchema(db, session);
  const textId = hash([w, id, output.text]);
  if (
    !(await db
      .collection("library_text")
      .findOne({ id: textId, workspaceId: w, assetId: id }, { session }))
  )
    await db.collection("library_text").insertOne(
      {
        id: textId,
        workspaceId: w,
        assetId: id,
        text: output.text,
        createdAt: now,
      },
      { session },
    );
  const data = assetData.parse({
    title: offer.definition.name,
    classification: "unclassified",
    assetType: "Offer summary",
    channel: "",
    url: "",
    text: output.text.slice(0, 5000),
    contentTextId: textId,
    description: `${offer.status === "approved" ? "Approved offer" : "Draft offer"} version ${offer.revision}. Managed in Offer Architecture; not approved for distribution.`,
    sourceDocumentId: "",
    sourceAssetIds: [],
    scope: {
      brandId: product.brandId,
      products: [
        {
          id: product.id,
          revision: product.approvedRevision || product.revision,
        },
      ],
      offers: [],
      audiences: [],
    },
    topics: [],
    buyerStages: [],
    claims: [],
    evidence: [],
    gaps: [],
    reuse: [],
    restrictions: [
      "Internal offer reference only. Publication and distribution require separate approval.",
    ],
    usageRights: "restricted",
    visibility: "private",
    analysisStatus: "needs_review",
    sourceType: "offer_output",
    language: "en-GB",
    offerOutput: {
      offerId: offer.id,
      offerRevision: offer.revision,
      offerStatus: offer.status,
      designId: design.id,
      designUpdatedAt: design.updatedAt.toISOString(),
      methodologyId: design.methodologyId,
      methodologyVersion: design.methodologyVersion,
      fingerprint: output.fingerprint,
    },
  });
  const eventId = generatePlatformId("event");
  const next = record.parse({
    id,
    version: (previous?.version ?? 0) + 1,
    kind: "asset",
    status: offer.status === "approved" ? "approved" : "draft",
    data,
    updatedAt: now.toISOString(),
    fingerprint: hash(data),
    evidenceEventId: eventId,
    sourceVersions: [],
  });
  await db.collection("events").insertOne(
    EventSchema.parse({
      id: eventId,
      workspaceId: w,
      eventType: "content_strategy_record",
      occurredAt: now,
      createdAt: now,
      updatedAt: now,
      createdBy: actor,
      updatedBy: actor,
      source: { system: "offer_architecture" },
      payload: { record: next },
    }),
    { session },
  );
  return next;
}
