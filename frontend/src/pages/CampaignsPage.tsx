import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";

import { listCampaigns } from "../api/campaigns";
import { formatDate } from "../features/customers/CustomerBits";
import { CampaignCapacityMeter, CampaignErrorState, CampaignStatusBadge } from "../features/campaigns/CampaignBits";
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
    return <section className="page-stack campaigns-page" aria-labelledby="campaigns-title"><PageHeader includeArchived={includeArchived} onArchived={setIncludeArchived} /><div className="loading-panel" role="status">Loading campaigns…</div></section>;
  }
  if (campaigns.isError) {
    return <CampaignErrorState title="Campaigns" message="Campaign history could not be loaded. Your view settings are kept; try again when the API is ready." retry={() => campaigns.refetch()} />;
  }

  const data = campaigns.data ?? { items: [], total: 0, page, page_size: PAGE_SIZE };
  const pageCount = Math.max(1, Math.ceil((data.total || 0) / data.page_size));

  return (
    <section className="page-stack campaigns-page" aria-labelledby="campaigns-title">
      <PageHeader includeArchived={includeArchived} onArchived={(value) => { setIncludeArchived(value); setPage(1); }} />
      <div className="list-summary">
        <p role="status"><strong>{data.total}</strong> campaign{data.total === 1 ? "" : "s"}</p>
      </div>

      {data.items.length === 0 ? (
        <div className="empty-panel">
          <p className="eyebrow">No campaigns yet</p>
          <h2>{includeArchived ? "No campaigns match this view" : "Create a focused outreach list"}</h2>
          <p>{includeArchived ? "Turn on a different view or create a new draft campaign." : "Set a name and a capacity, then inspect a deterministic ranking before any outreach decision is confirmed."}</p>
          <div className="state-actions"><Link className="button-link" to="/campaigns/new">New campaign</Link>{includeArchived && <button type="button" className="button-secondary" onClick={() => setIncludeArchived(false)}>Hide archived</button>}</div>
        </div>
      ) : (
        <div className="table-scroll">
          <table className="customer-table campaign-table">
            <caption className="sr-only">Campaign history</caption>
            <thead><tr><th scope="col">Campaign</th><th scope="col">Status</th><th scope="col">Capacity</th><th scope="col">Selection</th><th scope="col">Eligible</th><th scope="col">Updated</th><th scope="col"><span className="sr-only">Open</span></th></tr></thead>
            <tbody>{data.items.map((campaign) => {
              const viewModel = { ...campaign, recommendations: [], overrides: [], optimization: null };
              return <tr key={campaign.campaign_id}>
                <th scope="row" data-label="Campaign"><Link to={`/campaigns/${encodeURIComponent(campaign.campaign_id)}`}>{campaign.name}</Link><span className="cell-note">{campaign.campaign_id}</span></th>
                <td data-label="Status"><CampaignStatusBadge status={campaign.status} /></td>
                <td data-label="Capacity"><strong>{campaign.capacity}</strong><span className="cell-note">Maximum customers</span></td>
                <td data-label="Selection"><CampaignCapacityMeter campaign={viewModel} compact /></td>
                <td data-label="Eligible">{campaign.eligible_count}<span className="cell-note">{campaign.recommended_count} recommended</span></td>
                <td data-label="Updated">{formatDate(campaign.updated_at || campaign.created_at)}</td>
                <td data-label="Open"><Link className="row-action" to={`/campaigns/${encodeURIComponent(campaign.campaign_id)}`}>Open<span className="sr-only"> {campaign.name}</span></Link></td>
              </tr>;
            })}</tbody>
          </table>
        </div>
      )}

      <nav className="pagination" aria-label="Campaign result pages"><button type="button" className="button-secondary" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>Previous</button><span aria-live="polite">Page {page} of {pageCount}</span><button type="button" className="button-secondary" disabled={page >= pageCount} onClick={() => setPage((current) => current + 1)}>Next</button></nav>
    </section>
  );
}

function PageHeader({ includeArchived, onArchived }: { includeArchived: boolean; onArchived: (value: boolean) => void }) {
  return <div className="page-heading page-heading-action"><div><p className="eyebrow">Campaign workbench</p><h1 id="campaigns-title">Campaigns</h1><p className="page-description">Build a capacity-limited list, understand why records rank, and keep the final outreach decision with a human.</p></div><div className="detail-actions"><label className="header-checkbox"><input type="checkbox" checked={includeArchived} onChange={(event) => onArchived(event.target.checked)} /> Include archived</label><Link className="button-link" to="/campaigns/new">New campaign</Link></div></div>;
}
