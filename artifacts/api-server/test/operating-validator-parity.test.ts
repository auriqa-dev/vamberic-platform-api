import assert from "node:assert/strict";
import { test } from "node:test";
import { MongoClient, MongoServerError, type Document } from "mongodb";
import { generatePlatformId } from "../src/domain/ids";
import {
  OperatingSchemas,
  PLATFORM_OPERATING_RESOURCES,
  type OperatingResource,
} from "../src/domain/operating";
import { CONTROL_PLANE_OPERATING_MONGO_VALIDATORS as OPERATING_MONGO_VALIDATORS } from "../src/db/operating-validators";
import { operatingFixtures } from "./helpers/operating-fixtures";

const fixtures = operatingFixtures();
const cases: {
  resource: OperatingResource;
  name: string;
  document: Document;
  valid: boolean;
}[] = [];
function add(
  resource: OperatingResource,
  name: string,
  mutate: (r: Document) => void,
  valid = false,
) {
  const document = structuredClone(fixtures[resource]);
  mutate(document);
  cases.push({ resource, name, document, valid });
}
for (const resource of Object.keys(fixtures) as OperatingResource[]) {
  const global = (PLATFORM_OPERATING_RESOURCES as readonly string[]).includes(
    resource,
  );
  add(resource, "valid baseline", () => {}, true);
  add(resource, "invalid ID", (r) => {
    r.id = "bad";
  });
  add(resource, "unknown root field", (r) => {
    r.extra = true;
  });
  add(resource, "missing data", (r) => {
    delete r.data;
  });
  add(resource, "unknown data field", (r) => {
    r.data.extra = true;
  });
  add(resource, "wrong scope", (r) => {
    if (global) r.workspaceId = generatePlatformId("workspace");
    else delete r.workspaceId;
  });
  add(resource, "null workspace", (r) => {
    r.workspaceId = null;
  });
  add(resource, "invalid status", (r) => {
    r.status = "unknown";
  });
  add(resource, "reversed chronology", (r) => {
    r.updatedAt = new Date(r.createdAt.getTime() - 1);
  });
  add(resource, "archived without timestamp", (r) => {
    r.archived = true;
  });
  add(resource, "retired without archive", (r) => {
    r.status = "retired";
  });
  add(
    resource,
    "valid retired",
    (r) => {
      r.status = "retired";
      r.archived = true;
      r.archivedAt = r.updatedAt;
    },
    true,
  );
  add(resource, "archive before creation", (r) => {
    r.status = "retired";
    r.archived = true;
    r.archivedAt = new Date(r.createdAt.getTime() - 1);
  });
  add(resource, "zero version", (r) => {
    r[global ? "version" : "revision"] = 0;
  });
  add(resource, "fractional version", (r) => {
    r[global ? "version" : "revision"] = 1.5;
  });
  for (const value of [Infinity, NaN])
    add(resource, `nonfinite version ${value}`, (r) => {
      r[global ? "version" : "revision"] = value;
    });
  add(resource, "wrong actor identity", (r) => {
    r.createdBy.id = generatePlatformId("partner");
  });
  if (global) {
    add(resource, "invalid key", (r) => {
      r.key = "Bad key";
    });
    add(resource, "invalid availability", (r) => {
      r.availability = "public";
    });
  }
  if (fixtures[resource].data.name) {
    add(resource, "Unicode whitespace-only name", (r) => {
      r.data.name = "\ufeff\u00a0";
    });
    add(resource, "empty name", (r) => {
      r.data.name = " ";
    });
    add(
      resource,
      "name at limit",
      (r) => {
        r.data.name = "x".repeat(200);
      },
      true,
    );
    add(resource, "name above limit", (r) => {
      r.data.name = "x".repeat(201);
    });
    add(resource, "UTF16 name above limit", (r) => {
      r.data.name = "😀".repeat(101);
    });
  }
}
for (const resource of [
  "agent_definitions",
  "pricing_recommendations",
  "swarm_agreements",
] as const) {
  const definition = (r: Document) =>
    resource === "agent_definitions"
      ? r.data
      : (resource === "pricing_recommendations"
          ? r.data
          : r.data.recommendationSnapshot
        ).configurationSnapshot.agents[0].definition;
  const metadata = {
    key: "synthetic",
    version: 1,
    protocolVersion: "1.1",
    manifestDigest: "0".repeat(64),
  };
  add(
    resource,
    "valid execution metadata",
    (r) => {
      definition(r).executionImplementation = { ...metadata };
    },
    true,
  );
  add(resource, "wrong execution protocol", (r) => {
    definition(r).executionImplementation = {
      ...metadata,
      protocolVersion: "1.0",
    };
  });
  add(resource, "fractional implementation version", (r) => {
    definition(r).executionImplementation = { ...metadata, version: 1.5 };
  });
  add(resource, "invalid manifest digest", (r) => {
    definition(r).executionImplementation = {
      ...metadata,
      manifestDigest: "bad",
    };
  });
  add(resource, "unreviewed implementation metadata", (r) => {
    definition(r).executionImplementation = {
      ...metadata,
      executable: "untrusted",
    };
  });
}
function boundary(
  bytes: number,
  mutate: (r: Document) => void = () => {},
): Document {
  const r = structuredClone(fixtures.agent_definitions);
  r.data.configurationFields = Array.from({ length: 40 }, (_, i) => ({
    key: `field_${i}`,
    label: "Choice",
    type: "choice",
    required: false,
    choices: Array.from({ length: 30 }, () => "x"),
  }));
  mutate(r);
  let remaining = bytes - Buffer.byteLength(JSON.stringify(r));
  for (const f of r.data.configurationFields)
    for (let i = 0; i < f.choices.length; i++) {
      const n = Math.min(199, remaining);
      f.choices[i] += "x".repeat(n);
      remaining -= n;
    }
  assert.equal(remaining, 0);
  assert.equal(Buffer.byteLength(JSON.stringify(r)), bytes);
  return r;
}
for (const bytes of [199999, 200000, 200001])
  cases.push({
    resource: "agent_definitions",
    name: `JSON bytes ${bytes}`,
    document: boundary(bytes),
    valid: bytes <= 200000,
  });
