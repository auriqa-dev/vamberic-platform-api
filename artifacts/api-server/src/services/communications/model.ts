import { renderTemplate } from "../email-templates/render";
import { z } from "zod";
import type { EmailRecord } from "../email-content/model";
export const categories = [
  "interested",
  "question",
  "objection",
  "meeting_request",
  "not_interested",
  "unsubscribe",
  "out_of_office",
  "left_organisation",
  "wrong_person",
  "referral",
  "automated",
  "delivery_failure",
  "unclear",
] as const;
export const createRequest = z
  .object({
    requestKey: z.string().uuid(),
    templateId: z.string().default(""),
    replyToId: z.string().default(""),
    draftId: z.string().min(1),
    draftVersion: z.number().int().positive(),
    contactPointId: z.string().default(""),
    testOnly: z.boolean(),
    testRecipient: z.string().email().optional(),
    purpose: z
      .enum(["acquisition", "marketing", "service"])
      .default("marketing"),
  })
  .strict();
export const mutation = z
  .object({
    expectedVersion: z.number().int().positive(),
    operation: z.enum(["approve", "cancel", "archive", "restore", "reconcile"]),
    dueAt: z.string().datetime().optional(),
    responseDueAt: z.string().datetime().optional(),
    reason: z.string().trim().min(1).max(2000),
    legalConfirmed: z.boolean().optional(),
    platformConfirmed: z.boolean().optional(),
    assessments: z
      .array(
        z
          .object({
            policyId: z.string(),
            version: z.number().int().positive(),
            effect: z.enum([
              "permitted",
              "not_applicable",
              "prohibited",
              "deferred",
            ]),
            reason: z.string().trim().min(1).max(1000),
          })
          .strict(),
      )
      .default([]),
  })
  .strict();
export const reviewReply = z
  .object({
    expectedVersion: z.number().int().positive(),
    category: z.enum(categories),
    reason: z.string().trim().min(1).max(2000),
    personId: z.string().optional(),
    returnAt: z.string().datetime().optional(),
    clearRestriction: z.boolean().default(false),
  })
  .strict();
export const pendingStates = [
  "awaiting_review",
  "scheduled",
  "sending",
  "unknown",
];
export function canTransition(status: string, action: string) {
  return action === "approve"
    ? ["awaiting_review", "failed", "blocked"].includes(status)
    : action === "cancel"
      ? ["awaiting_review", "scheduled", "failed", "blocked"].includes(status)
      : action === "archive"
        ? ["cancelled", "accepted", "failed", "blocked"].includes(status)
        : action === "restore"
          ? true
          : action === "reconcile"
            ? ["unknown", "sending"].includes(status)
            : false;
}
export function renderEmail(draft: EmailRecord, testOnly = false) {
  const { subject, text, html } = renderTemplate(
    draft,
    undefined,
    null,
    testOnly,
  );
  return { subject, text, html };
}
/** Conservative triage, never a qualification decision. Quoted history is excluded. */
export function interpretReply(text: string) {
  const fresh = text.split(/\n(?:On .+wrote:|From:|>)/i)[0].slice(0, 8000);
  const rules: [(typeof categories)[number], RegExp][] = [
    [
      "unsubscribe",
      /\b(unsubscribe|remove me from (?:your|the) (?:list|mailing)|do not (?:email|contact) me|stop (?:emailing|contacting) me)\b/i,
    ],
    [
      "left_organisation",
      /\b(no longer (?:works?|employed|with)|has left (?:the|our)|left the (?:company|organisation|organization))\b/i,
    ],
    [
      "delivery_failure",
      /\b(undeliverable|delivery (?:status notification|failed)|address not found)\b/i,
    ],
    [
      "out_of_office",
      /\b(out of (?:the )?office|on (?:annual leave|holiday)|away from (?:the )?office)\b/i,
    ],
    ["not_interested", /\bnot interested\b/i],
    [
      "meeting_request",
      /\b(book|schedule|arrange)\b.{0,35}\b(demo|meeting|call)\b/i,
    ],
    [
      "referral",
      /\b(?:speak to|contact) (?:my|our) (?:colleague|manager|team)\b/i,
    ],
    ["wrong_person", /\b(wrong person|contact my colleague)\b/i],
    ["automated", /\b(automatic reply|automated response|auto.reply)\b/i],
    ["question", /\?/],
    ["interested", /\binterested|tell me more\b/i],
  ];
  const found = rules.find(([, r]) => r.test(fresh));
  return {
    category: found?.[0] ?? "unclear",
    confidence: found ? "rule_match" : "uncertain",
    evidence: fresh.slice(0, 600),
    status: "needs_review",
    reason: found
      ? "Suggested from reply wording; review in context."
      : "Human review required; no reliable classification.",
  };
}
