import assert from "node:assert/strict";
import { test } from "node:test";
import { MongoClient, type Document } from "mongodb";
import { generatePlatformId } from "../src/domain/ids";
import {
  HIVE_KINDS,
  HIVE_PREFIXES,
  HIVE_RECORD_SCHEMAS,
  HiveRevisionSchema,
  definitionHash,
  semanticHash,
  type HiveKind,
} from "../src/domain/hive-definitions";
import { HIVE_MONGO_VALIDATORS } from "../src/db/hive-validators";

const now = new Date("2026-09-29T12:00:00Z");
const earlier = new Date(now.getTime() - 1000);
const later = new Date(now.getTime() + 1000);
const human = {
  type: "human",
  id: "parity-test",
  issuer: "https://example.com",
};
function record(kind: HiveKind, approved = false): Document {
  const row: Document = {
    id: generatePlatformId(HIVE_PREFIXES[kind]),
    workspaceId: generatePlatformId("workspace"),
    createdAt: earlier,
    updatedAt: now,
    createdBy: human,
    updatedBy: human,
    schemaVersion: 1,
    archived: false,
    status: approved ? "approved" : "draft",
    revision: 1,
    evidence: [],
    definition: {
      name: "Parity",
      description: "Synthetic, never persisted",
      ...(kind === "ideal_customer_profiles" ? { profileType: "b2b" } : {}),
    },
    ...(kind === "offerings"
      ? { organisationId: generatePlatformId("org") }
      : { offeringId: generatePlatformId("offering") }),
    ...(kind === "buyer_profiles"
      ? { idealCustomerProfileId: generatePlatformId("icp") }
      : {}),
    ...(approved
      ? { approvedRevision: 1, approvedAt: now, approvedBy: human }
      : {}),
  };
  row.contentHash = definitionHash(row as Parameters<typeof definitionHash>[0]);
  return row;
}
const observation = {
  field: "name",
  value: "Candidate",
  origin: "user_supplied",
  observedAt: earlier,
  recordedAt: now,
  verification: "observed",
  actor: human,
};
type Case = { label: string; row: Document; valid: boolean };
function cases(kind: HiveKind, snapshots: boolean): Case[] {
  const output: Case[] = [];
  function add(
    label: string,
    valid: boolean,
    change: (r: Document) => void = () => {},
    approved = snapshots,
  ) {
    const row = record(kind, approved);
    change(row);
    row.contentHash = definitionHash(
      row as Parameters<typeof definitionHash>[0],
    );
    output.push({ label, row, valid });
  }
  add("base", true);
  add("missing workspace", false, (r) => {
    delete r.workspaceId;
  });
  add("null name", false, (r) => {
    r.definition.name = null;
  });
  add("whitespace name", false, (r) => {
    r.definition.name = "   ";
  });
  add("missing name", false, (r) => {
    delete r.definition.name;
  });
  add("extra definition key", false, (r) => {
    r.definition.unexpected = true;
  });
  add("name bound", false, (r) => {
    r.definition.name = "x".repeat(201);
  });
  add("description bound", false, (r) => {
    r.definition.description = "x".repeat(10001);
  });
  add("bad workspace prefix", false, (r) => {
    r.workspaceId = generatePlatformId("org");
  });
  add("missing parent", false, (r) => {
    delete r[kind === "offerings" ? "organisationId" : "offeringId"];
  });
  add("bad parent prefix", false, (r) => {
    r[kind === "offerings" ? "organisationId" : "offeringId"] =
      generatePlatformId("workspace");
  });
  add("future pointer", false, (r) => {
    r.approvedRevision = 2;
  });
  add("zero revision", false, (r) => {
    r.revision = 0;
  });
  add("fractional revision", false, (r) => {
    r.revision = 1.5;
  });
  add("unknown status", false, (r) => {
    r.status = "published";
  });
  add("archivedAt without archive", false, (r) => {
    r.archivedAt = now;
  });
  add("archive flag without lifecycle", false, (r) => {
    r.archived = true;
  });
  add("reverse timestamps", false, (r) => {
    r.createdAt = later;
  });
  add("date as string", false, (r) => {
    r.createdAt = earlier.toISOString();
  });
  add("nonhuman creator", false, (r) => {
    r.createdBy = { ...human, type: "agent" };
  });
  add("partner ID creator", false, (r) => {
    r.createdBy = { ...human, id: generatePlatformId("partner") };
  });
  add("source", true, (r) => {
    r.source = { system: "test", reference: "fixture", importedAt: earlier };
  });
  add("null source", false, (r) => {
    r.source = null;
  });
  add("evidence", true, (r) => {
    r.evidence = [observation];
  });
  add("evidence maximum", true, (r) => {
    r.evidence = Array(100).fill(observation);
  });
  add("evidence overflow", false, (r) => {
    r.evidence = Array(101).fill(observation);
  });
  add("evidence enum", false, (r) => {
    r.evidence = [{ ...observation, origin: "guessed" }];
  });
  add("evidence path", false, (r) => {
    r.evidence = [{ ...observation, field: "a.b.c" }];
  });
  add("evidence future observed", false, (r) => {
    r.evidence = [{ ...observation, observedAt: later }];
  });
  add("evidence future recorded", false, (r) => {
    r.evidence = [{ ...observation, recordedAt: later }];
  });
  add("evidence NaN", false, (r) => {
    r.evidence = [{ ...observation, value: NaN }];
  });
  add("evidence infinite", false, (r) => {
    r.evidence = [{ ...observation, value: Infinity }];
  });
  add("evidence confidence", false, (r) => {
    r.evidence = [{ ...observation, confidence: 1.1 }];
  });
  add("evidence null", false, (r) => {
    r.evidence = [{ ...observation, value: null }];
  });
  add("evidence string bound", false, (r) => {
    r.evidence = [{ ...observation, value: "x".repeat(10001) }];
  });
  if (snapshots) {
    add("missing approved pointer", false, (r) => {
      delete r.approvedRevision;
    });
    add("missing approver", false, (r) => {
      delete r.approvedBy;
    });
    add("approval before creation", false, (r) => {
      r.approvedAt = new Date(earlier.getTime() - 1);
    });
    add("approval after update", false, (r) => {
      r.approvedAt = later;
    });
    add("old approved pointer", false, (r) => {
      r.revision = 2;
    });
    add("draft history", false, (r) => {
      r.status = "draft";
      delete r.approvedAt;
      delete r.approvedBy;
      delete r.approvedRevision;
    });
  } else {
    add("approved", true, () => {}, true);
    add(
      "approved without pointer",
      false,
      (r) => {
        delete r.approvedRevision;
      },
      true,
    );
    add("approval metadata on draft", false, (r) => {
      r.approvedAt = now;
      r.approvedBy = human;
    });
    add("draft previous pointer", true, (r) => {
      r.revision = 2;
      r.approvedRevision = 1;
    });
    add("draft equal pointer", false, (r) => {
      r.approvedRevision = 1;
    });
    add("retired draft", true, (r) => {
      r.status = "retired";
      r.archived = true;
      r.archivedAt = now;
    });
    add(
      "retired approved",
      true,
      (r) => {
        r.status = "retired";
        r.archived = true;
        r.archivedAt = now;
      },
      true,
    );
    add("retired old pointer", true, (r) => {
      r.status = "retired";
      r.archived = true;
      r.archivedAt = now;
      r.revision = 2;
      r.approvedRevision = 1;
    });
    add("archive before creation", false, (r) => {
      r.status = "retired";
      r.archived = true;
      r.archivedAt = new Date(earlier.getTime() - 1);
    });
  }
  const listField =
    kind === "offerings"
      ? "capabilities"
      : kind === "ideal_customer_profiles"
        ? "characteristics"
        : "jobTitles";
  add("list maximum", true, (r) => {
    r.definition[listField] = Array.from({ length: 40 }, (_, i) => `Item ${i}`);
  });
  add("list overflow", false, (r) => {
    r.definition[listField] = Array.from({ length: 41 }, (_, i) => `Item ${i}`);
  });
  add("list duplicate", false, (r) => {
    r.definition[listField] = ["same", "same"];
  });
  if (kind === "offerings") {
    for (const [url, valid] of [
      ["https://example.com/@company", true],
      ["https://example.com?q=a@b#@c", true],
      ["https://example.com", true],
      ["http://example.com/a", true],
      ["HTTPS://example.com", true],
      ["h\tttps://example.com", true],
      [" https://example.com ", true],
      ["https://[::1]:443/a", true],
      ["https://example.com:8443", true],
      ["https:example.com", true],
      ["https://@example.com", true],
      ["https://example.com/a b", true],
      ["not a URL", false],
      ["https://", false],
      ["https://?a", false],
      ["ftp://example.com", false],
      ["https://user:pass@example.com", false],
      ["https://user@example.com", false],
    ] as const)
      add(`URL ${url}`, valid, (r) => {
        r.definition.websiteUrl = url;
      });
    add("invalid classification", false, (r) => {
      r.definition.primaryOfferingType = "agent";
    });
  }
  if (kind === "ideal_customer_profiles") {
    for (const profileType of ["b2b", "b2c", "d2c"]) {
      add(`${profileType} branch`, true, (r) => {
        r.definition.profileType = profileType;
        r.definition[
          profileType === "b2b" ? "accountProfile" : "consumerProfile"
        ] = {};
      });
      add(`${profileType} wrong branch`, false, (r) => {
        r.definition.profileType = profileType;
        r.definition[
          profileType === "b2b" ? "consumerProfile" : "accountProfile"
        ] = {};
      });
    }
    add("invalid profile type", false, (r) => {
      r.definition.profileType = "hybrid";
    });
  }
  if (kind === "buyer_profiles") {
    add("missing ICP", false, (r) => {
      delete r.idealCustomerProfileId;
    });
    add("buying role", true, (r) => {
      r.definition.buyingRoles = ["decision_maker"];
    });
    add("invalid buying role", false, (r) => {
      r.definition.buyingRoles = ["agent"];
    });
  }
  // Do not recompute this intentionally malformed hash.
  const hashRow = record(kind, snapshots);
  hashRow.contentHash = "bad";
  output.push({ label: "hash format", row: hashRow, valid: false });
  return output.map((c) =>
    snapshots
      ? {
          ...c,
          row: {
            id: generatePlatformId("hiverevision"),
            workspaceId: c.row.workspaceId,
            entityType: kind,
            entityId: c.row.id,
            revision: c.row.revision,
            snapshot: c.row,
          },
        }
      : c,
  );
}

