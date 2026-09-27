import {
  useGetDashboardSummary,
  useListProducts,
  useListOpportunities,
} from "@workspace/api-client-react";
import { Link } from "wouter";
import {
  PortfolioMetrics,
  PortfolioProducts,
  OpportunityHighlights,
} from "../components/portfolio-panels";

export default function Dashboard() {
  const summary = useGetDashboardSummary();
  const products = useListProducts();
  const opportunities = useListOpportunities({ limit: 5, offset: 0 });
  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">
          Portfolio overview
        </h1>
        <p className="text-muted-foreground mt-2">
          Products, relationships and commercial activity across Vamberic.
        </p>
      </div>
      {summary.isError ? (
        <p role="alert">
          Portfolio counts could not be loaded.{" "}
          <button
            className="text-primary underline"
            onClick={() => void summary.refetch()}
          >
            Try again
          </button>
        </p>
      ) : summary.data ? (
        <PortfolioMetrics summary={summary.data} />
      ) : (
        <p role="status">Loading portfolio counts…</p>
      )}
      <div className="grid lg:grid-cols-2 gap-6">
        <section className="bg-card border border-border rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">Products</h2>
            <Link
              className="text-sm text-primary hover:underline"
              href="/products"
            >
              View all Products
            </Link>
          </div>
          {products.isError ? (
            <p role="alert">
              Products could not be loaded.{" "}
              <button
                className="text-primary underline"
                onClick={() => void products.refetch()}
              >
                Try again
              </button>
            </p>
          ) : products.data ? (
            <PortfolioProducts products={products.data} />
          ) : (
            <p role="status">Loading Products…</p>
          )}
        </section>
        <section className="bg-card border border-border rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">Recent opportunities</h2>
            <Link
              className="text-sm text-primary hover:underline"
              href="/opportunities"
            >
              View all opportunities
            </Link>
          </div>
          <p className="text-sm text-muted-foreground">
            Five most recently created, including Product enquiries. Open an
            opportunity to review its details.
          </p>
          {opportunities.isError ? (
            <p role="alert">
              Opportunities could not be loaded.{" "}
              <button
                className="text-primary underline"
                onClick={() => void opportunities.refetch()}
              >
                Try again
              </button>
            </p>
          ) : opportunities.data ? (
            <OpportunityHighlights opportunities={opportunities.data.items} />
          ) : (
            <p role="status">Loading opportunities…</p>
          )}
        </section>
      </div>
    </div>
  );
}
