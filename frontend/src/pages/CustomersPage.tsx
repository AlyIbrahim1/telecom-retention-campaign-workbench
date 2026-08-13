import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useState, type Dispatch, type SetStateAction } from "react";

import { listCustomers, type CustomerListItem, type ListQuery } from "../api/customers";
import { ErrorState, formatAmount, formatDate, RecommendationStatus } from "../features/customers/CustomerBits";

const PAGE_SIZES = [25, 50, 100] as const;
type SortField = ListQuery["sort"];

function ListScore({ item }: { item: CustomerListItem }) {
  if (item.risk_score === null || item.risk_score === undefined) {
    return <span className="score-missing">No score yet</span>;
  }
  return (
    <span className="score-wrap">
      <strong className="score-value">{Math.round(item.risk_score * 100)}%</strong>
      <span className="score-label">Model score</span>
    </span>
  );
}

function SortButton({
  label,
  field,
  active,
  order,
  onSort,
}: {
  label: string;
  field: SortField;
  active: boolean;
  order: ListQuery["order"];
  onSort: (field: SortField) => void;
}) {
  return (
    <button
      type="button"
      className="table-sort"
      aria-label={`Sort by ${label}`}
      aria-pressed={active}
      onClick={() => onSort(field)}
    >
      {label} <span aria-hidden="true">{active ? (order === "asc" ? "↑" : "↓") : "↕"}</span>
    </button>
  );
}

