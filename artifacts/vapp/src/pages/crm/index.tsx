import { DeleteDangerZone } from "./delete-danger-zone";
import type { DeletePageKind } from "./delete-workflow";
import { useEffect, useState, type ReactNode } from "react";
import { Link, useParams } from "wouter";
import {
  useListPeople,
  useGetPerson,
  useListOrganisations,
  useGetOrganisation,
  useListOpportunities,
  useGetOpportunity,
  useListProducts,
  type CrmPerson,
  type CrmOrganisation,
  type CrmOpportunity,
  type CrmReference,
  type CrmProductLink,
  type CrmEvent,
  type ListOpportunitiesParams,
} from "@workspace/api-client-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableHeader,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
} from "@/components/ui/table";

const date = (value: string) => new Date(value).toLocaleDateString("en-GB");
function RecordLink({ kind, record }: { kind: string; record: CrmReference }) {
  return (
    <Link
      className="text-primary hover:underline"
      href={`/${kind}/${record.id}`}
    >
      {record.name}
    </Link>
  );
}
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="bg-card border border-border rounded-xl p-5 space-y-4">
      <h2 className="text-lg font-semibold">{title}</h2>
      {children}
    </section>
  );
}
function Status({
  loading,
  error,
  retry,
}: {
  loading: boolean;
  error: boolean;
  retry: () => unknown;
}) {
  if (loading)
    return (
      <p role="status" className="p-6 text-muted-foreground">
        Loading CRM records…
      </p>
    );
  if (error)
    return (
      <div role="alert" className="p-6 space-y-3">
        <p>
          Unable to load this view. The record may be unavailable or your
          session may have expired.
        </p>
        <Button variant="outline" onClick={() => void retry()}>
          Try again
        </Button>
      </div>
    );
  return null;
}
function Empty({
  children = "No linked records yet.",
}: {
  children?: ReactNode;
}) {
  return <p className="text-muted-foreground py-4">{children}</p>;
}
function useSearch() {
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [offset, setOffset] = useState(0);
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(search);
      setOffset(0);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);
  return { search, setSearch, query, offset, setOffset };
}
function ListFrame({
  title,
  search,
  onSearch,
  placeholder,
  children,
  filters,
  total,
  offset,
  setOffset,
}: {
  title: string;
  search: string;
  onSearch: (v: string) => void;
  placeholder: string;
  children: ReactNode;
  filters?: ReactNode;
  total?: number;
  offset: number;
  setOffset: (n: number) => void;
}) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
        <p className="text-muted-foreground mt-1">
          Read-only CRM records and their relationships.
        </p>
      </div>
      <div className="bg-card border border-border rounded-xl p-4 flex flex-wrap gap-3">
        <Input
          className="max-w-md"
          aria-label={placeholder}
          placeholder={placeholder}
          value={search}
          onChange={(e) => onSearch(e.target.value)}
        />
        {filters}
      </div>
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        {children}
      </div>
      {total !== undefined && (
        <div className="flex items-center justify-between gap-4">
          <p className="text-sm text-muted-foreground">
            {total === 0
              ? "0 records"
              : `${offset + 1}–${Math.min(offset + 25, total)} of ${total}`}
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - 25))}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              disabled={offset + 25 >= total}
              onClick={() => setOffset(offset + 25)}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
