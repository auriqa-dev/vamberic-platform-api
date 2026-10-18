/** Explicit offline-only artifact generator. Never replaces an existing fixture. */
import { mock } from "node:test";
import { readFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import {
  digest,
  PRODUCT_GENERAL_MANIFEST,
  PRODUCT_PROFILE,
  productCriteria,
} from "@workspace/agent-runtime-protocol";
import {
  PRODUCT_POLICY,
  PRODUCT_EFFECTIVENESS,
} from "../src/services/product-service-understanding/profile";
import { prepareOfflineMakerCalibration } from "../test/helpers/psu-maker-calibration";
const pins = JSON.parse(
  await readFile(
    new URL(
      "../../../../release-reviews/psu-release-readiness/calibration-pins.json",
      import.meta.url,
    ),
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
mock.method(Date, "now", () => Date.parse("2030-01-01T12:00:00.000Z"));
try {
  const { bundle } = await prepareOfflineMakerCalibration();
  await writeFile(
    new URL(
      "../../../../vamberic-agent-runtime/test/fixtures/psu-general-maker-calibration.json",
      import.meta.url,
    ),
    JSON.stringify(bundle, null, 2) + "\n",
    { flag: "wx", mode: 0o600 },
  );
  console.log(
    JSON.stringify({
      status: "OFFLINE_SYNTHETIC_ONLY",
      bundleDigest: digest(bundle),
      wireBytes: Buffer.byteLength(bundle.wire),
    }),
  );
} finally {
  mock.restoreAll();
}
