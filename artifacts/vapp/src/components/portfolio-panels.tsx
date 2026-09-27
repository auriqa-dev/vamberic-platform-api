import React from "react";
import {
  LayoutDashboard,
  Package,
  Users,
  Building2,
  Target,
} from "lucide-react";
import type {
  CrmOpportunity,
  CrmProductLink,
  DashboardSummary,
  Product,
} from "@workspace/api-client-react";
import { Link } from "wouter";
import { productLabel } from "../lib/product-labels";

export const portfolioNavigation = [
  { name: "Overview", href: "/", icon: LayoutDashboard },
  { name: "Products", href: "/products", icon: Package },
  { name: "People", href: "/people", icon: Users },
  { name: "Organisations", href: "/organisations", icon: Building2 },
  { name: "Opportunities", href: "/opportunities", icon: Target },
] as const;

export function PortfolioNavigation({ location }: { location: string }) {
  return (
    <nav
      aria-label="Portfolio"
      className="flex-1 overflow-y-auto py-4 px-3 space-y-1"
    >
      {portfolioNavigation.map((item) => {
        const active =
          location === item.href ||
          (item.href !== "/" && location.startsWith(item.href + "/"));
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors ${active ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"}`}
          >
            <item.icon className="w-4 h-4" aria-hidden="true" />
            {item.name}
          </Link>
        );
      })}
    </nav>
  );
}

export function PortfolioMetrics({ summary }: { summary: DashboardSummary }) {
  const metrics = [
    ["Products", summary.totalProducts],
    ["Live Products", summary.activeProducts],
    ["Products not live", summary.draftOrInactiveProducts],
    ["People", summary.totalPeople],
    ["Organisations", summary.totalOrganisations],
    ["Opportunities", summary.totalOpportunities],
  ] as const;
  return (
    <dl className="grid grid-cols-2 lg:grid-cols-3 gap-4">
      {metrics.map(([label, value]) => (
        <div
          key={label}
          className="rounded-xl border border-border bg-card p-5"
        >
          <dt className="text-sm text-muted-foreground">{label}</dt>
          <dd className="mt-2 text-3xl font-bold font-mono">
            {value.toLocaleString()}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function PortfolioProducts({ products }: { products: Product[] }) {
  if (!products.length)
    return (
      <p className="text-muted-foreground">
        No portfolio products yet.{" "}
        <Link className="text-primary hover:underline" href="/products/new">
          Create a Product
        </Link>{" "}
        to get started.
      </p>
    );
  return (
    <ul className="divide-y divide-border">
      {products.map((product) => (
        <li key={product.id} className="py-3 flex justify-between gap-4">
          <Link
            className="text-primary hover:underline"
            href={`/products/${product.id}`}
          >
            {product.name}
          </Link>
          <span className="text-sm text-muted-foreground">
            {productLabel(product.lifecycleStatus)} ·{" "}
            {productLabel(product.operatingMode)}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function opportunityValue(
  opportunity: Pick<CrmOpportunity, "estimatedValueMinor" | "currency">,
) {
  if (opportunity.estimatedValueMinor === undefined || !opportunity.currency)
    return "Not recorded";
  const formatter = new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: opportunity.currency,
  });
  return formatter.format(
    opportunity.estimatedValueMinor /
      10 ** (formatter.resolvedOptions().maximumFractionDigits ?? 2),
  );
}

export function OpportunityHighlights({
  opportunities,
  productName,
}: {
  opportunities: CrmOpportunity[];
  productName?: string;
}) {
  if (!opportunities.length)
    return (
      <p className="text-muted-foreground">
        {productName
          ? `No opportunities recorded for ${productName}.`
          : "No portfolio opportunities recorded yet."}
      </p>
    );
  return (
    <ul className="divide-y divide-border">
      {opportunities.map((o) => (
        <li key={o.id} className="py-4 space-y-2">
          <Link
            className="font-medium text-primary hover:underline"
            href={`/opportunities/${o.id}`}
          >
            {o.name}
          </Link>
          <p className="text-sm">
            <Link
              className="text-primary hover:underline"
              href={`/products/${o.product.id}`}
            >
              {o.product.name}
            </Link>
            {" · "}
            <Link
              className="text-primary hover:underline"
              href={`/organisations/${o.organisation.id}`}
            >
              {o.organisation.name}
            </Link>
          </p>
          <p className="text-sm text-muted-foreground">
            {productLabel(o.status)} · {o.stage} · {opportunityValue(o)}
          </p>
          {o.people.length > 0 && (
            <p className="text-sm">
              People:{" "}
              {o.people.map((p, i) => (
                <span key={p.id}>
                  {i > 0 && ", "}
                  <Link
                    className="text-primary hover:underline"
                    href={`/people/${p.id}`}
                  >
                    {p.name}
                  </Link>
                </span>
              ))}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}

export function ProductRelationships({
  products,
}: {
  products: CrmProductLink[];
}) {
  return (
    <section className="bg-card border border-border rounded-xl p-5 space-y-4">
      <h2 className="text-lg font-semibold">Product relationships</h2>
      <p className="text-sm text-muted-foreground">
        Commercial status is specific to each Product.
      </p>
      {products.length ? (
        <ul className="space-y-2">
          {products.map((p) => (
            <li key={p.id}>
              <span>{productLabel(p.status)} for </span>
              <Link
                className="text-primary hover:underline"
                href={`/products/${p.product.id}`}
              >
                {p.product.name}
              </Link>
              {p.acquisitionSource && (
                <span className="text-muted-foreground">
                  {" "}
                  · {p.acquisitionSource}
                </span>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground">
          No Product relationship recorded. Commercial status is unknown.
        </p>
      )}
    </section>
  );
}
