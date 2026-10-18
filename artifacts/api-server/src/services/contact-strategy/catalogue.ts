/** Agreed catalogue: user specification supplied 2026-10-09. No client data or execution grants. */
export type StrategyTemplate = Readonly<{
  id: string;
  version: number;
  key: string;
  category: string;
  name: string;
  description: string;
  type: string;
  configuration: readonly string[];
  activationRecommendation: "review";
  approvalRequired: boolean;
}>;
const catalogue: readonly StrategyTemplate[] = [
  {
    id: "CS-001",
    version: 1,
    key: "cs_001",
    category: "Customer lifecycle management",
    name: "Customers don't receive acquisition marketing",
    description:
      "Existing customers should not receive new-customer acquisition campaigns for products they already own. Allow relevant cross-sell and upsell activity where appropriate.",
    type: "prohibition",
    configuration: ["Applicability and exceptions"],
    activationRecommendation: "review",
    approvalRequired: true,
  },
  {
    id: "CS-002",
    version: 1,
    key: "cs_002",
    category: "Customer lifecycle management",
    name: "Prospects don't receive customer communications",
    description:
      "Customer-specific communications must be restricted to contacts with an appropriate customer relationship or entitlement.",
    type: "prohibition",
    configuration: ["Applicability and exceptions"],
    activationRecommendation: "review",
    approvalRequired: true,
  },
  {
    id: "CS-003",
    version: 1,
    key: "cs_003",
    category: "Customer lifecycle management",
    name: "Don't market products already purchased",
    description:
      "Do not promote acquisition offers for products or services the customer already owns. Account for product-specific ownership rather than assuming that a customer relationship excludes every proposition.",
    type: "prohibition",
    configuration: ["Applicability and exceptions"],
    activationRecommendation: "review",
    approvalRequired: true,
  },
  {
    id: "CS-004",
    version: 1,
    key: "cs_004",
    category: "Customer lifecycle management",
    name: "Cross-sell to existing customers",
    description:
      "Allow relevant cross-sell opportunities for other products and services where the customer meets the relevant criteria and communication requirements.",
    type: "preference",
    configuration: ["Applicability and exceptions"],
    activationRecommendation: "review",
    approvalRequired: true,
  },
  {
    id: "CS-005",
    version: 1,
    key: "cs_005",
    category: "Customer lifecycle management",
    name: "Respect customer lifecycle stage",
    description:
      "Adapt actions according to whether a contact is a prospect, opportunity, new customer, established customer or former customer. Lifecycle status should be derived from authoritative relationship and transaction data wherever possible.",
    type: "preference",
    configuration: ["Applicability and exceptions"],
    activationRecommendation: "review",
    approvalRequired: true,
  },
  {
    id: "CS-006",
    version: 1,
    key: "cs_006",
    category: "Customer lifecycle management",
    name: "Re-engage former customers appropriately",
    description:
      "Treat former customers differently from entirely new prospects, accounting for previous purchases, relationship history and reasons for leaving.",
    type: "preference",
    configuration: ["Applicability and exceptions"],
    activationRecommendation: "review",
    approvalRequired: true,
  },
  {
    id: "CS-007",
    version: 1,
    key: "cs_007",
    category: "Communication eligibility and compliance",
    name: "Respect communication preferences",
    description: "Honour channel preferences and communication restrictions.",
    type: "requirement",
    configuration: ["Applicability and exceptions"],
    activationRecommendation: "review",
    approvalRequired: true,
  },
  {
    id: "CS-008",
    version: 1,
    key: "cs_008",
    category: "Communication eligibility and compliance",
    name: "Respect unsubscribe requests",
    description:
      "Immediately suppress the relevant marketing communications following an unsubscribe or objection. Ensure restrictions persist across agents and campaigns.",
    type: "prohibition",
    configuration: ["Applicability and exceptions"],
    activationRecommendation: "review",
    approvalRequired: true,
  },
  {
    id: "CS-009",
    version: 1,
    key: "cs_009",
    category: "Communication eligibility and compliance",
    name: "Require appropriate marketing permission",
    description:
      "Evaluate applicable legal requirements before sending electronic marketing. Do not assume that all B2B contacts are eligible.",
    type: "requirement",
    configuration: ["Applicability and exceptions"],
    activationRecommendation: "review",
    approvalRequired: true,
  },
  {
    id: "CS-010",
    version: 1,
    key: "cs_010",
    category: "Communication eligibility and compliance",
    name: "Respect suppression lists",
    description:
      "Prevent prohibited communications to contacts and organisations covered by suppression rules. Make suppression status available to all relevant execution agents.",
    type: "prohibition",
    configuration: ["Applicability and exceptions"],
    activationRecommendation: "review",
    approvalRequired: true,
  },
  {
    id: "CS-011",
    version: 1,
    key: "cs_011",
    category: "Contact frequency and engagement",
    name: "Avoid excessive contact",
    description:
      "Apply configurable communication frequency limits across the complete HVM swarm. Limits must operate across campaigns and channels, rather than independently for each campaign.",
    type: "requirement",
    configuration: [
      "Maximum communications",
      "Rolling period",
      "Channels included",
    ],
    activationRecommendation: "review",
    approvalRequired: true,
  },
  {
    id: "CS-012",
    version: 1,
    key: "cs_012",
    category: "Contact frequency and engagement",
    name: "Don't repeat unanswered messages",
    description:
      "Avoid repeatedly sending substantially similar communications when a contact hasn't engaged.",
    type: "prohibition",
    configuration: ["Similarity criteria", "Unanswered contact threshold"],
    activationRecommendation: "review",
    approvalRequired: true,
  },
  {
    id: "CS-013",
    version: 1,
    key: "cs_013",
    category: "Contact frequency and engagement",
    name: "Treat inactive contacts differently",
    description:
      "Adjust communication strategies when engagement decreases or stops. The Queen should be able to establish business-readable re-engagement and inactivity rules.",
    type: "preference",
    configuration: ["Inactivity period", "Re-engagement conditions"],
    activationRecommendation: "review",
    approvalRequired: true,
  },
  {
    id: "CS-014",
    version: 1,
    key: "cs_014",
    category: "Contact frequency and engagement",
    name: "Stop irrelevant communications",
    description:
      "Stop promoting propositions that the contact has explicitly rejected or indicated are irrelevant.",
    type: "prohibition",
    configuration: ["Applicability and exceptions"],
    activationRecommendation: "review",
    approvalRequired: true,
  },
  {
    id: "CS-015",
    version: 1,
    key: "cs_015",
    category: "Opportunity and sales management",
    name: "Respond to buying signals",
    description:
      "Prioritise meaningful intent, engagement and buying signals. Use available evidence and context rather than relying solely on arbitrary scores.",
    type: "prioritisation",
    configuration: ["Applicability and exceptions"],
    activationRecommendation: "review",
    approvalRequired: true,
  },
  {
    id: "CS-016",
    version: 1,
    key: "cs_016",
    category: "Opportunity and sales management",
    name: "Prioritise high-value opportunities",
    description:
      "Give appropriate attention to strategically important opportunities and contacts. Opportunity value should be calculated dynamically by NBA when required rather than maintained as an unnecessarily duplicated static value.",
    type: "prioritisation",
    configuration: ["Strategic opportunity criteria"],
    activationRecommendation: "review",
    approvalRequired: true,
  },
  {
    id: "CS-017",
    version: 1,
    key: "cs_017",
    category: "Opportunity and sales management",
    name: "Don't interrupt active sales conversations",
    description:
      "Prevent conflicting automated acquisition communications while a human is managing an active sales conversation or opportunity.",
    type: "prohibition",
    configuration: ["Applicability and exceptions"],
    activationRecommendation: "review",
    approvalRequired: true,
  },
  {
    id: "CS-018",
    version: 1,
    key: "cs_018",
    category: "Opportunity and sales management",
    name: "Escalate sales-ready contacts",
    description:
      "Notify the responsible person when the contact satisfies the client's approved sales-readiness definition. The Queen should define that qualification in plain English.",
    type: "escalation",
    configuration: ["Sales-readiness definition", "Responsible person"],
    activationRecommendation: "review",
    approvalRequired: true,
  },
  {
    id: "CS-019",
    version: 1,
    key: "cs_019",
    category: "Opportunity and sales management",
    name: "Respect existing relationships",
    description:
      "Avoid communications that conflict with account ownership, existing relationships or active account-management responsibilities.",
    type: "prohibition",
    configuration: ["Applicability and exceptions"],
    activationRecommendation: "review",
    approvalRequired: true,
  },
  {
    id: "CS-020",
    version: 1,
    key: "cs_020",
    category: "Opportunity and sales management",
    name: "Manage existing opportunities carefully",
    description:
      "Prioritise advancing existing opportunities instead of repeatedly restarting acquisition activity.",
    type: "prioritisation",
    configuration: ["Applicability and exceptions"],
    activationRecommendation: "review",
    approvalRequired: true,
  },
  {
    id: "CS-021",
    version: 1,
    key: "cs_021",
    category: "Opportunity and sales management",
    name: "Recognise lost opportunities",
    description:
      "Respect lost opportunity outcomes and any relevant cooling-off or exclusion rules. Do not automatically restart the acquisition process.",
    type: "prohibition",
    configuration: ["Cooling-off period", "Exclusions"],
    activationRecommendation: "review",
    approvalRequired: true,
  },
  {
    id: "CS-022",
    version: 1,
    key: "cs_022",
    category: "Proposition relevance and contextual decisions",
    name: "Avoid competing propositions",
    description:
      "Coordinate communications involving multiple products or services. Avoid sending conflicting or competing propositions simultaneously.",
    type: "prohibition",
    configuration: ["Competing propositions", "Priority"],
    activationRecommendation: "review",
    approvalRequired: true,
  },
  {
    id: "CS-023",
    version: 1,
    key: "cs_023",
    category: "Proposition relevance and contextual decisions",
    name: "Use relevant context",
    description:
      "Use available and appropriately permitted contact, organisation, product, interaction and intent context to determine relevant actions. Prevent generic campaign execution where the current context makes the proposed communication inappropriate.",
    type: "preference",
    configuration: ["Applicability and exceptions"],
    activationRecommendation: "review",
    approvalRequired: true,
  },
  {
    id: "CS-024",
    version: 1,
    key: "cs_024",
    category: "Proposition relevance and contextual decisions",
    name: "Prioritise inbound enquiries",
    description:
      "Treat contact-initiated interactions as important decision events. Evaluate an appropriate response immediately rather than waiting for scheduled campaign activity.",
    type: "prioritisation",
    configuration: ["Applicability and exceptions"],
    activationRecommendation: "review",
    approvalRequired: true,
  },
  {
    id: "CS-025",
    version: 1,
    key: "cs_025",
    category: "Human oversight",
    name: "Escalate sensitive interactions",
    description:
      "Escalate complaints, contractual disputes, sensitive enquiries and other configured situations to an authorised human. The Queen should be able to describe additional circumstances requiring human intervention.",
    type: "escalation",
    configuration: ["Sensitive situations", "Responsible person"],
    activationRecommendation: "review",
    approvalRequired: true,
  },
] as const;
/** Catalogue context guides review and the future evidence adapter; it is not a permission grant. */
const categoryContext: Record<
  string,
  { objective: string; applicability: string; context: readonly string[] }
