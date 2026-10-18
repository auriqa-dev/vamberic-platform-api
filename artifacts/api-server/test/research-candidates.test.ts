import assert from "node:assert/strict";
import { test } from "node:test";
import { lushaFixture, config } from "./helpers/lusha";
import { createResearchService } from "../src/services/research/service";
import { createResearchCandidates } from "../src/services/research/candidates";
import { readOrganisationDossier } from "../src/services/research/organisation-dossier";
import { createLushaProvider } from "../src/services/lusha/provider";
import { randomUUID } from "node:crypto";
async function setup() {
  const f = await lushaFixture();
  const research = createResearchService(
    config,
    f.db.mongo,
    async (_task, raw) => {
      const source = (raw as { sources: { id: string }[] }).sources[0]!;
      return {
        usage: { model: "offline", inputTokens: 1, outputTokens: 1 },
        result: {
          summary: "Candidates",
          organisations: [
            {
              name: "Example",
              website: "https://example.org",
              industry: "",
              description: "Example services",
              evidenceIds: [source.id],
            },
          ],
          contacts: [
            {
              firstName: "Jane",
              lastName: "Example",
              title: "Director",
              email: "",
              companyWebsite: "https://example.org",
              evidenceIds: [source.id],
            },
          ],
          findings: [],
          gaps: [],
        },
      };
    },
    {
      crawl: async () => ({
        pages: [
          {
            url: "https://example.org/team",
            title: "Team",
            text: "Jane Example is the current Director of Example.",
            retrievedAt: new Date().toISOString(),
            digest: "a".repeat(64),
          },
        ],
        unavailable: [],
        pagesAttempted: 1,
        limited: false,
      }),
    },
  );
  const job = await research.start(f.identity, f.w, {
    requestKey: randomUUID(),
    objective: "Find business candidates",
    type: "contact_discovery",
    scope: { brandId: f.brand, products: [], offers: [], audiences: [] },
    urls: ["https://example.org/team"],
    sourceMode: "web",
  });
  await research.run(f.identity, f.w, job.id);
  const org = f.db
      .rows("events")
      .find(
        (e) =>
          e.eventType === "research_discovery" &&
          e.payload.result.kind === "organisation",
      )!,
    person = f.db
      .rows("events")
      .find(
        (e) =>
          e.eventType === "research_discovery" &&
          e.payload.result.kind === "person",
      )!;
  let calls = 0;
  const provider = createLushaProvider(async (url) => {
    calls++;
    return new Response(
      JSON.stringify({
        results: [
          {
            id: "p1",
            firstName: "Jane",
            lastName: "Example",
            company: { domain: "example.org" },
            ...(String(url).endsWith("enrich")
              ? {
                  emails: [
                    {
                      email: "jane@example.org",
                      type: "work",
                      confidence: "A+",
                    },
                  ],
                }
              : {}),
          },
        ],
        billing: { creditsCharged: 1 },
      }),
    );
  });
  const candidates = createResearchCandidates(
    config,
    f.db.mongo,
    provider,
    f.secrets,
  );
  return { ...f, research, job, org, person, candidates, calls: () => calls };
}
test("candidate selection and A+ promotion persist once without automatic contact creation", async () => {
  const f = await setup();
  assert.equal(f.db.rows("people").length, 0);
  await f.candidates.review(f.identity, f.w, f.org.id, { decision: "select" });
  const savedOrg = await f.candidates.promote(f.identity, f.w, f.org.id);
  assert.ok(savedOrg.id);
  await f.candidates.review(f.identity, f.w, f.person.id, {
    decision: "verify_employment",
    review: {
      sourceUrl: "https://example.org/team",
      observedAt: new Date().toISOString(),
      quote: "Jane Example is the current Director of Example.",
      currentEmployment: true,
      roleMatches: true,
    },
  });
  await assert.rejects(f.candidates.enrich(f.identity, f.w, f.person.id));
  assert.equal(f.calls(), 0);
  await f.service.connect(f.identity, f.w, {
    apiKey: "test-secret-only",
    expectedUpdatedAt: null,
    permissions: { research: true, enrichment: true, discovery: false },
  });
  await f.candidates.enrich(f.identity, f.w, f.person.id);
  assert.equal(f.calls(), 2);
  const contact = await f.candidates.promote(f.identity, f.w, f.person.id);
  assert.equal(f.db.rows("people").length, 1);
  const repeated = await f.candidates.promote(f.identity, f.w, f.person.id);
  assert.equal(repeated.id, contact.id);
  assert.equal(f.db.rows("people").length, 1);
  assert.equal(f.calls(), 2);
  const ledger = f.db
    .rows("events")
    .find((e) => e.eventType === "lusha_lookup")!;
  assert.equal(ledger.payload.creditsCharged, 2);
  const dossier = await readOrganisationDossier(
    await f.db.mongo.database(),
    f.w,
    savedOrg.id,
  );
  assert.equal(dossier.contacts.length, 1);
  assert.equal(
    dossier.contacts[0]!.context.points[0]!.value,
    "jane@example.org",
  );
});
test("foreign access, invented employment evidence and expired candidates cannot progress", async () => {
  const f = await setup();
  await assert.rejects(
    f.candidates.dossier({ ...f.identity, subject: "outsider" }, f.w, f.org.id),
  );
  await assert.rejects(
    f.candidates.review(f.identity, f.w, f.person.id, {
      decision: "verify_employment",
      review: {
        sourceUrl: "https://example.org/team",
        observedAt: new Date().toISOString(),
        quote: "Invented evidence goes here",
        currentEmployment: true,
        roleMatches: true,
      },
    }),
  );
  f.org.payload.expiresAt = new Date(0).toISOString();
  await assert.rejects(f.candidates.promote(f.identity, f.w, f.org.id));
  assert.equal(f.calls(), 0);
});

