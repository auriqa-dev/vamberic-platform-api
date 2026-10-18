import test from "node:test";
import assert from "node:assert/strict";
import { agentMongoParity } from "./helpers/agent-mongo-parity";
import { MONGO_VALIDATORS } from "../src/db/setup";
import { cases, schemas } from "./helpers/v16-parity-cases";
for (const c of cases)
  test(`v16 application boundary: ${c.name} ${c.collection}`, () => {
    const schema = schemas[c.collection]!;
    assert.equal(schema.safeParse(c.document).success, c.applicationValid);
  });
test(
  "v16 proposed ten-validator Mongo structural/application distinction: read-only $documents",
  { skip: process.env.AGENT_V16_MONGO_PARITY !== "1" },
  async () => {
    assert.notEqual(
      process.env.AGENT_INSTALLED_MONGO_PARITY,
      "1",
      "v16 remains unapplied",
    );
    await agentMongoParity(cases, MONGO_VALIDATORS);
  },
);
