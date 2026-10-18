import test from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { offerMongoStructure } from "../src/db/offer-validators";
import { WORKSPACE_BILLING_VALIDATOR } from "../src/db/workspace-billing-v19";

// Offline numeric interpretation only; native BSON parity is a separate gate.
function accepts(schema: z.ZodNumber, value: number) {
  const s = offerMongoStructure(schema);
  return (
    Number.isFinite(value) &&
    (s.multipleOf !== 1 || Number.isInteger(value)) &&
    (s.minimum === undefined ||
      (s.exclusiveMinimum ? value > s.minimum : value >= s.minimum)) &&
    (s.maximum === undefined ||
      (s.exclusiveMaximum ? value < s.maximum : value <= s.maximum))
  );
}
test("positive safe integers intersect independently of check order", () => {
  const schemas = [
    z.number().int().positive().safe(),
    z.number().safe().positive().int(),
    z.number().positive().int().safe().finite(),
  ];
  for (const schema of schemas) {
    assert.equal(offerMongoStructure(schema).minimum, 0);
    assert.equal(offerMongoStructure(schema).exclusiveMinimum, true);
    for (const value of [
      -Number.MAX_SAFE_INTEGER,
      -1,
      0,
      0.5,
      1,
      2,
      Number.MAX_SAFE_INTEGER,
      Number.MAX_SAFE_INTEGER + 1,
      Infinity,
      -Infinity,
      NaN,
    ])
      assert.equal(
        accepts(schema, value),
        schema.safeParse(value).success,
        String(value),
      );
  }
});
test("strongest bounds and inclusive-exclusive ties are order independent", () => {
  for (const schema of [
    z.number().min(1).gt(1).min(0).max(5).lt(5).max(9),
    z.number().max(9).lt(5).max(5).min(0).gt(1).min(1),
  ]) {
    assert.deepEqual(offerMongoStructure(schema), {
      bsonType: ["int", "long", "double"],
      minimum: 1,
      exclusiveMinimum: true,
      maximum: 5,
      exclusiveMaximum: true,
    });
    for (const value of [0, 1, 1.1, 4.9, 5, 9])
      assert.equal(accepts(schema, value), schema.safeParse(value).success);
  }
});
test("a stricter inclusive bound replaces weaker exclusive metadata", () => {
  const s = z.number().gt(0).min(1).lt(10).max(9);
  assert.equal(accepts(s, 1), true);
  assert.equal(accepts(s, 9), true);
  assert.equal(offerMongoStructure(s).exclusiveMinimum, undefined);
  assert.equal(offerMongoStructure(s).exclusiveMaximum, undefined);
});
test("finite checks preserve stricter bounds in either order", () => {
  for (const s of [
    z.number().min(2).max(3).finite(),
    z.number().finite().min(2).max(3),
  ])
    for (const n of [1, 2, 2.5, 3, 4, Infinity, -Infinity, NaN])
      assert.equal(accepts(s, n), s.safeParse(n).success);
});
test("contradictory continuous and integer intervals fail closed", () => {
  for (const s of [
    z.number().min(3).max(2),
    z.number().gt(2).max(2),
    z.number().min(2).lt(2),
    z.number().int().gt(1).lt(2),
    z.number().int().min(1.1).max(1.9),
  ])
    assert.throws(
      () => offerMongoStructure(s),
      /Contradictory numeric constraints/,
    );
  assert.equal(accepts(z.number().int().min(2).max(2), 2), true);
});
test("v19 active and revoked revisions retain positive bounds", () => {
  const schema = WORKSPACE_BILLING_VALIDATOR.$and[1] as {
    $jsonSchema: {
      properties: {
        billingExemption: {
          anyOf: { properties: { revision: Record<string, unknown> } }[];
        };
      };
    };
  };
  for (const option of schema.$jsonSchema.properties.billingExemption.anyOf) {
    assert.equal(option.properties.revision.minimum, 0);
    assert.equal(option.properties.revision.exclusiveMinimum, true);
    assert.equal(option.properties.revision.maximum, Number.MAX_SAFE_INTEGER);
  }
});
