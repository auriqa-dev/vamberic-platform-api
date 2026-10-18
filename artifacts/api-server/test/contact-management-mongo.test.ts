import assert from "node:assert/strict";
import { test } from "node:test";
import { MongoClient } from "mongodb";
import {
  recordPipeline,
  engagementSummaryPipeline,
} from "../src/services/contact-management";
test(
  "Mongo engagement sort precedes pagination, isolates tenants and ignores imports, failed calls, future meetings",
  { skip: !process.env.CONTACT_TEST_MONGO },
  async () => {
    const url = process.env.CONTACT_TEST_MONGO!;
    assert.equal(new URL(url).hostname, "127.0.0.1");
    const c = new MongoClient(url);
    await c.connect();
    const db = c.db("contact_query_" + Date.now());
    try {
      await db.collection("people").insertMany([
        { id: "a", workspaceId: "w", archived: false },
        { id: "b", workspaceId: "w", archived: false },
        { id: "c", workspaceId: "w", archived: false },
        { id: "x", workspaceId: "other" },
      ]);
      const event = (
        id: string,
        date: string,
        type: string,
        outcome?: string,
        w = "w",
      ) => ({
        personId: id,
        workspaceId: w,
        occurredAt: new Date(date),
        interaction: { details: { type, outcome } },
      });
      await db.collection("events").insertMany([
        event("a", "2025-01-01", "email", "received"),
        event("b", "2025-02-01", "call", "connected"),
        event("c", "2025-03-01", "call", "no_answer"),
        event("c", "2099-01-01", "meeting", "held"),
        event("a", "2025-04-01", "email", "received", "other"),
        {
          workspaceId: "w",
          personId: "c",
          eventType: "hive_import_row",
          occurredAt: new Date(),
        },
      ]);
      await db.collection("people").insertMany(
        Array.from({ length: 1770 }, (_, i) => ({
          id: `bulk-${i}`,
          workspaceId: "w",
        })),
      );
      await db.collection("events").insertMany(
        Array.from({ length: 10000 }, (_, i) => ({
          workspaceId: "w",
          personId: `bulk-${i % 1770}`,
          eventType: "hive_import_row",
          occurredAt: new Date(),
        })),
      );
      await db.collection("events").insertOne({
        workspaceId: "w",
        personIds: ["a", "b"],
        occurredAt: new Date("2024-01-01"),
        interaction: { details: { type: "email", outcome: "received" } },
      });
      const contacts = await db
        .collection("events")
        .aggregate(engagementSummaryPipeline("w", "contacts"), {
          maxTimeMS: 10000,
        })
        .toArray();
      const [p] = await db
        .collection("people")
        .aggregate(
          recordPipeline("w", "contacts", { workspaceId: "w" }, 1, 0, contacts),
        )
        .toArray();
      assert.equal(p.items[0].id, "b");
      assert.equal(p.count[0].total, 1773);
      const [q] = await db
        .collection("people")
        .aggregate(
          recordPipeline("w", "contacts", { workspaceId: "w" }, 2, 1, contacts),
        )
        .toArray();
      assert.deepEqual(
        q.items.map((r: { id: string }) => r.id),
        ["a", "bulk-0"],
      );
      assert.equal(q.items[1].lastEngagedAt, null);
      await db.collection("organisations").insertMany([
        { id: "o1", workspaceId: "w" },
        { id: "o2", workspaceId: "w" },
      ]);
      await db.collection("events").insertOne({
        workspaceId: "w",
        organisationId: "o2",
        occurredAt: new Date("2025-01-01"),
        interaction: { details: { type: "meeting", outcome: "held" } },
      });
      const orgDates = await db
        .collection("events")
        .aggregate(engagementSummaryPipeline("w", "organisations"))
        .toArray();
      const [orgs] = await db
        .collection("organisations")
        .aggregate(
          recordPipeline(
            "w",
            "organisations",
            { workspaceId: "w" },
            25,
            0,
            orgDates,
          ),
        )
        .toArray();
      assert.equal(orgs.items[0].id, "o2");
    } finally {
      await db.dropDatabase();
      await c.close();
    }
  },
);
