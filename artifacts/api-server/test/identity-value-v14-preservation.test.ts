import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  REASONING_VALIDATORS,
  REASONING_COLLECTION_DEFINITIONS,
} from "../src/db/reasoning-foundation";
const frozen = {
  "src/db/reasoning-foundation.ts":
    "c0bba3384f64b32933755dccb378c51630a71715eae2cfaea5aae6243557947f",
  "src/domain/reasoning-foundation.ts":
    "43902a16c0c259c81464d08830974ee6cd72c725cee7525cc170d8974232d39b",
  "src/domain/reasoning-crm-links.ts":
    "8be1bfc7f1ce005bad2a55943867c93034ca2bb7f347a72f5ded4d9387c4e860",
  "src/domain/reasoning-reference-check.ts":
    "826a910a8af2e5fd71c784da57cd786814be1b09aed5daf8c7b58af7767cb5bf",
  "src/domain/contact-strategy-registration.ts":
    "419cff18caa8dcc2f0d1e825745dd1656328336bb994ec7a230f55b25505f666",
  "test/reasoning-foundation.test.ts":
    "e7e6f42a0f378635e56a3d22d5fe510d209af2a4e5f510f417a3a13a1805b8cb",
  "../../docs/reasoning-contact-strategy-foundation.md":
    "6540c0f97149dca9d5d347b5bdbafd1e71c888742b4898a512fa660f282f1cc3",
  "../../docs/reasoning-contact-strategy-verification.md":
    "77def20fcb5cae21f0a2388614b90961592e034bf35fcea4d671d2f90cdb484e",
  "src/db/protocol-v12-migration.ts":
    "6ea43022bad00bea1139b970c336b5e6a6baf82485562475059e6c5997fa661c",
};
for (const [file, expected] of Object.entries(frozen))
  test(`frozen v12/v13 artifact unchanged: ${file}`, () => {
    const bytes = readFileSync(new URL("../" + file, import.meta.url));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), expected);
  });
test("compiled canonical v13 validators and indexes retain reviewed fingerprint", () => {
  assert.equal(
    createHash("sha256")
      .update(
        JSON.stringify({
          validators: REASONING_VALIDATORS,
          collections: REASONING_COLLECTION_DEFINITIONS,
        }),
      )
      .digest("hex"),
    "9ef44f76be54037f867522c8824cbb41fcef43cea6244da69a73c833b19608be",
  );
});