> = {
  "Customer lifecycle management": {
    objective:
      "Keep communications appropriate to the relationship with each product.",
    applicability:
      "When considering an acquisition, service, cross-sell or re-engagement action.",
    context: [
      "Contact and organisation",
      "Product and offer",
      "Ownership and entitlement",
      "Product-specific lifecycle",
      "Relationship history",
    ],
  },
  "Communication eligibility and compliance": {
    objective:
      "Prevent communication without the required permission and honour restrictions.",
    applicability:
      "Before every proposed communication, for the relevant channel and jurisdiction.",
    context: [
      "Corporate or individual subscriber",
      "B2B or B2C",
      "Marketing or service purpose",
      "Lawful basis and consent",
      "Channel preferences",
      "Objections and suppression",
      "Jurisdiction",
    ],
  },
  "Contact frequency and engagement": {
    objective:
      "Avoid excessive, repetitive or unwanted contact across the whole workspace.",
    applicability:
      "When selecting a communication in light of recent activity and engagement.",
    context: [
      "Cross-campaign communication history",
      "All relevant channels",
      "Engagement",
      "Rejections",
      "Approved periods and limits",
    ],
  },
  "Opportunity and sales management": {
    objective:
      "Coordinate autonomous recommendations with existing opportunities and human relationships.",
    applicability:
      "When assessing intent, ownership, an opportunity or a proposed sales action.",
    context: [
      "Product-specific opportunity",
      "Human owner",
      "Active conversations",
      "Buying signals",
      "Loss reasons",
      "Business priorities",
    ],
  },
  "Proposition relevance and contextual decisions": {
    objective:
      "Select relevant, coordinated actions using current permitted context.",
    applicability:
      "When comparing propositions or responding to an inbound enquiry.",
    context: [
      "Contact and organisation",
      "Product and offer",
      "Interaction and intent evidence",
      "Competing propositions",
    ],
  },
  "Human oversight": {
    objective: "Keep sensitive situations under authorised human control.",
    applicability:
      "When a proposed interaction matches an approved sensitive situation.",
    context: [
      "Complaint or dispute",
      "Interaction evidence",
      "Client-defined sensitive situations",
      "Responsible human",
    ],
  },
};
export const CONTACT_STRATEGY_TEMPLATES = catalogue.map((t) => ({
  ...t,
  ...categoryContext[t.category],
  rationale: t.description,
  enforcement:
    t.type === "prohibition"
      ? "Prohibit an action when the applicable restriction is established."
      : t.type === "escalation"
        ? "Refer an applicable action to an authorised human."
        : t.type === "requirement"
          ? "Defer the action until the required conditions have been established."
          : "Influence ranking only after all higher-priority requirements permit the action.",
  exceptions:
    "Client-approved exceptions cannot override law, objections, suppression or platform restrictions.",
  conflictResolution:
    "Restrictions take precedence over preferences. Missing evidence or unresolved interpretation requires review.",
  priority: "approved_client_policy" as const,
}));
export const POLICY_PRECEDENCE = [
  "law",
  "consent_and_suppression",
  "platform_safety",
  "approved_client_policy",
  "objectives",
  "recommendations",
] as const;
export function strategyTemplate(key: string) {
  const template = CONTACT_STRATEGY_TEMPLATES.find((t) => t.key === key);
  if (!template) throw new Error("Unknown Contact Strategy template");
  return template;
}