export function CustomersPage() {
  const [search, setSearch] = useState("");
  const [recommended, setRecommended] = useState<ListQuery["recommended"]>();
  const [contract, setContract] = useState<ListQuery["contract"]>();
  const [internetService, setInternetService] = useState<ListQuery["internet_service"]>();
  const [freshness, setFreshness] = useState<ListQuery["score_freshness"]>();
  const [outreachStatus, setOutreachStatus] = useState<string>();
  const [isActive, setIsActive] = useState<ListQuery["is_active"]>();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<25 | 50 | 100>(25);
  const [sort, setSort] = useState<SortField>("last_scored_at");
  const [order, setOrder] = useState<ListQuery["order"]>("desc");

  const query: ListQuery = {
    page,
    page_size: pageSize,
    search,
    recommended,
    contract,
    internet_service: internetService,
    score_freshness: freshness,
    outreach_status: outreachStatus,
    is_active: isActive,
    sort,
    order,
  };
  const customers = useQuery({
    queryKey: ["customers", query],
    queryFn: () => listCustomers(query),
  });

  function updateFilter<T>(setter: Dispatch<SetStateAction<T | undefined>>, value: string) {
    setter((value || undefined) as T | undefined);
    setPage(1);
  }

  function handleSort(field: SortField) {
    if (field === sort) {
      setOrder((current) => current === "asc" ? "desc" : "asc");
    } else {
      setSort(field);
      setOrder(field === "customer_id" ? "asc" : "desc");
    }
    setPage(1);
  }

  function clearFilters() {
    setSearch("");
    setRecommended(undefined);
    setContract(undefined);
    setInternetService(undefined);
    setFreshness(undefined);
    setOutreachStatus(undefined);
    setIsActive(undefined);
    setPage(1);
  }

  const data = customers.data;
  const pageCount = Math.max(1, Math.ceil((data?.total ?? 0) / pageSize));
  const hasFilters = Boolean(search || recommended || contract || internetService || freshness || outreachStatus || isActive);

  if (customers.isPending) {
    return (
      <section className="page-stack" aria-labelledby="customers-title">
        <PageHeader />
        <div className="loading-panel" role="status">Loading customer records…</div>
      </section>
    );
  }

  if (customers.isError) {
    return <ErrorState title="Customers" message="Customer records could not be loaded. Your filters are kept; try again when the API is ready." onRetry={() => customers.refetch()} />;
  }

  return (
    <section className="page-stack" aria-labelledby="customers-title">
      <PageHeader />
      <div className="customer-toolbar" aria-label="Customer list filters">
        <label className="search-field">
          <span>Search customer ID</span>
          <input
            type="search"
            value={search}
            onChange={(event) => { setSearch(event.target.value); setPage(1); }}
            placeholder="e.g. APP-DEMO-001"
          />
        </label>
        <label>
          <span>Review status</span>
          <select value={recommended ?? ""} onChange={(event) => updateFilter(setRecommended, event.target.value as "true" | "false")}>
            <option value="">All statuses</option>
            <option value="true">Recommended for review</option>
            <option value="false">Below review threshold</option>
          </select>
        </label>
        <label>
          <span>Contract</span>
          <select value={contract ?? ""} onChange={(event) => updateFilter(setContract, event.target.value)}>
            <option value="">All contracts</option>
            <option value="Month-to-month">Month-to-month</option>
            <option value="One year">One year</option>
            <option value="Two year">Two year</option>
          </select>
        </label>
        <label>
          <span>Internet</span>
          <select value={internetService ?? ""} onChange={(event) => updateFilter(setInternetService, event.target.value)}>
            <option value="">All services</option>
            <option value="DSL">DSL</option>
            <option value="Fiber optic">Fiber optic</option>
            <option value="No">No internet service</option>
          </select>
        </label>
        <label>
          <span>Score freshness</span>
          <select value={freshness ?? ""} onChange={(event) => updateFilter(setFreshness, event.target.value)}>
            <option value="">Any score state</option>
            <option value="fresh">Scored</option>
            <option value="missing">Not scored</option>
          </select>
        </label>
        <label>
          <span>Outreach status</span>
          <select value={outreachStatus ?? ""} onChange={(event) => updateFilter(setOutreachStatus, event.target.value)}>
            <option value="">Any outreach state</option>
            <option value="none">No outreach recorded</option>
          </select>
        </label>
        <label>
          <span>Account state</span>
          <select value={isActive ?? ""} onChange={(event) => updateFilter(setIsActive, event.target.value)}>
            <option value="">All records</option>
            <option value="true">Active</option>
            <option value="false">Inactive</option>
          </select>
        </label>
      </div>

      <div className="list-summary">
        <p role="status"><strong>{data?.total ?? 0}</strong> matching customer{data?.total === 1 ? "" : "s"}</p>
        {hasFilters && <button type="button" className="text-button" onClick={clearFilters}>Clear filters</button>}
        <label className="page-size">
          <span>Rows per page</span>
          <select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value) as 25 | 50 | 100); setPage(1); }}>
            {PAGE_SIZES.map((size) => <option key={size} value={size}>{size}</option>)}
          </select>
        </label>
      </div>

      {data?.items.length === 0 ? (
        <div className="empty-panel">
          <p className="eyebrow">No records to show</p>
          <h2>{hasFilters ? "No customers match these filters" : "Your customer list is empty"}</h2>
          <p>{hasFilters ? "Clear a filter or search for another customer ID." : "Create the first customer to generate a model score."}</p>
          <div className="state-actions">
            {hasFilters && <button type="button" className="button-secondary" onClick={clearFilters}>Clear filters</button>}
            {!hasFilters && <Link className="button-link" to="/customers/new">Create customer</Link>}
          </div>
        </div>
      ) : (
        <div className="table-scroll">
          <table className="customer-table">
            <caption className="sr-only">Customer records and current model scores</caption>
            <thead>
              <tr>
                <th scope="col" aria-sort={sort === "customer_id" ? (order === "asc" ? "ascending" : "descending") : "none"}><SortButton label="Customer ID" field="customer_id" active={sort === "customer_id"} order={order} onSort={handleSort} /></th>
                <th scope="col">Contract / service</th>
                <th scope="col">Tenure</th>
                <th scope="col" aria-sort={sort === "monthly_charges" ? (order === "asc" ? "ascending" : "descending") : "none"}><SortButton label="Monthly charges" field="monthly_charges" active={sort === "monthly_charges"} order={order} onSort={handleSort} /></th>
                <th scope="col" aria-sort={sort === "total_charges" ? (order === "asc" ? "ascending" : "descending") : "none"}><SortButton label="Total charges" field="total_charges" active={sort === "total_charges"} order={order} onSort={handleSort} /></th>
                <th scope="col" aria-sort={sort === "risk_score" ? (order === "asc" ? "ascending" : "descending") : "none"}><SortButton label="Model score" field="risk_score" active={sort === "risk_score"} order={order} onSort={handleSort} /></th>
                <th scope="col">Review status</th>
                <th scope="col">Outreach status</th>
                <th scope="col" aria-sort={sort === "last_scored_at" ? (order === "asc" ? "ascending" : "descending") : "none"}><SortButton label="Last scored" field="last_scored_at" active={sort === "last_scored_at"} order={order} onSort={handleSort} /></th>
                <th scope="col"><span className="sr-only">Open</span></th>
              </tr>
            </thead>
            <tbody>
              {data?.items.map((item) => (
                <tr key={item.customer_id}>
                  <th scope="row" data-label="Customer ID"><Link to={`/customers/${encodeURIComponent(item.customer_id)}`}>{item.customer_id}</Link></th>
                  <td data-label="Contract / service"><strong>{item.contract}</strong><span className="cell-note">{item.internet_service}</span></td>
                  <td data-label="Tenure">{item.tenure} months</td>
                  <td data-label="Monthly charges">{formatAmount(item.monthly_charges)}</td>
                  <td data-label="Total charges">{formatAmount(item.total_charges)}</td>
                  <td data-label="Model score"><ListScore item={item} /></td>
                  <td data-label="Review status"><RecommendationStatus recommended={item.recommended_for_review} /></td>
                  <td data-label="Outreach status"><span className="status status-muted">{item.outreach_status || "No outreach record"}</span></td>
                  <td data-label="Last scored">{formatDate(item.last_scored_at)}</td>
                  <td data-label="Open"><Link className="row-action" to={`/customers/${encodeURIComponent(item.customer_id)}`}>Open<span className="sr-only"> {item.customer_id}</span></Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <nav className="pagination" aria-label="Customer results pages">
        <button type="button" className="button-secondary" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>Previous</button>
        <span aria-live="polite">Page {page} of {pageCount}</span>
        <button type="button" className="button-secondary" disabled={page >= pageCount} onClick={() => setPage((current) => current + 1)}>Next</button>
      </nav>
    </section>
  );
}

function PageHeader() {
  return (
    <div className="page-heading page-heading-action">
      <div>
        <p className="eyebrow">Customer records</p>
        <h1 id="customers-title">Customers</h1>
        <p className="page-description">Find a record, understand its model score, and open the facts before taking action.</p>
      </div>
      <Link className="button-link" to="/customers/new">Create customer</Link>
    </div>
  );
}
