import { Link } from "react-router-dom";

import type { Campaign, CampaignRecommendation, CampaignStatus } from "../../api/campaigns";
import { formatAmount, formatDate } from "../customers/CustomerBits";

export function campaignStatusTone(status: CampaignStatus): string {
  if (status === "confirmed") return "status-recommended";
  if (status === "archived") return "status-warning";
  if (status === "optimized") return "status-neutral";
  return "status-muted";
}

export function CampaignStatusBadge({ status }: { status: CampaignStatus }) {
  const label = status[0].toUpperCase() + status.slice(1);
  return <span className={`status ${campaignStatusTone(status)}`}><span aria-hidden="true">{status === "confirmed" ? "●" : status === "archived" ? "!" : status === "optimized" ? "◆" : "○"}</span>{label}</span>;
}

export function proposedCampaignCustomerIds(campaign: Campaign): Set<string> {
  const ids = new Set(
    campaign.recommendations
      .filter((item) => (item.recommended || item.selection_state === "override" || item.selected) && item.selection_state !== "excluded")
      .map((item) => item.customer_id),
  );
  const latestOverrides = new Map(campaign.overrides.map((override) => [override.customer_id, override]));
  for (const override of latestOverrides.values()) {
    if (override.action === "exclude") ids.delete(override.customer_id);
    else ids.add(override.customer_id);
  }
  for (const override of latestOverrides.values()) {
    if (override.action === "include" && override.replacement_customer_id) ids.delete(override.replacement_customer_id);
  }
  return ids;
}

export function proposedCampaignSelectionCount(campaign: Campaign): number {
  return campaign.recommendations.length ? proposedCampaignCustomerIds(campaign).size : campaign.recommended_count;
}

export function CampaignCapacityMeter({ campaign, compact = false }: { campaign: Campaign; compact?: boolean }) {
  const proposed = proposedCampaignSelectionCount(campaign);
  const humanConfirmed = campaign.status === "confirmed" || campaign.status === "archived";
  const used = Math.min(campaign.capacity, Math.max(0, humanConfirmed ? campaign.selected_count : proposed));
  const percent = campaign.capacity ? Math.round((used / campaign.capacity) * 100) : 0;
  const unused = Math.max(0, campaign.capacity - used);
  return (
    <section className={`capacity-meter ${compact ? "capacity-meter-compact" : ""}`} aria-label={compact ? "Campaign capacity" : undefined} aria-labelledby={compact ? undefined : "capacity-meter-title"}>
      <div className="capacity-meter-heading">
        <div>
          {!compact && <p className="eyebrow">{humanConfirmed ? "Human selection" : "Proposed list"}</p>}
          <h2 id={compact ? undefined : "capacity-meter-title"}>Capacity</h2>
        </div>
        <strong>{used} / {campaign.capacity}</strong>
      </div>
      <div className="capacity-track" role="progressbar" aria-label={`Campaign capacity ${used} of ${campaign.capacity} ${humanConfirmed ? "selected" : "proposed"}`} aria-valuemin={0} aria-valuemax={campaign.capacity} aria-valuenow={used}>
        <span style={{ transform: `scaleX(${percent / 100})` }} />
      </div>
      <div className="capacity-meta"><span>{campaign.eligible_count} eligible · {campaign.recommended_count} recommended</span><strong>{unused} unused</strong></div>
    </section>
  );
}

export function RecommendationState({ recommendation }: { recommendation: CampaignRecommendation }) {
  if (recommendation.selection_state === "excluded") return <span className="status status-warning"><span aria-hidden="true">!</span> Excluded by user</span>;
  if (recommendation.selection_state === "override" || recommendation.override) return <span className="status status-neutral"><span aria-hidden="true">◆</span> Override</span>;
  if (recommendation.selected) return <span className="status status-recommended"><span aria-hidden="true">●</span> Selected for outreach</span>;
  if (recommendation.recommended) return <span className="status status-neutral"><span aria-hidden="true">◆</span> Recommended</span>;
  return <span className="status status-muted">Not recommended</span>;
}

export function CampaignFormula({ campaign }: { campaign: Campaign }) {
  const optimization = campaign.optimization;
  const monthlyWeight = optimization?.monthly_weight ?? 0.6;
  const historicalWeight = optimization?.historical_weight ?? 0.4;
  const formulaVersion = optimization?.formula_version ?? "risk-spend-v1";
  return (
    <section className="campaign-formula" aria-labelledby="campaign-formula-title">
      <div className="section-heading"><p className="eyebrow">Explainable ranking</p><h2 id="campaign-formula-title">How priority is calculated</h2><p>Priority is a review aid, not a probability, profit forecast, or automatic outreach decision.</p></div>
      <div className="formula-line" aria-label={`Priority equals 100 times risk score times value index. Value index uses ${monthlyWeight * 100}% monthly spend and ${historicalWeight * 100}% historical spend.`}>
        <span>Priority</span><strong>100 × risk score × value index</strong>
      </div>
      <dl className="formula-details">
        <div><dt>Value index</dt><dd>{(monthlyWeight * 100).toFixed(0)}% monthly spend percentile + {(historicalWeight * 100).toFixed(0)}% historical spend percentile</dd></div>
        <div><dt>Formula version</dt><dd>{formulaVersion}</dd></div>
        <div><dt>Population snapshot</dt><dd>{formatDate(optimization?.reference_population_timestamp)}</dd></div>
      </dl>
      <p className="pilot-note">Percentiles use all active, valid customer records from one snapshot. Eligibility controls recommendations; equal values receive their average rank, keeping repeated scores deterministic.</p>
    </section>
  );
}

export function CampaignErrorState({ title, message, retry, back = true }: { title: string; message: string; retry?: () => void; back?: boolean }) {
  return (
    <section className="system-state" aria-labelledby="campaign-error-title">
      <p className="eyebrow">Campaign workbench</p>
      <h1 id="campaign-error-title">{title}</h1>
      <p role="alert">{message}</p>
      <div className="state-actions">
        {retry && <button type="button" onClick={retry}>Try again</button>}
        {back && <Link className="button-link button-secondary" to="/campaigns">Back to campaigns</Link>}
      </div>
    </section>
  );
}

export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${Math.round(value * 100)}%`;
}

export function formatPriority(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return value.toFixed(1);
}

export function RecommendationRowValues({ recommendation }: { recommendation: CampaignRecommendation }) {
  return (
    <>
      <td data-label="Model score"><span className="score-wrap"><strong className="score-value">{formatPercent(recommendation.risk_score)}</strong><span className="score-label">Model score</span></span></td>
      <td data-label="Monthly spend">{formatAmount(recommendation.monthly_charges)}<span className="cell-note">{formatPercent(recommendation.monthly_spend_percentile)} percentile</span></td>
      <td data-label="Historical spend">{formatAmount(recommendation.total_charges)}<span className="cell-note">{formatPercent(recommendation.historical_spend_percentile)} percentile</span></td>
      <td data-label="Value index"><strong>{formatPercent(recommendation.value_index)}</strong><span className="cell-note">Spend-derived proxy</span></td>
      <td data-label="Priority"><strong className="priority-value">{formatPriority(recommendation.priority_score)}</strong><span className="cell-note">Campaign priority</span></td>
      <td data-label="Recommendation"><RecommendationState recommendation={recommendation} /></td>
    </>
  );
}
