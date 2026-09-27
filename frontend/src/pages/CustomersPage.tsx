import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useState, type Dispatch, type SetStateAction } from "react";

import { listCustomers, type ListQuery } from "../api/customers";
import {
  EmptyState,
  Icon,
  LoadingState,
  PageHeader,
  Pagination,
  ErrorState,
  formatAmount,
  formatDate,
  RecommendationStatus,
  ScoreMeter,
} from "../components/index";
import { SortButton, ariaSort } from "../components/molecules/customers/SortButton";

const PAGE_SIZES = [25, 50, 100] as const;
type SortField = ListQuery["sort"];

const FILTER_LABELS: Record<string, Record<string, string>> = {
  recommended: { true: "Recommended for review", false: "Below review threshold" },
  score_freshness: { fresh: "Scored", missing: "Not scored" },
  outreach_status: { none: "No outreach recorded" },
  is_active: { true: "Active", false: "Inactive" },
};

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
  const [filtersOpen, setFiltersOpen] = useState(false);

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
    // Keep the controls mounted while each keystroke starts a new request.
    // The previous page remains useful context until the server responds.
    placeholderData: (previous) => previous,
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

  const activeChips: Array<{ key: string; label: string; clear: () => void }> = [
    search.trim() ? { key: "search", label: `ID contains “${search.trim()}”`, clear: () => { setSearch(""); setPage(1); } } : null,
    recommended ? { key: "recommended", label: FILTER_LABELS.recommended[recommended], clear: () => updateFilter(setRecommended, "") } : null,
    contract ? { key: "contract", label: contract, clear: () => updateFilter(setContract, "") } : null,
    internetService ? { key: "internet", label: internetService === "No" ? "No internet service" : internetService, clear: () => updateFilter(setInternetService, "") } : null,
    freshness ? { key: "freshness", label: FILTER_LABELS.score_freshness[freshness], clear: () => updateFilter(setFreshness, "") } : null,
    outreachStatus ? { key: "outreach", label: FILTER_LABELS.outreach_status[outreachStatus] ?? outreachStatus, clear: () => updateFilter(setOutreachStatus, "") } : null,
    isActive ? { key: "active", label: FILTER_LABELS.is_active[isActive], clear: () => updateFilter(setIsActive, "") } : null,
  ].filter(Boolean) as Array<{ key: string; label: string; clear: () => void }>;

  const data = customers.data;
  const total = data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const hasFilters = activeChips.length > 0;

  // Keep the existing table and controls mounted while a filter query is
  // refreshing. Unmounting the search field on every keystroke would drop
  // focus and make server-side search stop after the first character.
  if (customers.isPending && !customers.data) {
    return (
      <section className="page-stack" aria-labelledby="customers-title">
        <CustomersHeader />
        <div className="panel"><LoadingState label="Loading customer records…" rows={6} /></div>
      </section>
    );
  }

  if (customers.isError) {
    return <ErrorState title="Customers" message="Customer records could not be loaded. Your filters are kept; try again when the API is ready." onRetry={() => customers.refetch()} />;
  }

  return (
    <section className="page-stack" aria-labelledby="customers-title">
      <CustomersHeader />

      <div className="panel filter-panel">
        <div className={`filter-grid${filtersOpen ? " filters-open" : ""}`} role="group" aria-label="Customer list filters" id="customer-filters">
          <label className="field search-field">
            <span className="field-label">Search customer ID</span>
            <span className="input-with-icon">
              <Icon name="search" size={18} />
              <input
                type="search"
                value={search}
                onChange={(event) => { setSearch(event.target.value); setPage(1); }}
                placeholder="e.g. 7590-VHVEG"
                autoComplete="off"
              />
            </span>
          </label>
          <button type="button" className="button-secondary button-small filter-toggle" aria-expanded={filtersOpen} aria-controls="customer-filters" onClick={() => setFiltersOpen((open) => !open)}>
            <Icon name="chevronDown" size={16} />{filtersOpen ? "Hide filters" : "Show filters"}{activeChips.filter((chip) => chip.key !== "search").length ? ` (${activeChips.filter((chip) => chip.key !== "search").length} active)` : ""}
          </button>
          <label className="field">
            <span className="field-label">Review recommendation</span>
            <select value={recommended ?? ""} onChange={(event) => updateFilter(setRecommended, event.target.value as "true" | "false")}>
              <option value="">All statuses</option>
              <option value="true">Recommended for review</option>
              <option value="false">Below review threshold</option>
            </select>
          </label>
          <label className="field">
            <span className="field-label">Contract</span>
            <select value={contract ?? ""} onChange={(event) => updateFilter(setContract, event.target.value)}>
              <option value="">All contracts</option>
              <option value="Month-to-month">Month-to-month</option>
              <option value="One year">One year</option>
              <option value="Two year">Two year</option>
            </select>
          </label>
          <label className="field">
            <span className="field-label">Internet service</span>
            <select value={internetService ?? ""} onChange={(event) => updateFilter(setInternetService, event.target.value)}>
              <option value="">All services</option>
              <option value="DSL">DSL</option>
              <option value="Fiber optic">Fiber optic</option>
              <option value="No">No internet service</option>
            </select>
          </label>
          <label className="field">
            <span className="field-label">Score freshness</span>
            <select value={freshness ?? ""} onChange={(event) => updateFilter(setFreshness, event.target.value)}>
              <option value="">Any score state</option>
              <option value="fresh">Scored</option>
              <option value="missing">Not scored</option>
            </select>
          </label>
          <label className="field">
            <span className="field-label">Outreach state</span>
            <select value={outreachStatus ?? ""} onChange={(event) => updateFilter(setOutreachStatus, event.target.value)}>
              <option value="">Any outreach state</option>
              <option value="none">No outreach recorded</option>
            </select>
          </label>
          <label className="field">
            <span className="field-label">Account state</span>
            <select value={isActive ?? ""} onChange={(event) => updateFilter(setIsActive, event.target.value)}>
              <option value="">Active and inactive</option>
              <option value="true">Active</option>
              <option value="false">Inactive</option>
            </select>
          </label>
        </div>
        {hasFilters && (
          <div className="chip-row" aria-label="Active filters">
            <span className="chip-row-label">Active filters</span>
            {activeChips.map((chip) => (
              <button key={chip.key} type="button" className="filter-chip" onClick={chip.clear}>
                {chip.label}
                <Icon name="x" size={14} />
                <span className="sr-only"> — remove filter</span>
              </button>
            ))}
            <button type="button" className="text-button" onClick={clearFilters}>Clear filters</button>
          </div>
        )}
      </div>

      <div className="list-toolbar">
        <p role="status" className="result-count">
          <strong>{total.toLocaleString()}</strong> matching customer{total === 1 ? "" : "s"}
          {customers.isFetching && <span className="inline-loading"><span className="spinner" aria-hidden="true" />Updating</span>}
        </p>
        <label className="page-size">
          <span>Rows per page</span>
          <select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value) as 25 | 50 | 100); setPage(1); }}>
            {PAGE_SIZES.map((size) => <option key={size} value={size}>{size}</option>)}
          </select>
        </label>
      </div>

      {data?.items.length === 0 ? (
        <div className="panel">
          <EmptyState
            icon={hasFilters ? "search" : "users"}
            eyebrow="No records to show"
            title={hasFilters ? "No customers match these filters" : "Your customer list is empty"}
            actions={
              <>
                {hasFilters && <button type="button" className="button-secondary" onClick={clearFilters}>Clear filters</button>}
                {!hasFilters && <Link className="button-link" to="/customers/new">Create customer</Link>}
                {!hasFilters && <Link className="button-link button-secondary" to="/imports/new">Import a CSV</Link>}
              </>
            }
          >
            <p>{hasFilters ? "Clear a filter or search for another customer ID." : "Create the first customer or import a CSV to generate model scores."}</p>
          </EmptyState>
        </div>
      ) : (
        <div className={`table-frame${customers.isFetching ? " table-frame-busy" : ""}`}>
          <div className="table-scroll" tabIndex={0} role="region" aria-label="Customer records table">
            <table className="data-table customer-table">
              <caption className="sr-only">Customer records and current model scores</caption>
              <thead>
                <tr>
                  <th scope="col" aria-sort={ariaSort(sort === "customer_id", order)}><SortButton label="Customer ID" field="customer_id" active={sort === "customer_id"} order={order} onSort={handleSort} /></th>
                  <th scope="col">Contract / service</th>
                  <th scope="col" className="num">Tenure</th>
                  <th scope="col" className="num" aria-sort={ariaSort(sort === "monthly_charges", order)}><SortButton label="Monthly charges" field="monthly_charges" active={sort === "monthly_charges"} order={order} onSort={handleSort} /></th>
                  <th scope="col" className="num" aria-sort={ariaSort(sort === "total_charges", order)}><SortButton label="Total charges" field="total_charges" active={sort === "total_charges"} order={order} onSort={handleSort} /></th>
                  <th scope="col" aria-sort={ariaSort(sort === "risk_score", order)}><SortButton label="Model score" field="risk_score" active={sort === "risk_score"} order={order} onSort={handleSort} /></th>
                  <th scope="col">Review status</th>
                  <th scope="col">Outreach status</th>
                  <th scope="col" aria-sort={ariaSort(sort === "last_scored_at", order)}><SortButton label="Last scored" field="last_scored_at" active={sort === "last_scored_at"} order={order} onSort={handleSort} /></th>
                </tr>
              </thead>
              <tbody>
                {data?.items.map((item) => (
                  <tr key={item.customer_id} className={item.is_active ? undefined : "row-muted"}>
                    <th scope="row" data-label="Customer ID">
                      <Link className="record-link" to={`/customers/${encodeURIComponent(item.customer_id)}`}>{item.customer_id}</Link>
                      {!item.is_active && <span className="cell-note">Inactive</span>}
                    </th>
                    <td data-label="Contract / service"><span className="cell-primary">{item.contract}</span><span className="cell-note">{item.internet_service === "No" ? "No internet" : item.internet_service}</span></td>
                    <td data-label="Tenure" className="num">{item.tenure} <span className="cell-unit">mo</span></td>
                    <td data-label="Monthly charges" className="num">{formatAmount(item.monthly_charges)}</td>
                    <td data-label="Total charges" className="num">{formatAmount(item.total_charges)}</td>
                    <td data-label="Model score"><ScoreMeter score={item.risk_score} threshold={item.current_prediction?.threshold} /></td>
                    <td data-label="Review status"><RecommendationStatus recommended={item.recommended_for_review} /></td>
                    <td data-label="Outreach status"><span className="cell-muted">{item.outreach_status || "No outreach record"}</span></td>
                    <td data-label="Last scored" className="cell-date">{formatDate(item.last_scored_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Pagination label="Customer results pages" page={page} pageCount={pageCount} onPage={setPage} total={total} pageSize={pageSize} itemLabel="customers" />
    </section>
  );
}

function CustomersHeader() {
  return (
    <PageHeader
      titleId="customers-title"
      crumbs={[{ label: "Overview", to: "/" }, { label: "Customers" }]}
      eyebrow="Customer records"
      title="Customers"
      description="Find a record, understand its model score, and open the stored facts before taking action."
      actions={
        <>
          <Link className="button-link button-secondary" to="/imports/new"><Icon name="upload" size={18} />Import CSV</Link>
          <Link className="button-link" to="/customers/new"><Icon name="plus" size={18} />Create customer</Link>
        </>
      }
    />
  );
}
