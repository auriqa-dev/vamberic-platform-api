import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { V14_SETUP_VALIDATORS } from "../src/db/setup";
import { V14_SETUP_COLLECTIONS } from "../src/db/collections";
const frozen = {
  "src/db/identity-value-v14.ts":
    "32a669b7097e53c36926c15c360f74cbef8bcf0d710cd40d106b2c7c0232085b",
  "src/domain/identity-value-v14-references.ts":
    "af761a8ea21d44ca0bce160f8d0614233975cfcdeb85499aa30c6be01bc5daf5",
  "src/domain/identity-value-v14.ts":
    "1f1ca3d939eb91b29627cde4e1f952b127bde92255cc0137c1951a50e13201a8",
  "test/identity-value-v14-preservation.test.ts":
    "5ec5bced8421da81f436ee28b6d39cd95d7817e6fa2335576551bfa632d6fd0c",
  "test/identity-value-v14.test.ts":
    "e512629114059969b1e82dfd1d1d6a5bc419c62df9559a63e94bc6f7f7ec436f",
  "../../docs/identity-value-strategy-v14-foundation.md":
    "825c1b8a5b73bfed64e4a4f87c118321706f5d04718c0db2131115f1ba53e3c6",
  "../../docs/identity-value-strategy-v14-verification.md":
    "9a663d976f52f9eb1d7b2d928818f28249628f42c807dfc5960929e8ab89360e",
};
for (const [file, expected] of Object.entries(frozen))
  test(`frozen v14 artifact unchanged: ${file}`, () => {
    assert.equal(
      createHash("sha256")
        .update(readFileSync(new URL("../" + file, import.meta.url)))
        .digest("hex"),
      expected,
    );
  });
test("complete compiled v14 setup target retains reviewed fingerprint", () => {
  assert.equal(
    createHash("sha256")
      .update(
        JSON.stringify({
          version: 14,
          validators: V14_SETUP_VALIDATORS,
          collections: V14_SETUP_COLLECTIONS,
        }),
      )
      .digest("hex"),
    "22361100e00aeffeee50cddb1a64b5898d8de7add0cdba19592c9f0003aec310",
  );
});

test("v14 migration assertions are byte-for-byte unchanged apart from isolated runner import", () => {
  const original = readFileSync(
    new URL("./identity-value-v14-migration.test.ts", import.meta.url),
    "utf8",
  ).replace('from "./helpers/database-v14"', 'from "../src/db/setup"');
  assert.equal(
    createHash("sha256").update(original).digest("hex"),
    "94239ee926b1e29ecafb61f3a0d8dffb982fc67fb08d27a2af0e1d1511d9a2ca",
  );
});
