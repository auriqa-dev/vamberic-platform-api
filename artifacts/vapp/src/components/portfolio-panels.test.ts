import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Router } from "wouter";
import {
  PortfolioNavigation,
  PortfolioMetrics,
  PortfolioProducts,
  ProductRelationships,
  OpportunityHighlights,
  opportunityValue,
} from "./portfolio-panels";
import type { CrmOpportunity } from "@workspace/api-client-react";

function render(element: ReturnType<typeof createElement>) {
  return renderToStaticMarkup(
    createElement(Router, { ssrPath: "/products/example" }, element),
  );
}
test("portfolio navigation exposes working oversight screens and marks nested Product routes", () => {
  const html = render(
    createElement(PortfolioNavigation, { location: "/products/example" }),
  );
  for (const label of [
    "Overview",
    "Products",
    "People",
    "Organisations",
    "Opportunities",
  ])
    assert.ok(html.includes(label));
  for (const path of [
    "/campaigns",
    "/subscriptions",
    "/events",
    "/settings",
    "/leads",
    "/workspaces",
    "/tasks",
  ])
    assert.equal(html.includes(`href="${path}"`), false);
  assert.equal((html.match(/aria-current="page"/g) ?? []).length, 1);
  assert.match(
    html,
    /<a(?=[^>]*href="\/products")(?=[^>]*aria-current="page")[^>]*>/,
  );
});
test("overview renders genuine empty portfolio and opportunity states", () => {
  const html = render(createElement(PortfolioProducts, { products: [] }));
  assert.match(html, /No portfolio products yet/);
  assert.match(html, /href="\/products\/new"/);
  assert.match(
    render(createElement(OpportunityHighlights, { opportunities: [] })),
    /No portfolio opportunities recorded yet/,
  );
  const counts = render(
    createElement(PortfolioMetrics, {
      summary: {
        totalProducts: 0,
        activeProducts: 0,
        draftOrInactiveProducts: 0,
        totalPeople: 0,
        totalOrganisations: 0,
        totalOpportunities: 0,
      },
    }),
  );
  assert.equal((counts.match(/>0<\/dd>/g) ?? []).length, 6);
  assert.equal(counts.includes("Coming Soon"), false);
});
test("commercial relationship status stays attached to each Product", () => {
  const html = render(
    createElement(ProductRelationships, {
      products: [
        {
          id: "a",
          product: { id: "built", name: "Built Matters" },
          status: "prospect",
        },
        { id: "b", product: { id: "hvm", name: "HVM" }, status: "customer" },
      ],
    }),
  );
  assert.match(html, /Prospect for <\/span><a[^>]*>Built Matters/);
  assert.match(html, /Customer for <\/span><a[^>]*>HVM/);
  assert.match(
    render(createElement(ProductRelationships, { products: [] })),
    /Commercial status is unknown/,
  );
});
const opportunity: CrmOpportunity = {
  id: "opportunity_a",
  name: "Review request",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  product: { id: "hvm", name: "HVM" },
  organisation: { id: "org_a", name: "Example Ltd" },
  people: [{ id: "person_a", name: "Example Person" }],
  status: "open",
  stage: "bespoke review",
  estimatedValueMinor: 12345,
  currency: "GBP",
};
test("opportunity rendering retains Product, organisation, people and actual stage without guessing a primary contact", () => {
  const html = render(
    createElement(OpportunityHighlights, { opportunities: [opportunity] }),
  );
  for (const text of [
    "/products/hvm",
    "/organisations/org_a",
    "/people/person_a",
    "bespoke review",
    "£123.45",
  ])
    assert.ok(html.includes(text));
  assert.equal(html.includes("Primary contact"), false);
  assert.match(
    render(
      createElement(OpportunityHighlights, {
        opportunities: [],
        productName: "Built Matters",
      }),
    ),
    /No opportunities recorded for Built Matters/,
  );
  assert.equal(opportunityValue({}), "Not recorded");
  assert.equal(
    opportunityValue({ estimatedValueMinor: 0, currency: "GBP" }),
    "£0.00",
  );
  assert.equal(
    opportunityValue({ estimatedValueMinor: 123, currency: "JPY" }),
    "JP¥123",
  );
});
