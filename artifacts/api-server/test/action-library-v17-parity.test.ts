import test from "node:test";
import assert from "node:assert/strict";
import {
  actionParityCases,
  actionApplicationAccepts,
} from "./helpers/action-library-parity";
import { agentMongoParity } from "./helpers/agent-mongo-parity";
import { ACTION_LIBRARY_V17_VALIDATORS } from "../src/db/action-library-v17";
for (const c of actionParityCases)
  test(`v17 boundary ${c.collection}: ${c.name}`, () =>
    assert.equal(
      actionApplicationAccepts(c.collection, c.document),
      c.applicationValid,
    ));
test(
  "v17 proposed validators read-only Mongo parity (separate authorization required)",
  { skip: process.env.ACTION_V17_MONGO_PARITY !== "1" },
  async () => {
    assert.notEqual(process.env.AGENT_INSTALLED_MONGO_PARITY, "1");
    await agentMongoParity(actionParityCases, ACTION_LIBRARY_V17_VALIDATORS);
  },
);
