import {
  digest,
  productCriteria,
  PRODUCT_PROFILE,
  ProductHistorySchema,
} from "@workspace/agent-runtime-protocol";
import {
  EffectivenessDefinitionSchema,
  EffectivenessPolicySchema,
} from "../../domain/agent-effectiveness";
import type { EffectivenessProfile } from "../agent-effectiveness";

const body = {
  key: "product_service_understanding_v1",
  version: 1,
  maxRevisions: 2,
  manualOverride: false,
  consequences: [
    { key: "validity_hold", onFailure: "hold", onUncertain: "hold" },
    { key: "repair", onFailure: "revise", onUncertain: "hold" },
    { key: "structure_review", onFailure: "escalate", onUncertain: "escalate" },
  ],
};
export const PRODUCT_POLICY = EffectivenessPolicySchema.parse({
  identity: { key: body.key, version: body.version, digest: digest(body) },
  maxRevisions: body.maxRevisions,
  manualOverride: body.manualOverride,
  consequences: body.consequences,
});
export const PRODUCT_EFFECTIVENESS = EffectivenessDefinitionSchema.parse({
  maker: "understand",
  evaluator: "evaluate_understanding",
  revision: "revise_understanding",
  profile: PRODUCT_PROFILE,
  policy: PRODUCT_POLICY.identity,
  required: true,
  maxRevisions: 2,
});

/** Trusted server composition. No production registry entry or live Definition
 * is created. Infrastructure preparation must remain independently authorized. */
export function productEffectivenessProfile(
  options: Pick<
    EffectivenessProfile,
    "manifestDigest" | "prepareCase" | "prepareRun"
  >,
): EffectivenessProfile {
  const floor = productCriteria();
  return {
    ...options,
    definition: PRODUCT_EFFECTIVENESS,
    policy: PRODUCT_POLICY,
    criteriaFloor: floor.criteria,
    selector: { kind: "proposal", proposalId: "offering_understanding" },
    // Conservatively require assessments until authoritative applicability is supplied.
    allowedNotApplicable: () => [],
    historicalSupport(input) {
      if (
        !input ||
        typeof input !== "object" ||
        !("history" in input) ||
        input.history === undefined
      )
        return [];
      return ProductHistorySchema.parse(input.history).importedSupport;
    },
    async prepareCase(context) {
      const result = await options.prepareCase(context);
      if (result.criteria.profile.digest !== PRODUCT_PROFILE.digest)
        throw new Error("Product profile mismatch");
      return result;
    },
  };
}
