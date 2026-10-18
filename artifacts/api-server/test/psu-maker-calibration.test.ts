import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  PRODUCT_GENERAL_MANIFEST,
  PRODUCT_PROFILE,
  productCriteria,
  digest,
} from "@workspace/agent-runtime-protocol";
import {
  PRODUCT_POLICY,
  PRODUCT_EFFECTIVENESS,
} from "../src/services/product-service-understanding/profile";
import { prepareOfflineMakerCalibration } from "./helpers/psu-maker-calibration";
import {
  verifyCalibration,
  SYNTHETIC_CONFIG,
} from "../../../.integration/vamberic-agent-runtime/dist/scripts/psu/general-maker-calibration.js";

test("reviewed current manifest/profile/policy/criteria pins have no drift", () => {
  const pins = JSON.parse(
    readFileSync(
      new URL("./fixtures/calibration-pins.json", import.meta.url),
      "utf8",
    ),
  );
  assert.deepEqual(pins, {
    manifest: PRODUCT_GENERAL_MANIFEST,
    profile: PRODUCT_PROFILE,
    policy: PRODUCT_POLICY,
    effectiveness: PRODUCT_EFFECTIVENESS,
    criteria: productCriteria(),
  });
});
test("actual Platform prepares maker-only synthetic work without invented provenance", async (t) => {
  t.mock.method(Date, "now", () => Date.parse("2030-01-01T12:00:00.000Z"));
  const { bundle, db } = await prepareOfflineMakerCalibration();
  const work = await verifyCalibration(
    bundle,
    digest(bundle),
    SYNTHETIC_CONFIG,
  );
  assert.equal(work.operation, "understand");
  assert.equal(db.rows("agent_runs").length, 1);
  assert.equal(db.rows("agent_results").length, 0);
  assert.equal(db.rows("client_agents").length, 0);
  assert.equal(work.context.snapshots.length, 1);
  assert.equal(work.grant.budgets.modelCalls, 1);
  assert.ok(work.lineage.length);
});
