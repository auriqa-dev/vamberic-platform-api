import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DeletePreview } from "./delete-preview";

test("preview UI renders precise dependent counts/IDs and readable blockers", () => {
  const html = renderToStaticMarkup(
    createElement(DeletePreview, {
      preview: {
        recordId: "person_00000000000000000000000001",
        recordType: "person",
        previewToken: "a".repeat(64),
        willDelete: [
          {
            collection: "contact_points",
            count: 2,
            ids: ["contact_one", "contact_two"],
          },
        ],
        blockedBy: [
          {
            collection: "transactions",
            count: 1,
            ids: ["transaction_one"],
            code: "COMMERCIAL_HISTORY",
            reason: "Financial history must be retained.",
          },
        ],
      },
    }),
  );
  for (const text of [
    "Proposed scope",
    "contact points: 2",
    "contact_one",
    "contact_two",
    "Deletion blocked",
    "Financial history must be retained.",
    "transaction_one",
  ])
    assert.ok(html.includes(text), text);
  assert.equal(
    html.includes("a".repeat(64)),
    false,
    "preview token is not displayed",
  );
});