for (const resource of [
  "pricing_recommendations",
  "swarm_agreements",
] as const) {
  add(resource, "oversized embedded definition snapshot", (r) => {
    const snapshot =
      resource === "pricing_recommendations"
        ? r.data
        : r.data.recommendationSnapshot;
    snapshot.configurationSnapshot.agents[0].definition = boundary(200000).data;
    assert.ok(Buffer.byteLength(JSON.stringify(r)) > 200000);
  });
}
for (const value of [
  0,
  -0,
  0.000001,
  1e-7,
  0.30000000000000004,
  1.2345678901234567,
  Number.MIN_VALUE,
]) {
  for (const bytes of [200000, 200001])
    cases.push({
      resource: "agent_definitions",
      name: `numeric JSON boundary ${value}/${bytes}`,
      valid: bytes <= 200000,
      document: boundary(bytes, (r) => {
        r.data.costDrivers = [
          {
            key: "test",
            name: "Test",
            unit: "unit",
            description: "Test",
            expectedQuantity: value,
          },
        ];
      }),
    });
}
for (const text of [
  'inside "quotes" and \\ slash',
  "inside\nline\ttab\u0001control",
  "Multibyte 😀 é \u2028 separator",
]) {
  for (const bytes of [200000, 200001])
    cases.push({
      resource: "agent_definitions",
      name: `escaped JSON boundary ${JSON.stringify(text)}/${bytes}`,
      valid: bytes <= 200000,
      document: boundary(bytes, (r) => {
        r.data.description = text;
      }),
    });
}
add("agent_definitions", "duplicate capabilities", (r) => {
  const id = generatePlatformId("capability");
  r.data.providesCapabilityIds = [id, id];
});
add("agent_definitions", "required slot missing minimum", (r) => {
  r.data.integrationRequirements = [
    {
      slot: "email",
      operationalCapability: "email_delivery",
      required: true,
      minimumProviders: 0,
      supportedProviderIds: [],
    },
  ];
});
add("agent_definitions", "too many configuration fields", (r) => {
  r.data.configurationFields = Array.from({ length: 41 }, (_, i) => ({
    key: `field_${i}`,
    label: "Field",
    type: "text",
    required: false,
    choices: [],
  }));
});
add("integration_providers", "empty capability array", (r) => {
  r.data.operationalCapabilities = [];
});
add("integration_providers", "invalid auth metadata", (r) => {
  r.data.authentication = "password";
});
add("integration_providers", "invalid documentation URL", (r) => {
  r.data.documentationUrl = "not a URL";
});
for (const resource of ["client_agents", "client_swarms"] as const) {
  add(resource, "duplicate configuration key", (r) => {
    r.data.configuration = [
      { key: "a", boolean: true },
      { key: "a", text: "value" },
    ];
  });
  add(resource, "configuration multiple values", (r) => {
    r.data.configuration = [{ key: "a", boolean: true, text: "value" }];
  });
  add(
    resource,
    "configuration false value",
    (r) => {
      r.data.configuration = [{ key: "a", boolean: false }];
    },
    true,
  );
}
for (const field of [
  "targetMargin",
  "minimumMargin",
  "annualDiscount",
  "maximumQueenDiscount",
]) {
  add("commercial_policies", `${field} negative`, (r) => {
    r.data[field] = -0.1;
  });
  add("commercial_policies", `${field} above one`, (r) => {
    r.data[field] = 1.01;
  });
}
add("commercial_policies", "inverted margins", (r) => {
  r.data.minimumMargin = 0.8;
});
add("commercial_policies", "invalid calendar date", (r) => {
  r.data.effectiveFrom = "2026-02-30T00:00:00Z";
});
add("commercial_policies", "inverted effective dates", (r) => {
  r.data.effectiveUntil = "2025-01-01T00:00:00Z";
});
for (const resource of [
  "commercial_policies",
  "pricing_recommendations",
  "swarm_agreements",
] as const) {
  add(resource, "invalid currency", (r) => {
    r.data.currency = "ZZZ";
  });
}
for (const field of [
  "expectedOperatingMonthlyMinor",
  "recommendedOnboardingMinor",
  "recommendedMonthlyMinor",
  "recommendedAnnualMinor",
]) {
  add("pricing_recommendations", `${field} negative`, (r) => {
    r.data[field] = -1;
  });
  add("pricing_recommendations", `${field} fractional`, (r) => {
    r.data[field] = 1.5;
  });
}
add("pricing_recommendations", "nested snapshot invalid version", (r) => {
  r.data.configurationSnapshot.agents[0].configuration.definition.version = 0;
});
add("pricing_recommendations", "nested policy invalid margin", (r) => {
  r.data.policySnapshot.minimumMargin = 0.9;
});
for (const treatment of ["internal", "waived", "promotional"] as const) {
  add(
    "swarm_agreements",
    `${treatment} retains positive recommendation`,
    (r) => {
      r.data.decision.treatment = treatment;
      r.data.finalRecurringMinor = 0;
      r.data.finalMonthlyEquivalentMinor = 0;
      r.data.policyResult = "requires_empress_approval";
    },
    true,
  );
}
for (const billing of ["monthly", "annual"] as const)
  add(
    "swarm_agreements",
    `annual commitment billed ${billing}`,
    (r) => {
      r.data.decision.commitment = {
        kind: "annual",
        months: 12,
        renewal: "review",
      };
      r.data.decision.billingFrequency = billing;
    },
    true,
  );
