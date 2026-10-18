// Immutable execution definition. New business rules require a new version;
// Empress manages the versioned catalogue entry, publication and retirement.
const stages = [
  {
    key: "customer_context",
    name: "Customer Context",
    purpose:
      "Understand the customer situation and buying group for this specific enterprise or consultative offer.",
    requiredContext: [
      "Approved company and Product/Service Understanding.",
      "Relevant approved ICPs, buyer profiles, existing offer decisions and available customer research; do not require records that do not exist.",
    ],
    analysisRequirements: [
      "Identify operating context, strategic objectives, buying situation, stakeholders and constraints.",
      "Separate approved facts, evidence-led interpretations and market hypotheses. Reuse earlier decisions and distinguish sibling offers.",
    ],
    expectedOutputs: [
      {
        key: "customer_context",
        description:
          "Customer situation, buying group, objectives, constraints and referenced context.",
      },
      {
        key: "context_gaps",
        description:
          "Material unknowns with specific human decisions only where needed.",
      },
    ],
    validationDecisions: [
      "Confirm the intended customer, buying situation and scope; correct unsupported assumptions.",
    ],
    completionCriteria: [
      "A coherent customer context is recorded with source references and explicit review rationale.",
      "Material scope uncertainties are resolved or retained as named blockers.",
    ],
  },
  {
    key: "problems_priorities",
    name: "Problems and Priorities",
    purpose: "Identify and prioritise the customer problems worth solving.",
    requiredContext: [
      "Reviewed customer context, approved ICP/buyer evidence and relevant research or customer observations.",
    ],
    analysisRequirements: [
      "Distinguish symptoms, causes, urgency and the consequences of doing nothing.",
      "Rank problems by relevance and business significance without inventing financial impact or prevalence.",
    ],
    expectedOutputs: [
      {
        key: "problem_priorities",
        description:
          "Ranked problems, affected stakeholders, consequences, urgency and basis for priority.",
      },
    ],
    validationDecisions: [
      "Accept or revise priorities; clarify competing commercial objectives when evidence cannot decide.",
    ],
    completionCriteria: [
      "Priority problems and the rationale are explicitly reviewed.",
      "Unverified severity or urgency remains labelled as an assumption.",
    ],
  },
  {
    key: "desired_outcomes",
    name: "Desired Outcomes",
    purpose: "Connect the offer to meaningful customer business outcomes.",
    requiredContext: [
      "Prioritised problems, customer objectives and existing product capabilities and outcome evidence.",
    ],
    analysisRequirements: [
      "Describe functional, operational and commercial outcomes, success measures, dependencies and time horizons.",
      "Distinguish desired targets from proven results or contractual promises; avoid invented ROI.",
    ],
    expectedOutputs: [
      {
        key: "outcome_map",
        description:
          "Problem-to-outcome mapping, success indicators, measurement approach and dependencies.",
      },
    ],
    validationDecisions: [
      "Confirm which outcomes matter and whether any proposed targets are acceptable.",
    ],
    completionCriteria: [
      "Outcomes are linked to priorities and feasible capabilities, with explicit review rationale.",
      "Unsubstantiated numerical promises are removed, qualified or recorded as blockers.",
    ],
  },
  {
    key: "alternatives_competition",
    name: "Alternatives and Competition",
    purpose:
      "Understand the credible alternatives against which the customer evaluates the offer.",
    requiredContext: [
      "Approved offer and product facts, retrieved competitor/substitute research and existing comparison evidence.",
    ],
    analysisRequirements: [
      "Compare relevant competitors, internal delivery and doing nothing using the customer's decision criteria.",
      "Retain URLs, observation dates and limitations; separate sourced competitor facts from suggestions for research.",
    ],
    expectedOutputs: [
      {
        key: "alternative_comparison",
        description:
          "Structured competitiveAnalysis findings, sources, relevance, positioning, strengths and gaps.",
      },
      {
        key: "choice_criteria",
        description:
          "Customer decision criteria and trade-offs across alternatives.",
      },
    ],
    validationDecisions: [
      "Confirm comparison scope and relevance; reject unsupported competitor or superiority claims.",
    ],
    completionCriteria: [
      "Competitive analysis is recorded with provenance and material limitations.",
      "The reviewed differentiation basis reflects actual customer alternatives.",
    ],
  },
  {
    key: "differentiated_value",
    name: "Differentiated Value",
    purpose:
      "Build a distinctive value proposition grounded in what the business can credibly deliver.",
    requiredContext: [
      "Reviewed priorities, outcomes, alternatives and approved product capabilities.",
    ],
    analysisRequirements: [
      "Connect capability to mechanism, customer benefit and business outcome.",
      "Test relevance and distinctiveness without claiming uniqueness or superiority beyond the evidence.",
    ],
    expectedOutputs: [
      {
        key: "value_map",
        description:
          "Capability-to-benefit-to-outcome mapping with differentiators and proof requirements.",
      },
      {
        key: "value_proposition",
        description:
          "Concise proposed value proposition for the chosen customer and buying situation.",
      },
    ],
    validationDecisions: [
      "Accept, edit or challenge the proposed differentiation and value proposition.",
    ],
    completionCriteria: [
      "The proposition connects priority problems to credible outcomes and meaningful alternatives.",
      "Human review preserves assumptions and unresolved differentiation evidence gaps.",
    ],
  },
  {
    key: "evidence_credibility",
    name: "Evidence and Credibility",
    purpose:
      "Establish what supports the proposition and what still needs substantiation.",
    requiredContext: [
      "Existing research, approved claims, case studies, demonstrations and the proposed value map.",
    ],
    analysisRequirements: [
      "Map each material claim to available evidence, limitations and provenance.",
      "Record missing evidence, affected claim/decision, importance, what would resolve it, and blocker versus future improvement. Acceptance is not proof.",
    ],
    expectedOutputs: [
      {
        key: "claim_evidence_map",
        description:
          "Claims linked to source references, evidence strength and permitted qualifications.",
      },
      {
        key: "evidence_gaps",
        description:
          "Persistent structured working groups/evidence/assumptions identifying blockers and future evidence opportunities for Content Strategy.",
      },
    ],
    validationDecisions: [
      "Decide which claims can be made, qualified or omitted and which commitments must remain blocked.",
    ],
    completionCriteria: [
      "Material claims are supported or explicitly qualified/removed.",
      "Evidence gaps remain attached to the offer after approval; no fabricated proof.",
    ],
  },
  {
    key: "commercial_proposition",
    name: "Commercial Proposition",
    purpose:
      "Turn differentiated value into a credible commercial offer and next step.",
    requiredContext: [
      "Reviewed value proposition, evidence, approved commercial constraints, existing terms and delivery capabilities.",
    ],
    analysisRequirements: [
      "Propose scope, deliverables, inclusions/exclusions, responsibilities, dependencies, pricing approach, terms and next action.",
      "Preserve existing commercial decisions unless changes are explicitly requested. Ask humans for unknown prices, capacity, service commitments and risk tolerance.",
    ],
    expectedOutputs: [
      {
        key: "commercial_offer",
        description:
          "Offer definition: proposition, packaging, descriptive pricing/terms, eligibility, proof, risk qualifications and primary/secondary CTA.",
      },
      {
        key: "commercial_decisions",
        description:
          "Consequential commitments requiring explicit human decision.",
      },
    ],
    validationDecisions: [
      "Confirm scope, delivery obligations, pricing/terms and permitted claims; generation does not authorise billing or execution.",
    ],
    completionCriteria: [
      "The commercial proposition is coherent and explicitly reviewed.",
      "Unresolved consequential commitments are blockers; no invented guarantees, prices or capabilities.",
    ],
  },
  {
    key: "validation_approval",
    name: "Validation and Approval",
    purpose:
      "Review the complete proposition, preserve decision lineage and obtain explicit offer approval.",
    requiredContext: [
      "All preceding stage outputs, human edits, accepted decisions, source revisions and unresolved evidence gaps.",
    ],
    analysisRequirements: [
      "Check coherence across customer priorities, outcomes, differentiated value, proof and commercial terms.",
      "Summarise decisions requiring attention separately from future improvements. Preserve independent offers, source provenance and prior human answers.",
    ],
    expectedOutputs: [
      {
        key: "approval_summary",
        description:
          "Offer summary, reviewed decisions, remaining blockers and future improvements.",
      },
      {
        key: "decision_lineage",
        description:
          "Version-pinned methodology, source revisions, human decisions and evidence available to downstream consumers.",
      },
    ],
    validationDecisions: [
      "Explicitly accept or revise the stage review, then separately approve the offer through the existing authorised approval action.",
    ],
    completionCriteria: [
      "All stages are reviewed and existing approval prerequisites pass.",
      "No unresolved unsafe commitment is treated as approved; stage completion alone does not approve the offer.",
      "Evidence gaps and lineage survive in the immutable approved revision.",
    ],
  },
];
export const valuePropositionDevelopment = {
  id: "offermethodology_00000000000000000000000002",
  key: "value_proposition_development",
  name: "Value Proposition Development",
  description:
    "Develop differentiated, evidence-based value propositions for enterprise, B2B and complex consultative offers.",
  version: 1,
  status: "active",
  introduction:
    "Value Proposition Development v1.0 connects customer priorities and desired business outcomes to differentiated value, credible evidence and an explicitly approved commercial offer. Henry proposes; the user accepts, edits or discusses.",
  conceptualModel: {
    expression:
      "Customer priority → Desired outcome → Differentiated value → Credible evidence → Commercial proposition",
    dimensions: [
      {
        key: "customer_context",
        name: "Customer relevance",
        explanation: "Start with the customer's context and priorities.",
      },
      {
        key: "differentiated_value",
        name: "Differentiated value",
        explanation:
          "Connect credible capabilities to meaningful outcomes and alternatives.",
      },
      {
        key: "evidence_credibility",
        name: "Credibility",
        explanation: "Substantiate material claims and retain evidence gaps.",
      },
      {
        key: "commercial_proposition",
        name: "Commercial fit",
        explanation: "Make an achievable, explicitly reviewed offer.",
      },
    ],
  },
  stages: stages.map((stage, order) => ({
    ...stage,
    order,
    description: stage.purpose,
    guidance: [
      ...stage.analysisRequirements,
      ...stage.validationDecisions,
      ...stage.completionCriteria,
    ],
    workingDataSchema: "offer_stage_v1",
    completionRequirements:
      stage.key === "alternatives_competition"
        ? ["decision_rationale", "competitive_analysis"]
        : ["decision_rationale"],
  })),
  createdAt: new Date("2026-10-10T00:00:00Z"),
  updatedAt: new Date("2026-10-10T00:00:00Z"),
  source: { system: "hvm" },
};