function PeopleTable({ people }: { people: CrmPerson[] }) {
  if (!people.length)
    return (
      <Empty>
        No people found. New enquiries will appear here; try clearing your
        search.
      </Empty>
    );
  return (
    <Table>
      <TableHeader>
        <TableRow>
          {[
            "Person",
            "Primary email",
            "Current organisation / role",
            "Source",
            "Created",
          ].map((h) => (
            <TableHead key={h}>{h}</TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {people.map((p) => (
          <TableRow key={p.id}>
            <TableCell>
              <RecordLink
                kind="people"
                record={{ id: p.id, name: p.displayName }}
              />
            </TableCell>
            <TableCell>{p.primaryEmail || "—"}</TableCell>
            <TableCell>
              {p.currentOrganisations.length
                ? p.currentOrganisations.map((r) => (
                    <div key={r.organisation.id}>
                      <RecordLink
                        kind="organisations"
                        record={r.organisation}
                      />
                      {r.jobTitle && (
                        <span className="text-muted-foreground">
                          {" "}
                          · {r.jobTitle}
                        </span>
                      )}
                    </div>
                  ))
                : "—"}
            </TableCell>
            <TableCell>{p.sourceSystem || "—"}</TableCell>
            <TableCell>{date(p.createdAt)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
function OrganisationsTable({
  organisations,
}: {
  organisations: CrmOrganisation[];
}) {
  if (!organisations.length)
    return (
      <Empty>
        No organisations found. New enquiry organisations will appear here; try
        clearing your search.
      </Empty>
    );
  return (
    <Table>
      <TableHeader>
        <TableRow>
          {[
            "Organisation",
            "Domain",
            "Status",
            "People",
            "Opportunities",
            "Source",
            "Created",
          ].map((h) => (
            <TableHead key={h}>{h}</TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {organisations.map((o) => (
          <TableRow key={o.id}>
            <TableCell>
              <RecordLink kind="organisations" record={o} />
            </TableCell>
            <TableCell>{o.domain || "—"}</TableCell>
            <TableCell>{o.lifecycleStatus}</TableCell>
            <TableCell>{o.peopleCount}</TableCell>
            <TableCell>{o.opportunityCount}</TableCell>
            <TableCell>{o.sourceSystem || "—"}</TableCell>
            <TableCell>{date(o.createdAt)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
function value(o: CrmOpportunity) {
  if (o.estimatedValueMinor === undefined || !o.currency) return "Not recorded";
  // Domain values are stored in minor units; Intl handles zero/three-decimal currencies.
  const formatter = new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: o.currency,
  });
  const digits = formatter.resolvedOptions().maximumFractionDigits ?? 2;
  return formatter.format(o.estimatedValueMinor / 10 ** digits);
}
function OpportunitiesTable({
  opportunities,
}: {
  opportunities: CrmOpportunity[];
}) {
  if (!opportunities.length)
    return (
      <Empty>
        No opportunities found. New enquiries will appear here; try clearing
        your filters.
      </Empty>
    );
  return (
    <Table>
      <TableHeader>
        <TableRow>
          {[
            "Opportunity",
            "Product",
            "Organisation",
            "People",
            "Status / stage",
            "Value",
            "Source",
            "Created",
            "Updated",
          ].map((h) => (
            <TableHead key={h}>{h}</TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {opportunities.map((o) => (
          <TableRow key={o.id}>
            <TableCell>
              <RecordLink kind="opportunities" record={o} />
            </TableCell>
            <TableCell>
              <RecordLink kind="products" record={o.product} />
            </TableCell>
            <TableCell>
              <RecordLink kind="organisations" record={o.organisation} />
            </TableCell>
            <TableCell>
              {o.people.map((p) => (
                <div key={p.id}>
                  <RecordLink kind="people" record={p} />
                </div>
              ))}
            </TableCell>
            <TableCell>
              {o.status} · {o.stage}
            </TableCell>
            <TableCell>{value(o)}</TableCell>
            <TableCell>{o.sourceSystem || "—"}</TableCell>
            <TableCell>{date(o.createdAt)}</TableCell>
            <TableCell>{date(o.updatedAt)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
export function PeopleList() {
  const s = useSearch();
  const q = useListPeople({
    search: s.query || undefined,
    limit: 25,
    offset: s.offset,
  });
  return (
    <ListFrame
      title="People"
      search={s.search}
      onSearch={s.setSearch}
      placeholder="Search name or email"
      total={q.data?.total}
      offset={s.offset}
      setOffset={s.setOffset}
    >
      <Status loading={q.isLoading} error={q.isError} retry={q.refetch} />
      {q.data && !q.isError && <PeopleTable people={q.data.items} />}
    </ListFrame>
  );
}
export function OrganisationsList() {
  const s = useSearch();
  const q = useListOrganisations({
    search: s.query || undefined,
    limit: 25,
    offset: s.offset,
  });
  return (
    <ListFrame
      title="Organisations"
      search={s.search}
      onSearch={s.setSearch}
      placeholder="Search organisation or domain"
      total={q.data?.total}
      offset={s.offset}
      setOffset={s.setOffset}
    >
      <Status loading={q.isLoading} error={q.isError} retry={q.refetch} />
      {q.data && !q.isError && (
        <OrganisationsTable organisations={q.data.items} />
      )}
    </ListFrame>
  );
}
export function OpportunitiesList() {
  const s = useSearch();
  const [status, setStatus] =
    useState<NonNullable<ListOpportunitiesParams>["status"]>();
  const [stage, setStage] = useState("");
  const [productId, setProductId] = useState("");
  const products = useListProducts();
  const q = useListOpportunities({
    search: s.query || undefined,
    status,
    stage: stage || undefined,
    productId: productId || undefined,
    limit: 25,
    offset: s.offset,
  });
  const selectClass =
    "h-10 rounded-md border border-input bg-background px-3 text-sm";
  return (
    <ListFrame
      title="Opportunities"
      search={s.search}
      onSearch={s.setSearch}
      placeholder="Search opportunity name"
      total={q.data?.total}
      offset={s.offset}
      setOffset={s.setOffset}
      filters={
        <>
          <select
            className={selectClass}
            aria-label="Status"
            value={status || ""}
            onChange={(e) => {
              setStatus((e.target.value as typeof status) || undefined);
              s.setOffset(0);
            }}
          >
            <option value="">All statuses</option>
            {["open", "won", "lost", "paused"].map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
          <Input
            className="w-48"
            aria-label="Exact stage"
            placeholder="Exact stage (e.g. enquiry)"
            value={stage}
            maxLength={100}
            onChange={(e) => {
              setStage(e.target.value);
              s.setOffset(0);
            }}
          />
          <select
            className={selectClass}
            aria-label="Product"
            value={productId}
            onChange={(e) => {
              setProductId(e.target.value);
              s.setOffset(0);
            }}
          >
            <option value="">All products</option>
            {products.data?.map((p) => (
              <option value={p.id} key={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          {products.isError && (
            <span role="status" className="text-sm text-muted-foreground">
              Product filter unavailable.
            </span>
          )}
        </>
      }
    >
      <Status loading={q.isLoading} error={q.isError} retry={q.refetch} />
      {q.data && !q.isError && (
        <OpportunitiesTable opportunities={q.data.items} />
      )}
    </ListFrame>
  );
}
function DetailFrame({
  kind,
  title,
  id,
  children,
}: {
  kind: DeletePageKind;
  title: string;
  id: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-6">
      <Link className="text-primary hover:underline" href={`/${kind}`}>
        ← Back to {kind}
      </Link>
      <div>
        <h1 className="text-3xl font-bold break-words">{title}</h1>
        <p className="text-sm text-muted-foreground mt-1 break-all">{id}</p>
      </div>
      {children}
      <DeleteDangerZone kind={kind} id={id} />
    </div>
  );
}
function ProductLinks({ products }: { products: CrmProductLink[] }) {
  return (
    <Section title="Product relationships">
      {products.length ? (
        <ul className="space-y-2">
          {products.map((p) => (
            <li key={p.id}>
              <RecordLink kind="products" record={p.product} /> · {p.status}
              {p.acquisitionSource && ` · ${p.acquisitionSource}`}
            </li>
          ))}
        </ul>
      ) : (
        <Empty />
      )}
    </Section>
  );
}
function Events({ events, title }: { events: CrmEvent[]; title: string }) {
  return (
    <Section title={title}>
      {events.length ? (
        <div className="space-y-5">
          {events.map((e) => (
            <article
              key={e.id}
              className="border-b border-border last:border-0 pb-4 space-y-2"
            >
              <h3 className="font-medium">
                {e.eventType} · {new Date(e.occurredAt).toLocaleString("en-GB")}
              </h3>
              {e.opportunityId && (
                <RecordLink
                  kind="opportunities"
                  record={{ id: e.opportunityId, name: "View opportunity" }}
                />
              )}
              {e.message && (
                <p className="whitespace-pre-wrap break-words">{e.message}</p>
              )}
              <dl className="grid sm:grid-cols-2 gap-2 text-sm">
                {(
                  [
                    "serviceInterest",
                    "source",
                    "medium",
                    "campaign",
                    "content",
                    "term",
                    "landingPage",
                    "referrer",
                  ] as const
                )
                  .filter((k) => e[k])
                  .map((k) => (
                    <div key={k} className="break-words">
                      <dt className="text-muted-foreground">
                        {(
                          {
                            serviceInterest: "Service interest",
                            landingPage: "Landing page",
                          } as Record<string, string>
                        )[k] || k}
                      </dt>
                      <dd>{e[k]}</dd>
                    </div>
                  ))}
              </dl>
            </article>
          ))}
        </div>
      ) : (
        <Empty>No recent events recorded.</Empty>
      )}
      <p className="text-xs text-muted-foreground">
        Most recent 10 events. Submitted text is shown as plain text.
      </p>
    </Section>
  );
}
export function PersonDetail() {
  const { id = "" } = useParams<{ id: string }>();
  const q = useGetPerson(id);
  const p = q.data;
  if (!p || q.isError)
    return <Status loading={q.isLoading} error={q.isError} retry={q.refetch} />;
  return (
    <DetailFrame kind="people" title={p.displayName} id={p.id}>
      <Section title="Identity">
        <dl className="grid sm:grid-cols-2 gap-3">
          <div>
            <dt>First name</dt>
            <dd>{p.firstName}</dd>
          </div>
          <div>
            <dt>Last name</dt>
            <dd>{p.lastName || "Not recorded"}</dd>
          </div>
          <div>
            <dt>Status</dt>
            <dd>{p.lifecycleStatus}</dd>
          </div>
          <div>
            <dt>Created / source</dt>
            <dd>
              {date(p.createdAt)} · {p.sourceSystem || "Not recorded"}
            </dd>
          </div>
        </dl>
      </Section>
      <Section title="Contact points">
        {p.contactPoints.length ? (
          <ul className="space-y-3">
            {p.contactPoints.map((c) => (
              <li key={c.id} className="break-words">
                <p>
                  {c.value}{" "}
                  {c.primary && <span className="text-primary">(primary)</span>}
                </p>
                <p className="text-sm text-muted-foreground">
                  {c.type} · {c.validity} · {c.deliverability}
                  {c.suppressed && " · suppressed"}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <Empty />
        )}
      </Section>
      <Section title="Current organisations">
        {p.currentOrganisations.length ? (
          p.currentOrganisations.map((r, i) => (
            <p key={i}>
              <RecordLink kind="organisations" record={r.organisation} />
              {r.jobTitle && ` · ${r.jobTitle}`}
            </p>
          ))
        ) : (
          <Empty />
        )}
      </Section>
      <ProductLinks products={p.products} />
      <Section title="Opportunities">
        <OpportunitiesTable opportunities={p.opportunities} />
      </Section>
      <Events events={p.recentEvents} title="Recent events" />
    </DetailFrame>
  );
}
export function OrganisationDetail() {
  const { id = "" } = useParams<{ id: string }>();
  const q = useGetOrganisation(id);
  const o = q.data;
  if (!o || q.isError)
    return <Status loading={q.isLoading} error={q.isError} retry={q.refetch} />;
  return (
    <DetailFrame kind="organisations" title={o.name} id={o.id}>
      <Section title="Organisation">
        <p>
          {o.domain || "No domain recorded"} · {o.lifecycleStatus}
        </p>
        <p className="text-muted-foreground">
          Created {date(o.createdAt)} · Source:{" "}
          {o.sourceSystem || "Not recorded"}
        </p>
      </Section>
      <Section title={`Current people (${o.peopleCount})`}>
        <PeopleTable people={o.people} />
      </Section>
      <Section title={`Opportunities (${o.opportunityCount})`}>
        <OpportunitiesTable opportunities={o.opportunities} />
      </Section>
      <ProductLinks products={o.products} />
    </DetailFrame>
  );
}
export function OpportunityDetail() {
  const { id = "" } = useParams<{ id: string }>();
  const q = useGetOpportunity(id);
  const o = q.data;
  if (!o || q.isError)
    return <Status loading={q.isLoading} error={q.isError} retry={q.refetch} />;
  return (
    <DetailFrame kind="opportunities" title={o.name} id={o.id}>
      <Section title="Opportunity">
        <dl className="grid sm:grid-cols-2 gap-4">
          <div>
            <dt>Product</dt>
            <dd>
              <RecordLink kind="products" record={o.product} />
            </dd>
          </div>
          <div>
            <dt>Organisation</dt>
            <dd>
              <RecordLink kind="organisations" record={o.organisation} />
            </dd>
          </div>
          <div>
            <dt>Status / stage</dt>
            <dd>
              {o.status} · {o.stage}
            </dd>
          </div>
          <div>
            <dt>Estimated value</dt>
            <dd>{value(o)}</dd>
          </div>
          <div>
            <dt>Created</dt>
            <dd>{date(o.createdAt)}</dd>
          </div>
          <div>
            <dt>Updated</dt>
            <dd>{date(o.updatedAt)}</dd>
          </div>
          <div>
            <dt>Source</dt>
            <dd>{o.sourceSystem || "Not recorded"}</dd>
          </div>
        </dl>
      </Section>
      <Section title="People">
        {o.people.length ? (
          o.people.map((p) => (
            <p key={p.id}>
              <RecordLink kind="people" record={p} />
            </p>
          ))
        ) : (
          <Empty />
        )}
      </Section>
      <Events events={o.enquiryEvents} title="Enquiry events and attribution" />
    </DetailFrame>
  );
}
