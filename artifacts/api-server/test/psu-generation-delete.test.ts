import { test } from "node:test";
import assert from "node:assert/strict";
import { planProfileDeletion } from "../src/services/psu/deletion";
import type { Document } from "mongodb";
const id = (n: number) => `event_${String(n).padStart(26, "0")}`;
function job(
  n: number,
  kind = "product",
  url = "https://example.com/product",
  brandId = "brand-a",
  offeringId?: string,
) {
  return {
    id: id(n),
    eventType: "psu_generation_requested",
    payload: {
      input: {
        kind,
        brandId,
        websiteUrls: [url],
        workingLabel: "Example",
        ...(offeringId ? { offeringId } : {}),
      },
    },
  };
}
const finish = (n: number, j: Document) => ({
  id: id(n),
  eventType: "psu_generation_finished",
  payload: { jobId: j.id, draftChunks: { count: 1, digest: "a" } },
});
const chunk = (n: number, j: Document, kind = "draft") => ({
  id: id(n),
  eventType: "psu_content_chunk",
  payload: {
    jobId: j.id,
    kind,
    ordinal: 0,
    text: JSON.stringify({
      fields: [
        {
          binding: {
            field: "websiteUrl",
            value: "https://example.com/product",
          },
        },
      ],
    }),
  },
});
test("company deletion clears all attempts, saved products and children without resurrecting older drafts", () => {
  const j1 = job(1, "company"),
    j2 = job(2, "company"),
    j3 = job(3),
    foreign = job(4, "company", "https://other.com", "brand-b");
  const rows = {
    events: [
      j1,
      finish(11, j1),
      chunk(21, j1),
      j2,
      finish(12, j2),
      j3,
      finish(13, j3),
      foreign,
    ],
    offerings: [
      { id: "product-a", brandId: "brand-a" },
      { id: "product-b", brandId: "brand-b" },
    ],
    ideal_customer_profiles: [{ id: "icp-a", offeringId: "product-a" }],
  };
  const p = planProfileDeletion(rows, { kind: "company", id: "brand-a" });
  assert.deepEqual(p.preview.blockers, []);
  assert.equal(p.selectedRows.get("events")?.length, 7);
  assert.deepEqual(
    p.selectedRows.get("offerings")?.map((r) => r.id),
    ["product-a"],
  );
  assert.equal(p.selectedRows.get("ideal_customer_profiles")?.length, 1);
});
test("product draft deletion clears earlier attempts at every depth but not sibling saved products", () => {
  const old = job(1),
    latest = job(2),
    sibling = job(
      3,
      "product",
      "https://example.com/product",
      "brand-a",
      "product-b",
    );
  const rows = {
    events: [old, finish(11, old), latest, finish(12, latest), sibling],
    offerings: [{ id: "product-b", brandId: "brand-a" }],
  };
  const p = planProfileDeletion(rows, { kind: "product-draft", id: latest.id });
  assert.deepEqual(p.preview.blockers, []);
  assert.equal(p.selectedRows.get("events")?.length, 4);
  assert.equal(p.selectedRows.get("offerings")?.length, 0);
  const changed = planProfileDeletion(
    { ...rows, events: [...rows.events, chunk(20, old)] },
    { kind: "product-draft", id: latest.id },
  );
  assert.notEqual(p.preview.token, changed.preview.token);
});
test("product deletion separates shared company generation and preserves company review", () => {
  const shared = job(1, "company"),
    old = job(2),
    saved = {
      id: id(31),
      eventType: "psu_review_saved",
      payload: { jobId: shared.id, offeringId: "product-a" },
    };
  const companyChunk = chunk(22, shared, "companyDraft");
  const rows = {
    events: [
      shared,
      finish(11, shared),
      chunk(21, shared),
      companyChunk,
      old,
      finish(12, old),
      saved,
    ],
    offerings: [
      {
        id: "product-a",
        brandId: "brand-a",
        definition: { websiteUrl: "https://example.com/product" },
      },
    ],
  };
  const p = planProfileDeletion(rows, { kind: "product", id: "product-a" });
  assert.deepEqual(p.preview.blockers, []);
  assert.ok(
    !p.selectedRows
      .get("events")
      ?.some((r) => [shared.id, companyChunk.id, id(11)].includes(r.id)),
  );
  assert.ok(p.selectedRows.get("events")?.some((r) => r.id === saved.id));
  assert.equal(p.updates[0]?.replacement.payload.productDeleted, true);
  assert.equal(p.updates[0]?.replacement.payload.draftChunks, undefined);
});
test("shared company generation must finish before deleting its product; external dependencies still block", () => {
  const shared = job(1, "company");
  assert.match(
    planProfileDeletion(
      { events: [shared, chunk(21, shared)] },
      { kind: "product-draft", id: shared.id },
    ).preview.blockers.join(" "),
    /Wait for company/,
  );
  const j = job(2);
  const p = planProfileDeletion(
    {
      events: [j, finish(12, j)],
      campaigns: [{ id: "campaign", jobId: j.id }],
    },
    { kind: "product-draft", id: j.id },
  );
  assert.match(p.preview.blockers.join(" "), /surviving/);
  assert.throws(() =>
    planProfileDeletion({ events: [] }, { kind: "company", id: "missing" }),
  );
});
