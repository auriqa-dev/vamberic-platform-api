import assert from "node:assert/strict";
import { test } from "node:test";
import type { ClientSession, Db } from "mongodb";
import { ExecutionSerialSchema } from "../src/domain/execution-serialization";
import { lockAuthorityDocument } from "../src/services/agent-authority-serialization";
import {
  EXECUTION_SERIALIZATION_PREDECESSORS,
  EXECUTION_SERIALIZATION_VALIDATORS,
} from "../src/db/execution-serialization-validators";
import { withoutMongoId } from "../src/services/hvm-context";
import { crmPatchSchema } from "../src/services/crm-foundation";
import { EnquiryMemoryDb } from "./helpers/enquiry-db";

test("authority token absent means zero, advances without changing business metadata, fails closed at exhaustion", async () => {
  const db = new EnquiryMemoryDb();
  const row = {
    id: "fixture",
    updatedAt: new Date("2030-01-01"),
    executionSerial: undefined as number | undefined,
  };
  db.rows("crm_workspaces").push(row);
  const businessTime = row.updatedAt;
  await lockAuthorityDocument(
    db as unknown as Db,
    { collection: "crm_workspaces", id: row.id },
    {} as ClientSession,
  );
  assert.equal(row.executionSerial, 1);
  assert.equal(row.updatedAt, businessTime);
  assert.equal("executionSerial" in withoutMongoId(row), false);
  row.executionSerial = Number.MAX_SAFE_INTEGER;
  await assert.rejects(
    lockAuthorityDocument(
      db as unknown as Db,
      { collection: "crm_workspaces", id: row.id },
      {} as ClientSession,
    ),
  );
  assert.equal(row.executionSerial, Number.MAX_SAFE_INTEGER);
});
test("counter contract rejects null/fractions/negative/unsafe/nonfinite values and caller patches", () => {
  for (const value of [
    null,
    -1,
    0.1,
    Number.MAX_SAFE_INTEGER + 1,
    Infinity,
    "1",
  ])
    assert.equal(ExecutionSerialSchema.safeParse(value).success, false);
  for (const value of [0, 1, Number.MAX_SAFE_INTEGER])
    assert.ok(ExecutionSerialSchema.safeParse(value).success);
  assert.equal(
    crmPatchSchema("crm_workspaces").safeParse({ executionSerial: 1 }).success,
    false,
  );
});
test("seven candidate authority validators add optional bounded counter without mutating published predecessors", () => {
  assert.equal(Object.keys(EXECUTION_SERIALIZATION_VALIDATORS).length, 7);
  for (const [name, validator] of Object.entries(
    EXECUTION_SERIALIZATION_VALIDATORS,
  )) {
    const structural =
      validator.$jsonSchema ??
      validator.$and.find((v: Record<string, unknown>) => v.$jsonSchema)
        .$jsonSchema;
    const old = EXECUTION_SERIALIZATION_PREDECESSORS[name]!;
    const prior =
      old.$jsonSchema ??
      old.$and.find((v: Record<string, unknown>) => v.$jsonSchema).$jsonSchema;
    assert.equal(prior.properties.executionSerial, undefined);
    assert.equal(structural.required.includes("executionSerial"), false);
    assert.equal(
      structural.properties.executionSerial.maximum,
      Number.MAX_SAFE_INTEGER,
    );
    assert.equal(structural.properties.executionSerial.minimum, 0);
    assert.equal(structural.properties.executionSerial.multipleOf, 1);
  }
});
