import { z } from "zod4";
import { OfferingContentSchema as Base } from "@workspace/agent-runtime-protocol";
const text = () => z.string().trim().min(1).max(2000);
// App-owned extension: the frozen autonomous Agent contracts remain unchanged.
export const OfferingContentSchema = Base.extend({
  offeringTypeExplanation: text().optional(),
  offeringTypeOtherDetail: text().optional(),
  technologyRole: z
    .enum([
      "the_offering",
      "core_component",
      "delivery_enabler",
      "internal_only",
      "not_material",
      "unknown",
    ])
    .optional(),
  technologyRoleExplanation: text().optional(),
  implementationExplanation: text().optional(),
  buyerNextSteps: z.array(text()).max(40).optional(),
});
