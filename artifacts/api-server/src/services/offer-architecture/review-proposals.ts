import { z } from "zod";
export const ReviewProposalSchema = z
  .object({
    question: z.string().min(1).max(2000),
    answer: z.string().max(2000),
    basis: z.string().min(1).max(2000),
    kind: z.enum(["supported_information", "assumption", "recommendation"]),
    decision: z.enum(["review", "human_input"]),
    gap: z.string().max(2000),
  })
  .strict();
export const REVIEW_INSTRUCTIONS = `Henry proposes; the user validates. Normally use one to three material questions per stage and answers below 100 words. For each stage prepare concise proposed answers from supplied company, product, buyer context, earlier decisions and research. Return proposals for all questions. Do not ask the user to repeat information already present. Each proposal distinguishes supported_information, assumption or recommendation, explains its basis and uncertainty. A proposal is never approved. For genuinely missing prices, commitments, capabilities or business priorities set decision=human_input, explain why the decision matters in basis, and leave answer empty if no defensible option exists; otherwise propose an explicitly conditional option. No invented evidence or commitments. The gap field must preserve material missing evidence, the affected claim/decision, why it matters, evidence that would resolve it, and whether it is an approval blocker or a future improvement; empty if none. Approval does not resolve evidence gaps. Keep proposals and questions scoped to this offer, never automatically apply sibling-offer decisions.`;
export function proposalGroups(
  proposals: z.infer<typeof ReviewProposalSchema>[],
) {
  return proposals.map((p, i) => ({
    key: `henry_proposal_${i}`,
    name: "Henry’s proposed answer",
    items: [
      p.question,
      p.answer || "No proposal — your decision is needed.",
      p.basis,
      p.kind,
      p.decision,
      p.gap || "No additional evidence gap identified.",
    ],
  }));
}
