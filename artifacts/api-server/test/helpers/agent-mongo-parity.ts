import assert from "node:assert/strict";
import { MongoClient, MongoServerError, type Document } from "mongodb";
/** Read-only $documents validation. No collection insert, DDL or fixtures persist. */
export async function agentMongoParity(
  cases: readonly {
    collection: string;
    name: string;
    document: Document;
    valid: boolean;
  }[],
  validators: Record<string, Document>,
) {
  assert.ok(process.env.MONGODB_URI, "Secure Mongo configuration required");
  const databaseName =
    process.env.AGENT_LOCAL_PARITY_DATABASE ?? "vamberic_studio";
  if (process.env.AGENT_LOCAL_PARITY_DATABASE) {
    const uri = new URL(process.env.MONGODB_URI!);
    assert.equal(uri.protocol, "mongodb:");
    assert.equal(uri.hostname, "127.0.0.1");
    assert.equal(uri.port, "27193");
    assert.equal(uri.username, "");
    assert.equal(uri.password, "");
    assert.match(databaseName, /^psu_v23_native_[a-z0-9_]+$/);
    assert.equal(uri.pathname, `/${databaseName}`);
    assert.equal(uri.searchParams.get("replicaSet"), "psu_v23_verify");
    assert.equal(uri.searchParams.get("directConnection"), "true");
  }
  const client = new MongoClient(process.env.MONGODB_URI!);
  try {
    await client.connect();
    if (process.env.AGENT_INSTALLED_MONGO_PARITY === "1") {
      const metadata = await client
        .db(databaseName)
        .listCollections()
        .toArray();
      validators = Object.fromEntries(
        Object.keys(validators).map((name) => {
          const installed = metadata.find((row) => row.name === name)?.options
            ?.validator;
          assert.ok(installed, `Missing installed validator: ${name}`);
          return [name, installed];
        }),
      );
    }
    const mismatches: string[] = [];
    for (const c of cases) {
      const rows = await client
        .db(databaseName)
        .aggregate([
          { $documents: { $literal: [c.document] } },
          { $match: validators[c.collection] },
          { $project: { _id: 0, id: 1 } },
        ])
        .toArray();
      if ((rows.length === 1) !== c.valid)
        mismatches.push(
          `${c.collection}: ${c.name}: unexpected ${rows.length === 1 ? "acceptance" : "rejection"}`,
        );
    }
    assert.deepEqual(mismatches, [], "Every unexpected validator outcome");
  } catch (error) {
    if (error instanceof assert.AssertionError) throw error;
    throw new Error(
      `Read-only Agent validator parity failed (Mongo code ${error instanceof MongoServerError ? error.code : "unavailable"}); provider details withheld`,
    );
  } finally {
    await client.close();
  }
}
