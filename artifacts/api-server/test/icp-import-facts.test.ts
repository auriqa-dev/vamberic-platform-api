import assert from "node:assert/strict";
import { test } from "node:test";
import { importedFacts } from "../src/services/icp/import-observations";
import { EnquiryMemoryDb } from "./helpers/enquiry-db";

test("member facts exclude mixed-subject ESOS structure and notification totals, preserving source evidence", async () => {
  const db = new EnquiryMemoryDb();
  const rows = db.rows("events");
  for (const [sheet, scope, label] of [
    ["Organisation Structure", "organisation", "Reporting group name"],
    ["Energy Consumption", "notification", "Group energy"],
    ["Responsible Undertaking", "organisation", "Organisation address"],
  ])
    rows.push({
      workspaceId: "w",
      eventType: "hive_import_observations",
      occurredAt: new Date(),
      payload: {
        companyId: "c",
        origin: { sheet, scope, notification: "NOC-1" },
        fields: [{ label, type: "text", value: "Original value" }],
      },
    });
  const result = await importedFacts(await db.mongo.database(), "w", "c");
  assert.deepEqual(
    result.facts.map((f) => f.label),
    ["Organisation address"],
  );
  assert.equal(rows.length, 3);
  assert.deepEqual(
    await importedFacts(await db.mongo.database(), "other-workspace", "c"),
    { facts: [], truncated: false },
  );
});
