import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  OfferMethodologySchema,
  listOfferMethodologies,
} from "../src/domain/offer-methodologies";
const method = listOfferMethodologies()[0];

test("learning teaches product/service, customer and offer before the conceptual model", () => {
  const learning = method.learning!;
  assert.equal(
    learning.explanation,
    "Your product or service is what you sell. Your offer is how you market and sell it.",
  );
  assert.deepEqual(
    learning.sections.map((s) => s.key),
    [
      "product_service",
      "customer",
      "offer",
      "example",
      "value_equation",
      "what_happens_next",
    ],
  );
  assert.deepEqual(
    learning.sections.slice(0, 3).map((s) => s.kind),
    ["concept", "concept", "concept"],
  );
  assert.match(
    learning.sections[2].explanation,
    /same product or service can have more than one offer/,
  );
  const example = learning.sections[3];
  assert.equal(example.kind, "example");
  if (example.kind !== "example") throw new Error("Example required");
  assert.equal(example.productService.name, "Energy optimisation service");
  assert.equal(example.clientExample?.source, "current_offering");
  assert.deepEqual(example.clientExample?.fields, ["name", "factual_summary"]);
  const model = learning.sections[4];
  assert.equal(model.kind, "conceptual_model");
  assert.equal("source" in model && model.source, "conceptualModel");
  assert.deepEqual(
    method.conceptualModel.dimensions.map((d) => d.key),
    ["desired_outcome", "confidence", "time_to_value", "customer_effort"],
  );
  assert.ok(
    method.conceptualModel.dimensions.every((d) => d.explanation.length > 20),
  );
  const next = learning.sections[5];
  assert.equal(next.kind, "next_steps");
  assert.equal("source" in next && next.source, "stages");
});

test("pre-release learning is additive: all original methodology data including fourteen stages is unchanged", () => {
  const { learning, ...original } = method;
  assert.ok(learning);
  assert.equal(
    createHash("sha256").update(JSON.stringify(original)).digest("hex"),
    "3b3a7422bd74248660540602a6ee01322fa7f37cf3449a7387f55690b6e21eb5",
  );
  assert.equal(method.version, 1);
  assert.equal(method.stages.length, 14);
  assert.equal(OfferMethodologySchema.safeParse(method).success, true);
});

test("future methodologies can teach different concepts and models or omit learning", () => {
  const alternative = {
    ...method,
    key: "alternative",
    name: "Alternative Method",
    conceptualModel: {
      expression: "Fit before expansion",
      dimensions: [
        { key: "fit", name: "Fit", explanation: "Understand the match." },
      ],
    },
    learning: {
      title: "A different starting point",
      explanation: "Learn this approach.",
      sections: [
        {
          kind: "concept",
          key: "fit",
          title: "Fit",
          explanation: "Start with fit.",
        },
      ],
    },
  };
  assert.equal(OfferMethodologySchema.safeParse(alternative).success, true);
  assert.equal(
    OfferMethodologySchema.safeParse({ ...alternative, learning: undefined })
      .success,
    true,
  );
});

test("learning is bounded strict data, with unique keys and fixed context references", () => {
  const learning = method.learning!;
  const parse = (value: unknown) =>
    OfferMethodologySchema.safeParse({ ...method, learning: value }).success;
  assert.equal(
    parse({ ...learning, html: "<script>arbitrary()</script>" }),
    false,
  );
  assert.equal(
    parse({ ...learning, sections: Array(21).fill(learning.sections[0]) }),
    false,
  );
  assert.equal(
    parse({
      ...learning,
      sections: [learning.sections[0], learning.sections[0]],
    }),
    false,
  );
  assert.equal(parse({ ...learning, title: "x".repeat(201) }), false);
  assert.equal(
    parse({
      ...learning,
      sections: [{ ...learning.sections[4], source: "arbitraryExpression" }],
    }),
    false,
  );
});

test("Value Proposition Development v1.0 has eight complete, independent execution stages", async () => {
  const second = listOfferMethodologies()[1];
  assert.equal(second.name, "Value Proposition Development");
  assert.equal(second.version, 1);
  assert.notEqual(second.id, method.id);
  assert.deepEqual(second.stages.map(s=>s.name), [
    "Customer Context","Problems and Priorities","Desired Outcomes","Alternatives and Competition",
    "Differentiated Value","Evidence and Credibility","Commercial Proposition","Validation and Approval",
  ]);
  for (const stage of second.stages) {
    for (const key of ["requiredContext","analysisRequirements","expectedOutputs","validationDecisions","completionCriteria"] as const)
      assert.ok(stage[key]?.length, stage.key+":"+key);
    assert.equal(stage.workingDataSchema,"offer_stage_v1");
    assert.ok(stage.completionRequirements.includes("decision_rationale"));
  }
  const {responseSchemaForMethodology} = await import("../src/services/offer-architecture/generate");
  const schema = responseSchemaForMethodology(second);
  assert.equal(schema.properties.stages.minItems,8);
  assert.equal(schema.properties.stages.maxItems,8);
  assert.deepEqual(schema.properties.stages.items.properties.stageKey.enum, second.stages.map(s=>s.key));
});
