import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";

import { ApiError } from "../api/customers";
import {
  addCampaignOverride,
  archiveCampaign,
  confirmCampaign,
  getCampaign,
  optimizeCampaign,
  removeCampaignOverride,
  updateCampaign,
  type Campaign,
  type CampaignOverrideAction,
  type CampaignRecommendation,
} from "../api/campaigns";
import { formatDate } from "../features/customers/CustomerBits";
import {
  CampaignCapacityMeter,
  CampaignErrorState,
  CampaignFormula,
  CampaignStatusBadge,
  RecommendationRowValues,
  formatPriority,
  proposedCampaignCustomerIds,
  proposedCampaignSelectionCount,
} from "../features/campaigns/CampaignBits";
import "../features/campaigns/campaigns.css";

type BusyAction = "save" | "optimize" | "override" | "remove-override" | "confirm" | "archive" | null;

function idempotencyKey() {
  return typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `campaign-confirm-${Date.now()}`;
}

function actionMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return "The campaign action could not be completed. The latest saved state is still available.";
  if (error.status === 0) return "The local API could not be reached. The latest saved state is still available.";
  if (error.problem.code === "campaign_capacity_exceeded") return "Capacity would be exceeded. Exclude or replace a selected customer before including another.";
  if (error.problem.code === "campaign_reoptimization_confirmation_required") return "Re-optimization needs an explicit acknowledgement because it replaces the current draft snapshot.";
  if (error.problem.code === "campaign_not_optimized") return "Optimize the campaign before reviewing or confirming recommendations.";
  if (error.problem.code === "conflict" || error.problem.code === "campaign_version_conflict") return "This campaign changed elsewhere. Refresh the latest state before trying that action again.";
  return error.message || "The campaign action could not be completed.";
}

function isTerminal(campaign: Campaign): boolean {
  return campaign.status === "confirmed" || campaign.status === "archived";
}

