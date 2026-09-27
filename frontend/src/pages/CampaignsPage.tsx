import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";

import { listCampaigns } from "../api/campaigns";
import {
  EmptyState,
  Icon,
  LoadingState,
  PageHeader,
  Pagination,
  formatAmount,
  formatDate,
  CampaignCapacityMeter,
  CampaignErrorState,
  CampaignStatusBadge,
} from "../components/index";

import "../features/campaigns/campaigns.css";

const PAGE_SIZE = 25;

export function CampaignsPage() {
  const [page, setPage] = useState(1);
  const [includeArchived, setIncludeArchived] = useState(false);
  const campaigns = useQuery({
    queryKey: ["campaigns", page, includeArchived],
    queryFn: () => listCampaigns(page, PAGE_SIZE, includeArchived),
    placeholderData: (previous) => previous,
  });

  if (campaigns.isPending && !campaigns.data) {
    return <section className="page-stack campaigns-page" aria-labelledby="campaigns-title"><PageHeaderBlock /><div className="panel"><LoadingState label="Loading campaigns…" rows={5} /></div></section>;
  }
  if (campaigns.isError) {
    return <CampaignErrorState title="Campaigns" message="Campaign history could not be loaded. Your view settings are kept; try again when the API is ready." retry={() => campaigns.refetch()} />;
  }

  const data = campaigns.data ?? { items: [], total: 0, page, page_size: PAGE_SIZE };
  const pageSize = data.page_size || PAGE_SIZE;
  const pageCount = Math.max(1, Math.ceil((data.total || 0) / pageSize));

  return (
    <section className="page-stack campaigns-page" aria-labelledby="campaigns-title">
      <PageHeaderBlock />
      <div className="list-toolbar">
        <p role="status" className="result-count"><strong>{data.total.toLocaleString()}</strong> campaign{data.total === 1 ? "" : "s"}{includeArchived ? " including archived" : ""}{campaigns.isFetching && <span className="inline-loading"><span className="spinner" aria-hidden="true" />Updating</span>}</p>
        <label className="switch">
          <input type="checkbox" role="switch" checked={includeArchived} onChange={(event) => { setIncludeArchived(event.target.checked); setPage(1); }} />
          <span className="switch-track" aria-hidden="true"><span /></span>
          <span>Include archived</span>
        </label>
      </div>

      {data.items.length === 0 ? (
        <div className="panel">
          <EmptyState
            icon="target"
            eyebrow="No campaigns yet"
            title={includeArchived ? "No campaigns match this view" : "Create a focused outreach list"}
            actions={<><Link className="button-link" to="/campaigns/new"><Icon name="plus" size={18} />New campaign</Link>{includeArchived && <button type="button" className="button-secondary" onClick={() => setIncludeArchived(false)}>Hide archived</button>}</>}
          >
            <p>{includeArchived ? "Turn off the archived view or create a new draft campaign." : "Set a name and a capacity, then inspect a deterministic ranking before any outreach decision is confirmed."}</p>
          </EmptyState>
        </div>
      ) : (
        <div className="table-frame">
          <div className="table-scroll" tabIndex={0} role="region" aria-label="Campaigns table">
            <table className="data-table campaign-table">
              <caption className="sr-only">Campaign history</caption>
              <thead><tr><th scope="col">Campaign</th><th scope="col">Status</th><th scope="col" className="num">Capacity</th><th scope="col">Selection</th><th scope="col" className="num">Eligible</th><th scope="col" className="num">Recommended</th><th scope="col">Updated</th></tr></thead>
              <tbody>{data.items.map((campaign) => {
                const viewModel = { ...campaign, recommendations: [], overrides: [], optimization: null };
                return <tr key={campaign.campaign_id} className={campaign.status === "archived" ? "row-muted" : undefined}>
                  <th scope="row" data-label="Campaign"><Link className="record-link" to={`/campaigns/${encodeURIComponent(campaign.campaign_id)}`}>{campaign.name}</Link><span className="cell-note">{campaign.value_horizon_months}-month horizon · {formatAmount(campaign.contact_cost_per_customer)} per contact</span></th>
                  <td data-label="Status"><CampaignStatusBadge status={campaign.status} /></td>
                  <td data-label="Capacity" className="num">{campaign.capacity.toLocaleString()}</td>
                  <td data-label="Selection"><CampaignCapacityMeter campaign={viewModel} compact /></td>
                  <td data-label="Eligible" className="num">{campaign.status === "draft" ? "—" : campaign.eligible_count.toLocaleString()}</td>
                  <td data-label="Recommended" className="num">{campaign.status === "draft" ? "—" : campaign.recommended_count.toLocaleString()}</td>
                  <td data-label="Updated" className="cell-date">{formatDate(campaign.updated_at || campaign.created_at)}</td>
                </tr>;
              })}</tbody>
            </table>
          </div>
        </div>
      )}

      <Pagination label="Campaign result pages" page={page} pageCount={pageCount} onPage={setPage} total={data.total} pageSize={pageSize} itemLabel="campaigns" />
    </section>
  );
}

function PageHeaderBlock() {
  return (
    <PageHeader
      titleId="campaigns-title"
      crumbs={[{ label: "Overview", to: "/" }, { label: "Campaigns" }]}
      eyebrow="Campaign workbench"
      title="Campaigns"
      description="Build a capacity-limited list, understand why records rank, and keep the final outreach decision with a person."
      actions={<Link className="button-link" to="/campaigns/new"><Icon name="plus" size={18} />New campaign</Link>}
    />
  );
}
