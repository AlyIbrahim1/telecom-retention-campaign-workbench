import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";

import { listCampaigns } from "../api/campaigns";
import { listCustomers } from "../api/customers";
import { listImports } from "../api/imports";

export function OverviewPage() {
  const summary = useQuery({
    queryKey: ["workspace-overview"],
    queryFn: async () => {
      const [customers, imports, campaigns] = await Promise.all([
        listCustomers({ page: 1, page_size: 25, sort: "customer_id", order: "asc" }),
        listImports(1, 25),
        listCampaigns(1, 25, true),
      ]);
      return { customers: customers.total, imports: imports.total, campaigns: campaigns.total };
    },
  });

  return (
    <section className="page-stack overview-page" aria-labelledby="overview-title">
      <div className="overview-hero">
        <div className="page-heading">
          <p className="eyebrow">Retention operations</p>
          <h1 id="overview-title">Campaign overview</h1>
          <p className="page-description">Move from customer insight to a focused, reviewable retention campaign—with every decision kept in human hands.</p>
        </div>
        <div className="overview-hero-note" aria-label="Workspace purpose">
          <span>01</span>
          <p>Find priority customers. Understand the model signal. Build the right outreach list.</p>
        </div>
      </div>

      {summary.isPending ? (
        <div className="loading-panel" role="status">Loading workspace counts…</div>
      ) : summary.isError || !summary.data ? (
        <div className="system-state" role="alert">
          <h2>Overview counts are unavailable</h2>
          <p>The workspace is still available. Open a section directly or try the counts again.</p>
          <button type="button" onClick={() => summary.refetch()}>Try again</button>
        </div>
      ) : (
        <dl className="overview-summary" aria-label="Workspace record counts">
          <div><dt>Customers</dt><dd>{summary.data.customers.toLocaleString()}</dd></div>
          <div><dt>Import jobs</dt><dd>{summary.data.imports.toLocaleString()}</dd></div>
          <div><dt>Campaigns</dt><dd>{summary.data.campaigns.toLocaleString()}</dd></div>
        </dl>
      )}

      <nav className="overview-actions" aria-label="Workspace actions">
        <Link className="overview-action overview-action-primary" to="/customers"><span>Explore customer insight</span><strong>Review customers</strong><span aria-hidden="true">↗</span></Link>
        <Link className="overview-action" to="/campaigns/new"><span>Build the next outreach list</span><strong>Create a campaign</strong><span aria-hidden="true">↗</span></Link>
        <Link className="overview-action" to="/imports/new"><span>Bring in customer records</span><strong>Start an import</strong><span aria-hidden="true">↗</span></Link>
      </nav>
    </section>
  );
}