add("swarm_agreements", "monthly commitment annual billing", (r) => {
  r.data.decision.billingFrequency = "annual";
});
add("swarm_agreements", "annual commitment wrong months", (r) => {
  r.data.decision.commitment.kind = "annual";
});
for (const adjustment of [
  { kind: "percentage_discount", percentage: 0.1 },
  { kind: "fixed_discount", amountMinor: 1000 },
  { kind: "custom", amountMinor: 90000 },
]) {
  add(
    "swarm_agreements",
    `valid ${adjustment.kind}`,
    (r) => {
      r.data.decision.adjustment = adjustment;
    },
    true,
  );
}
add("swarm_agreements", "percentage discount without percentage", (r) => {
  r.data.decision.adjustment = { kind: "percentage_discount" };
});
add("swarm_agreements", "percentage outside range", (r) => {
  r.data.decision.adjustment = { kind: "percentage_discount", percentage: 1.1 };
});
add("swarm_agreements", "fixed negative discount", (r) => {
  r.data.decision.adjustment = { kind: "fixed_discount", amountMinor: -1 };
});
add("swarm_agreements", "custom with unexpected percentage", (r) => {
  r.data.decision.adjustment = {
    kind: "custom",
    amountMinor: 1,
    percentage: 0.1,
  };
});
for (const field of [
  "finalRecurringMinor",
  "finalMonthlyEquivalentMinor",
  "recommendedPeriodMinor",
])
  add("swarm_agreements", `${field} negative`, (r) => {
    r.data[field] = -1;
  });

for (const v of cases)
  test(`operating Zod ${v.resource}: ${v.name}`, () =>
    assert.equal(
      OperatingSchemas[v.resource].safeParse(v.document).success,
      v.valid,
    ));
test(
  "read-only proposed operating validator parity in Mongo",
  { skip: process.env.OPERATING_PARITY_MONGO !== "true" },
  async (t) => {
    assert.ok(process.env.MONGODB_URI);
    const client = new MongoClient(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 5000,
    });
    try {
      await client.connect();
      for (const resource of Object.keys(fixtures) as OperatingResource[]) {
        const variants = cases.filter((c) => c.resource === resource);
        for (let start = 0; start < variants.length; start += 5) {
          const batch = variants.slice(start, start + 5);
          const accepted = await client
            .db("vamberic_studio")
            .aggregate([
              {
                $documents: {
                  $literal: batch.map((v, i) => ({ ...v.document, _id: i })),
                },
              },
              { $match: OPERATING_MONGO_VALIDATORS[resource] },
              { $project: { _id: 1 } },
            ])
            .toArray();
          const ids = new Set(accepted.map((r) => r._id));
          for (const [i, v] of batch.entries())
            await t.test(`${resource}: ${v.name}`, () =>
              assert.equal(ids.has(i), v.valid),
            );
        }
      }
    } catch (error) {
      if (error instanceof assert.AssertionError) throw error;
      if (
        error instanceof MongoServerError &&
        error.message.length < 500 &&
        !/mongodb|credential|token|password|secret|@/i.test(error.message)
      ) {
        throw new Error(
          `Read-only fixture validation: ${error.code}: ${error.message}`,
        );
      }
      throw new Error(
        `Read-only operating validator query failed (${error instanceof MongoServerError ? error.code : "unknown"}); provider details withheld`,
      );
    } finally {
      await client.close();
    }
  },
);