test("disconnect during search prevents reveal and a repeated paid request", async () => {
  const f = await setup();
  await f.candidates.review(f.identity, f.w, f.org.id, { decision: "select" });
  await f.candidates.promote(f.identity, f.w, f.org.id);
  await f.candidates.review(f.identity, f.w, f.person.id, {
    decision: "verify_employment",
    review: {
      sourceUrl: "https://example.org/team",
      observedAt: new Date().toISOString(),
      quote: "Jane Example is the current Director of Example.",
      currentEmployment: true,
      roleMatches: true,
    },
  });
  const connected = await f.service.connect(f.identity, f.w, {
    apiKey: "test-secret-only",
    expectedUpdatedAt: null,
    permissions: { research: true, enrichment: true, discovery: false },
  });
  let calls = 0;
  const provider = createLushaProvider(async () => {
    calls++;
    await f.service.update(f.identity, f.w, {
      expectedUpdatedAt: connected.updatedAt,
      permissions: { research: true, enrichment: true, discovery: false },
      disconnect: true,
    });
    return new Response(
      JSON.stringify({
        results: [
          {
            id: "p1",
            firstName: "Jane",
            lastName: "Example",
            company: { domain: "example.org" },
          },
        ],
        billing: { creditsCharged: 1 },
      }),
    );
  });
  const candidates = createResearchCandidates(
    config,
    f.db.mongo,
    provider,
    f.secrets,
  );
  await assert.rejects(candidates.enrich(f.identity, f.w, f.person.id));
  assert.equal(calls, 1);
  assert.equal(f.db.rows("people").length, 0);
  await assert.rejects(candidates.enrich(f.identity, f.w, f.person.id));
  assert.equal(calls, 1);
  assert.equal(
    f.db.rows("events").find((e) => e.id === f.person.id)!.payload.result
      .status,
    "needs_review",
  );
});
test("cancelled research cannot promote and expired candidate details are redacted on read", async () => {
  const f = await setup();
  await f.candidates.review(f.identity, f.w, f.org.id, { decision: "select" });
  f.db.rows("events").find((e) => e.id === f.job.id)!.payload.status =
    "cancelled";
  await assert.rejects(f.candidates.promote(f.identity, f.w, f.org.id));
  f.person.payload.expiresAt = new Date(0).toISOString();
  const read = await f.research.read(f.identity, f.w, f.job.id);
  const expired = read.job.discovery.find(
    (d: { candidateId?: string }) => d.candidateId === f.person.id,
  )!;
  assert.equal(expired.status, "expired");
  assert.deepEqual(expired.details, {});
  assert.equal(expired.name, "Expired candidate");
});