export function CampaignDetailPage() {
  const { campaignId } = useParams<{ campaignId: string }>();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<BusyAction>(null);
  const [error, setError] = useState("");
  const [editOpen, setEditOpen] = useState(false);
  const [editName, setEditName] = useState("");
  const [editCapacity, setEditCapacity] = useState("");
  const [reoptimizePrompt, setReoptimizePrompt] = useState(false);
  const [overrideTarget, setOverrideTarget] = useState<{ customerId: string; action: CampaignOverrideAction } | null>(null);
  const [overrideReason, setOverrideReason] = useState("");
  const [replacementCustomerId, setReplacementCustomerId] = useState("");
  const [confirmChecked, setConfirmChecked] = useState(false);
  const [confirmationKey, setConfirmationKey] = useState<string | null>(null);

  const campaignQuery = useQuery({
    queryKey: ["campaign", campaignId],
    queryFn: () => getCampaign(campaignId ?? ""),
    enabled: Boolean(campaignId),
  });

  const campaignData = campaignQuery.data;
  useEffect(() => {
    if (!campaignData || editOpen) return;
    setEditName(campaignData.name);
    setEditCapacity(String(campaignData.capacity));
  }, [campaignData, editOpen]);

  const proposedCustomerIds = useMemo(
    () => (campaignData ? proposedCampaignCustomerIds(campaignData) : new Set<string>()),
    [campaignData],
  );
  const replacementOptions = useMemo(
    () => campaignData?.recommendations.filter((item) => proposedCustomerIds.has(item.customer_id) && item.customer_id !== overrideTarget?.customerId) ?? [],
    [campaignData, overrideTarget?.customerId, proposedCustomerIds],
  );

  if (campaignQuery.isPending) {
    return <section className="page-stack campaign-detail-page" aria-labelledby="campaign-detail-title"><DetailHeader campaignId={campaignId} /><div className="loading-panel" role="status">Loading campaign snapshot…</div></section>;
  }
  if (campaignQuery.isError || !campaignData) {
    const notFound = campaignQuery.error instanceof ApiError && campaignQuery.error.status === 404;
    return <CampaignErrorState title="Campaign details" message={notFound ? "That campaign could not be found." : "Campaign details could not be loaded. Try again when the API is ready."} retry={() => campaignQuery.refetch()} />;
  }

  const campaign: Campaign = campaignData;
  const canEdit = campaign.status === "draft";
  const canOptimize = campaign.status === "draft" || campaign.status === "optimized";
  const canOverride = campaign.status === "optimized";
  const proposedSelectionCount = proposedCampaignSelectionCount(campaign);
  const canConfirm = campaign.status === "optimized" && proposedSelectionCount <= campaign.capacity;
  const hasSelection = proposedSelectionCount > 0;

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ["campaign", campaign.campaign_id] });
    await campaignQuery.refetch();
  }

  async function saveDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = editName.trim();
    const capacity = Number(editCapacity);
    if (!name || name.length > 120) {
      setError("Campaign names must be 1–120 characters.");
      return;
    }
    if (!/^\d+$/.test(editCapacity.trim()) || capacity < 1) {
      setError("Capacity must be a positive whole number.");
      return;
    }
    setBusy("save");
    setError("");
    try {
      await updateCampaign(campaign.campaign_id, { name, capacity }, campaign.version);
      setEditOpen(false);
      await refresh();
    } catch (reason) {
      setError(actionMessage(reason));
    } finally {
      setBusy(null);
    }
  }

  async function runOptimization(acknowledge = false) {
    setBusy("optimize");
    setError("");
    setReoptimizePrompt(false);
    try {
      await optimizeCampaign(campaign.campaign_id, campaign.version, acknowledge);
      await refresh();
    } catch (reason) {
      setError(actionMessage(reason));
    } finally {
      setBusy(null);
    }
  }

  async function submitOverride(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!overrideTarget) return;
    const reason = overrideReason.trim();
    if (reason.length < 5 || reason.length > 500) {
      setError("Override reasons must be 5–500 characters.");
      return;
    }
    if (overrideTarget.action === "include" && proposedSelectionCount >= campaign.capacity && !replacementCustomerId) {
      setError("Capacity is full. Choose a proposed customer to replace before including this override.");
      return;
    }
    setBusy("override");
    setError("");
    try {
      await addCampaignOverride(campaign.campaign_id, {
        customer_id: overrideTarget.customerId,
        action: overrideTarget.action,
        reason,
        ...(replacementCustomerId ? { replacement_customer_id: replacementCustomerId } : {}),
      }, campaign.version);
      setOverrideTarget(null);
      setOverrideReason("");
      setReplacementCustomerId("");
      await refresh();
    } catch (reasonValue) {
      setError(actionMessage(reasonValue));
    } finally {
      setBusy(null);
    }
  }

  async function removeOverride(overrideId: string) {
    setBusy("remove-override");
    setError("");
    try {
      await removeCampaignOverride(campaign.campaign_id, overrideId, campaign.version);
      await refresh();
    } catch (reason) {
      setError(actionMessage(reason));
    } finally {
      setBusy(null);
    }
  }

  async function confirmSelection() {
    if (!confirmChecked) {
      setError("Read and tick the confirmation statement before confirming the campaign.");
      return;
    }
    setBusy("confirm");
    setError("");
    const key = confirmationKey ?? idempotencyKey();
    setConfirmationKey(key);
    try {
      await confirmCampaign(campaign.campaign_id, key, campaign.version);
      setConfirmationKey(null);
      setConfirmChecked(false);
      await refresh();
    } catch (reason) {
      setError(actionMessage(reason));
    } finally {
      setBusy(null);
    }
  }

  async function archive() {
    setBusy("archive");
    setError("");
    try {
      await archiveCampaign(campaign.campaign_id, campaign.version);
      await refresh();
    } catch (reason) {
      setError(actionMessage(reason));
    } finally {
      setBusy(null);
    }
  }

  function openOverride(recommendation: CampaignRecommendation, action: CampaignOverrideAction) {
    setOverrideTarget({ customerId: recommendation.customer_id, action });
    setOverrideReason(recommendation.override_reason ?? "");
    setReplacementCustomerId("");
    setError("");
  }

  return (
    <section className="page-stack campaign-detail-page" aria-labelledby="campaign-detail-title">
      <DetailHeader campaignId={campaign.campaign_id} />
      <div className="campaign-detail-header">
        <div className="campaign-status-line"><h2>{campaign.name}</h2><CampaignStatusBadge status={campaign.status} /><span className="cell-note">Version {campaign.version} · Updated {formatDate(campaign.updated_at || campaign.created_at)}</span></div>
        <div className="campaign-actions"><Link className="button-link button-secondary" to="/campaigns">Back to campaigns</Link><Link className="button-link button-secondary" to={`/chat?campaignId=${encodeURIComponent(campaign.campaign_id)}`}>Ask assistant</Link>{canEdit && <button type="button" className="button-secondary" onClick={() => setEditOpen((current) => !current)}>{editOpen ? "Close edit" : "Edit draft"}</button>}{canOptimize && <button type="button" disabled={busy !== null} onClick={() => { if (campaign.status === "optimized" && campaign.optimization) setReoptimizePrompt(true); else void runOptimization(); }}>{busy === "optimize" ? "Optimizing…" : campaign.status === "optimized" ? "Re-optimize" : "Run optimization"}</button>}{campaign.status === "confirmed" && <button type="button" className="button-secondary" disabled={busy !== null} onClick={() => void archive()}>{busy === "archive" ? "Archiving…" : "Archive campaign"}</button>}</div>
      </div>

      {reoptimizePrompt && <div className="import-alert" role="alert"><strong>Replace the current optimization snapshot?</strong><span>Re-optimization recalculates the ranked recommendations against a new database snapshot and clears unconfirmed overrides.</span><div className="state-actions"><button type="button" disabled={busy !== null} onClick={() => void runOptimization(true)}>Replace snapshot</button><button type="button" className="button-secondary" onClick={() => setReoptimizePrompt(false)}>Keep current snapshot</button></div></div>}
      {error && <p className="import-alert" role="alert">{error}</p>}

      {editOpen && canEdit && <form className="campaign-edit-form" onSubmit={saveDraft}><div className="section-heading"><p className="eyebrow">Draft only</p><h2>Edit campaign boundaries</h2><p>Changing capacity or name does not optimize the list. Run optimization again when you are ready.</p></div><div className="campaign-edit-fields"><label className="form-field" htmlFor="edit-campaign-name"><span>Campaign name</span><input id="edit-campaign-name" value={editName} maxLength={120} onChange={(event) => setEditName(event.target.value)} /></label><label className="form-field" htmlFor="edit-campaign-capacity"><span>Customer capacity</span><input id="edit-campaign-capacity" type="number" min={1} step={1} inputMode="numeric" value={editCapacity} onChange={(event) => setEditCapacity(event.target.value)} /></label></div><div className="form-actions"><button type="submit" disabled={busy !== null}>{busy === "save" ? "Saving draft…" : "Save draft"}</button></div></form>}

      <div className="campaign-overview-grid"><CampaignCapacityMeter campaign={campaign} /><CampaignFormula campaign={campaign} /></div>

      {campaign.status === "draft" && <div className="empty-panel"><p className="eyebrow">No optimization snapshot</p><h2>Run optimization when the draft boundaries are ready</h2><p>Optimization reads a consistent customer snapshot and creates ranked recommendations without changing outreach decisions.</p><button type="button" disabled={busy !== null} onClick={() => void runOptimization()}>{busy === "optimize" ? "Optimizing…" : "Run optimization"}</button></div>}

      {campaign.status !== "draft" && <>
        <section className="campaign-review" aria-labelledby="campaign-review-title"><div className="section-heading"><p className="eyebrow">Ranked review</p><h2 id="campaign-review-title">Recommendations</h2><p>{campaign.recommendations.length ? `${campaign.recommendations.length} snapshot rows. Risk score, spending-derived value, and campaign priority are separate signals.` : "The optimization snapshot has no recommendation rows."}</p></div>{campaign.recommendations.length === 0 ? <div className="empty-inline"><strong>No eligible recommendations</strong><span>There is no customer row to review in this snapshot. A later optimization may produce a different result.</span></div> : <div className="table-scroll"><table className="customer-table campaign-table"><caption className="sr-only">Ranked campaign recommendations</caption><thead><tr><th scope="col">Rank</th><th scope="col">Customer</th><th scope="col">Model score</th><th scope="col">Monthly spend</th><th scope="col">Historical spend</th><th scope="col">Value index</th><th scope="col">Priority</th><th scope="col">Recommendation</th><th scope="col"><span className="sr-only">Review action</span></th></tr></thead><tbody>{campaign.recommendations.map((recommendation) => {
              const canAct = canOverride && !isTerminal(campaign);
              const hasActiveOverride = recommendation.override || recommendation.selection_state === "excluded" || recommendation.selection_state === "override";
              return <tr key={recommendation.recommendation_id}><td data-label="Rank" className="rank-cell">#{recommendation.rank}</td><th scope="row" data-label="Customer" className="customer-cell"><Link to={`/customers/${encodeURIComponent(recommendation.customer_id)}`}>{recommendation.customer_id}</Link><span className="cell-note">{recommendation.model_version ? `Model ${recommendation.model_version}` : "Model version unavailable"}</span></th><RecommendationRowValues recommendation={recommendation} /><td data-label="Review action" className="action-cell">{canAct && !hasActiveOverride && recommendation.recommended && <button type="button" className="button-secondary" onClick={() => openOverride(recommendation, "exclude")}>Exclude</button>}{canAct && !hasActiveOverride && !recommendation.recommended && <button type="button" className="button-secondary" onClick={() => openOverride(recommendation, "include")}>Include override</button>}</td></tr>;
            })}</tbody></table></div>}</section>

        {overrideTarget && canOverride && <form className="override-form" onSubmit={submitOverride} aria-labelledby="override-title"><div className="section-heading"><p className="eyebrow">Human override</p><h2 id="override-title">{overrideTarget.action === "include" ? "Include a below-threshold customer" : "Exclude a recommendation"}</h2><p>Customer <strong className="record-id">{overrideTarget.customerId}</strong> will be recorded with an explicit reason. This does not change the model score.</p></div>{overrideTarget.action === "include" && proposedSelectionCount >= campaign.capacity && <label htmlFor="replacement-customer">Replace a proposed customer<span aria-hidden="true">*</span><select id="replacement-customer" required value={replacementCustomerId} onChange={(event) => setReplacementCustomerId(event.target.value)}><option value="">Choose one…</option>{replacementOptions.map((item) => <option key={item.customer_id} value={item.customer_id}>{item.customer_id} · priority {formatPriority(item.priority_score)}</option>)}</select></label>}<label htmlFor="override-reason">Reason <span aria-hidden="true">*</span><textarea id="override-reason" required minLength={5} maxLength={500} value={overrideReason} onChange={(event) => setOverrideReason(event.target.value)} placeholder="Explain the business reason for this decision." /><small>{overrideReason.length}/500 characters · minimum 5</small></label><div className="form-actions"><button type="submit" disabled={busy !== null}>{busy === "override" ? "Recording override…" : "Record override"}</button><button type="button" className="button-secondary" onClick={() => setOverrideTarget(null)}>Cancel</button></div></form>}

        {campaign.overrides.length > 0 && <section className="campaign-overrides" aria-labelledby="campaign-overrides-title"><div className="section-heading"><p className="eyebrow">Decision history</p><h2 id="campaign-overrides-title">Overrides</h2><p>Each change keeps the customer, action, reason, and timestamp visible for review.</p></div><ul className="override-list">{campaign.overrides.map((override) => <li key={override.override_id}><div><strong>{override.action === "include" ? "Included override" : "Excluded recommendation"}</strong><span className="cell-note">{override.customer_id}</span></div><p>{override.reason}</p><div>{formatDate(override.created_at)}{canOverride && <button type="button" className="text-button" disabled={busy !== null} onClick={() => void removeOverride(override.override_id)}>Remove</button>}</div></li>)}</ul></section>}

        {campaign.status === "optimized" && <section className="campaign-confirm-panel" aria-labelledby="campaign-confirm-title"><div className="section-heading"><p className="eyebrow">Explicit confirmation</p><h2 id="campaign-confirm-title">Confirm selected outreach list</h2><p>Confirmation preserves this campaign snapshot and records the selected customers. It does not send email, SMS, calls, or launch an external campaign.</p></div><label><input type="checkbox" checked={confirmChecked} onChange={(event) => setConfirmChecked(event.target.checked)} /> <span>I reviewed the ranked recommendations and overrides, and I confirm this list for the stated capacity.</span></label><button type="button" disabled={!canConfirm || busy !== null || !hasSelection} onClick={() => void confirmSelection()}>{busy === "confirm" ? "Confirming…" : "Confirm campaign"}</button>{!hasSelection && <small>There are no recommendations to confirm in this snapshot.</small>}{proposedSelectionCount > campaign.capacity && <small>Selection is above capacity. Resolve the list before confirming.</small>}</section>}
        {campaign.status === "confirmed" && <div className="success-message" role="status"><strong>Campaign confirmed.</strong><span>The final selection is preserved as an immutable review snapshot. No automatic outreach was sent.</span></div>}
        {campaign.status === "archived" && <div className="warning-panel" role="status"><strong>Campaign archived.</strong><span>Archived campaigns are hidden from the default campaign list and remain available in the archived view.</span></div>}
      </>}
    </section>
  );
}

function DetailHeader({ campaignId }: { campaignId?: string }) {
  return <div className="page-heading"><p className="eyebrow">Campaign workbench</p><h1 id="campaign-detail-title">Campaign details</h1><p className="page-description">Inspect the ranking snapshot, keep risk and value distinct, and record a human decision. <strong className="record-id">{campaignId ?? "Campaign"}</strong></p></div>;
}
