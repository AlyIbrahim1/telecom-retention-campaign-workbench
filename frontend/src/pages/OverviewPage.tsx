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
      <div className="page-heading">
        <p className="eyebrow">Workspace</p>
        <h1 id="overview-title">Campaign overview</h1>
        <p className="page-description">Review the current customer population, prepare bounded imports, and keep every campaign selection under human control.</p>
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
        <Link to="/customers">Review customers</Link>
        <Link to="/imports/new">Start an import</Link>
        <Link to="/campaigns/new">Create a campaign</Link>
      </nav>
    </section>
  );
}