// Opt-in uses collectionless aggregation: fixtures exist only in the pipeline, never in collections.
// No handwritten Mongo emulator: the server evaluates the actual exported validators.
const useMongo = process.env.HIVE_PARITY_MONGO === "true";
for (const kind of HIVE_KINDS)
  for (const snapshots of [false, true]) {
    const variants = cases(kind, snapshots);
    const collection = snapshots ? "hive_definition_revisions" : kind;
    test(`${kind} ${snapshots ? "snapshots" : "current"}: canonical parity fixtures`, async (t) => {
      const schema = snapshots ? HiveRevisionSchema : HIVE_RECORD_SCHEMAS[kind];
      for (const c of variants)
        await t.test(c.label, () => {
          assert.equal(schema.safeParse(c.row).success, c.valid, c.label);
        });
    });
    test(
      `${kind} ${snapshots ? "snapshots" : "current"}: Mongo validator parity (read-only)`,
      { skip: !useMongo },
      async () => {
        assert.ok(
          process.env.MONGODB_URI,
          "Secure MONGODB_URI required for parity check",
        );
        const client = new MongoClient(process.env.MONGODB_URI, {
          serverSelectionTimeoutMS: 5000,
        });
        try {
          await client.connect();
          const rows = await client
            .db("vamberic_studio")
            .aggregate([
              {
                $documents: {
                  $literal: variants.map((c, i) => ({ ...c.row, _id: i })),
                },
              },
              { $match: HIVE_MONGO_VALIDATORS[collection] },
              { $project: { _id: 1 } },
            ])
            .toArray();
          const accepted = new Set(rows.map((r) => r._id));
          for (const [i, c] of variants.entries())
            assert.equal(accepted.has(i), c.valid, c.label);
        } catch (error) {
          if (error instanceof assert.AssertionError) throw error;
          // Driver error details can contain URI/credentials. Never serialize them.
          throw new Error(
            "Read-only Mongo parity execution failed; provider details withheld",
          );
        } finally {
          await client.close();
        }
      },
    );
  }

test("semantic hashes ignore lifecycle/actor/evidence and retain relationship and array semantics", () => {
  const original = record("offerings", true);
  const other = {
    ...original,
    revision: 2,
    status: "draft",
    updatedAt: later,
    createdBy: { ...human, id: "other" },
    evidence: [observation],
  };
  assert.equal(
    definitionHash(original as Parameters<typeof definitionHash>[0]),
    definitionHash(other as Parameters<typeof definitionHash>[0]),
  );
  assert.equal(
    semanticHash({ a: 1, b: { x: 2, y: 3 } }),
    semanticHash({ b: { y: 3, x: 2 }, a: 1 }),
  );
  assert.notEqual(semanticHash(["a", "b"]), semanticHash(["b", "a"]));
  assert.notEqual(
    definitionHash(original as Parameters<typeof definitionHash>[0]),
    definitionHash({
      ...original,
      organisationId: generatePlatformId("org"),
    } as Parameters<typeof definitionHash>[0]),
  );
});
