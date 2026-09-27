import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
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
import {
  formatDate,
  CampaignCapacityMeter,
  CampaignErrorState,
  CampaignFormula,
  CampaignStatusBadge,
  RecommendationRowValues,
  formatPriority,
  proposedCampaignCustomerIds,
  proposedCampaignSelectionCount,
  EmptyState,
  Icon,
  LoadingState,
  Notice,
  PageHeader,
  Pagination,
  SectionHeading,
} from "../components/index";

import { useAssistant } from "../features/chat/AssistantContext";

import "../features/campaigns/campaigns.css";
import { OutreachPanel } from "../components/organisms/OutreachPanel";

type BusyAction = "save" | "optimize" | "override" | "remove-override" | "confirm" | "archive" | null;

function idempotencyKey() {
  return typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `campaign-confirm-${Date.now()}`;
}

function actionMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return "The campaign action could not be completed. The latest saved state is still available.";
  if (error.status === 0) return "Campaign services could not be reached. The latest saved state is still available.";
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
  const { openAssistant } = useAssistant();
  const [busy, setBusy] = useState<BusyAction>(null);
  const [error, setError] = useState("");
  const [editOpen, setEditOpen] = useState(false);
  const [editName, setEditName] = useState("");
  const [editCapacity, setEditCapacity] = useState("");
  const [editHorizon, setEditHorizon] = useState("");
  const [editCost, setEditCost] = useState("");
  const [reoptimizePrompt, setReoptimizePrompt] = useState(false);
  const [overrideTarget, setOverrideTarget] = useState<{ customerId: string; action: CampaignOverrideAction } | null>(null);
  const [overrideReason, setOverrideReason] = useState("");
  const [replacementCustomerId, setReplacementCustomerId] = useState("");
  const [confirmChecked, setConfirmChecked] = useState(false);
  const [reviewPage, setReviewPage] = useState(1);
  const [reviewFilter, setReviewFilter] = useState<"all" | "proposed" | "not_proposed" | "overrides">("all");
  const [reviewSearch, setReviewSearch] = useState("");
  const overrideRef = useRef<HTMLFormElement>(null);
  const [confirmationKey, setConfirmationKey] = useState<string | null>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);

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
    setEditHorizon(String(campaignData.value_horizon_months));
    setEditCost(String(campaignData.contact_cost_per_customer));
  }, [campaignData, editOpen]);

  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  const proposedCustomerIds = useMemo(
    () => (campaignData ? proposedCampaignCustomerIds(campaignData) : new Set<string>()),
    [campaignData],
  );
  const replacementOptions = useMemo(
    () => campaignData?.recommendations.filter((item) => proposedCustomerIds.has(item.customer_id) && item.customer_id !== overrideTarget?.customerId) ?? [],
    [campaignData, overrideTarget?.customerId, proposedCustomerIds],
  );

  if (campaignQuery.isPending) {
    return <section className="page-stack campaign-detail-page" aria-labelledby="campaign-detail-title"><DetailHeader /><div className="panel"><LoadingState label="Loading campaign snapshot…" rows={5} /></div></section>;
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
  const reviewPageSize = 25;
  const searchTerm = reviewSearch.trim().toLowerCase();
  const filteredRecommendations = campaign.recommendations.filter((item) => {
    if (searchTerm && !item.customer_id.toLowerCase().includes(searchTerm)) return false;
    if (reviewFilter === "proposed") return proposedCustomerIds.has(item.customer_id);
    if (reviewFilter === "not_proposed") return !proposedCustomerIds.has(item.customer_id);
    if (reviewFilter === "overrides") return item.override || item.selection_state === "excluded" || item.selection_state === "override";
    return true;
  });
  const reviewPageCount = Math.max(1, Math.ceil(filteredRecommendations.length / reviewPageSize));
  const currentReviewPage = Math.min(reviewPage, reviewPageCount);
  const visibleRecommendations = filteredRecommendations.slice((currentReviewPage - 1) * reviewPageSize, currentReviewPage * reviewPageSize);

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
    if (!/^\d+$/.test(editHorizon.trim()) || Number(editHorizon) < 1 || Number(editHorizon) > 24 || !editCost.trim() || !Number.isFinite(Number(editCost)) || Number(editCost) < 0 || Number(editCost) > 1000000) {
      setError("Use a 1–24 month horizon and a nonnegative contact cost up to 1,000,000.");
      return;
    }
    setBusy("save");
    setError("");
    try {
      await updateCampaign(campaign.campaign_id, { name, capacity, value_horizon_months: Number(editHorizon), contact_cost_per_customer: Number(editCost) }, campaign.version);
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
    window.setTimeout(() => {
      overrideRef.current?.scrollIntoView?.({ behavior: "smooth", block: "center" });
      overrideRef.current?.querySelector<HTMLElement>("select, textarea")?.focus({ preventScroll: true });
    }, 0);
  }

  const lifecycle: Array<{ key: Campaign["status"]; label: string }> = [
    { key: "draft", label: "Draft" },
    { key: "optimized", label: "Optimized" },
    { key: "confirmed", label: "Confirmed" },
    { key: "archived", label: "Archived" },
  ];
  const lifecycleIndex = lifecycle.findIndex((item) => item.key === campaign.status);
  const readOnly = isTerminal(campaign);

  const recommendationsSection = campaign.status !== "draft" && (
    <section className="panel campaign-review" aria-labelledby="campaign-review-title">
      <SectionHeading
        eyebrow={readOnly ? "Preserved snapshot" : "Ranked review"}
        title="Recommendations"
        id="campaign-review-title"
      >
        {campaign.recommendations.length ? `${campaign.recommendations.length.toLocaleString()} snapshot rows ranked by priority. Risk score, spend-derived value, and priority are separate signals.` : "The optimization snapshot has no recommendation rows."}
      </SectionHeading>
      {campaign.recommendations.length === 0 ? (
        <EmptyState compact icon="search" title="No eligible recommendations"><p>There is no customer row to review in this snapshot. A later optimization may produce a different result.</p></EmptyState>
      ) : (
        <>
          <div className="table-controls">
            <label className="field field-inline">
              <span className="field-label">Find customer</span>
              <span className="input-with-icon"><Icon name="search" size={16} /><input type="search" value={reviewSearch} onChange={(event) => { setReviewSearch(event.target.value); setReviewPage(1); }} placeholder="Customer ID" autoComplete="off" /></span>
            </label>
            <div className="segmented" role="group" aria-label="Show recommendations">
              {([
                ["all", "All"],
                ["proposed", readOnly ? "Selected" : "Proposed"],
                ["not_proposed", readOnly ? "Not selected" : "Not proposed"],
                ["overrides", "Overrides"],
              ] as const).map(([value, label]) => (
                <button key={value} type="button" aria-pressed={reviewFilter === value} onClick={() => { setReviewFilter(value); setReviewPage(1); }}>{label}</button>
              ))}
            </div>
          </div>
          {filteredRecommendations.length === 0 ? (
            <EmptyState compact icon="search" title="No recommendations match this view"><p>Change the filter or clear the search.</p></EmptyState>
          ) : (
            <div className="table-frame">
              <div className="table-scroll" tabIndex={0} role="region" aria-label="Recommendations table">
                <table className="data-table campaign-table recommendation-table">
                  <caption className="sr-only">Ranked campaign recommendations</caption>
                  <thead><tr><th scope="col" className="num">Rank</th><th scope="col">Customer</th><th scope="col">Risk score</th><th scope="col" className="num">Monthly spend</th><th scope="col" className="num">Historical spend</th><th scope="col" className="num">Value index</th><th scope="col" className="num">Priority</th><th scope="col">Recommendation</th>{canOverride && <th scope="col">Review</th>}</tr></thead>
                  <tbody>{visibleRecommendations.map((recommendation) => {
                    const canAct = canOverride && !readOnly;
                    const hasActiveOverride = recommendation.override || recommendation.selection_state === "excluded" || recommendation.selection_state === "override";
                    const inProposal = proposedCustomerIds.has(recommendation.customer_id);
                    const isTarget = overrideTarget?.customerId === recommendation.customer_id;
                    return <tr key={recommendation.recommendation_id} className={`${inProposal ? "row-proposed" : ""}${isTarget ? " row-targeted" : ""}`}>
                      <td data-label="Rank" className="num rank-cell">#{recommendation.rank}</td>
                      <th scope="row" data-label="Customer"><Link className="record-link" to={`/customers/${encodeURIComponent(recommendation.customer_id)}`}>{recommendation.customer_id}</Link><span className="cell-note">{recommendation.model_version ? `Model ${recommendation.model_version}` : "Model version unavailable"}</span></th>
                      <RecommendationRowValues recommendation={recommendation} />
                      {canOverride && <td data-label="Review" className="action-cell">
                        {canAct && !hasActiveOverride && recommendation.recommended && <button type="button" className="button-secondary button-small" onClick={() => openOverride(recommendation, "exclude")}>Exclude</button>}
                        {canAct && !hasActiveOverride && !recommendation.recommended && <button type="button" className="button-secondary button-small" onClick={() => openOverride(recommendation, "include")}>Include override</button>}
                        {hasActiveOverride && <span className="cell-note">See override history</span>}
                      </td>}
                    </tr>;
                  })}</tbody>
                </table>
              </div>
            </div>
          )}
          <Pagination label="Recommendation pages" page={currentReviewPage} pageCount={reviewPageCount} onPage={setReviewPage} total={filteredRecommendations.length} pageSize={reviewPageSize} itemLabel="recommendations" />
        </>
      )}
    </section>
  );

  const overridesSection = campaign.overrides.length > 0 && (
    <section className="panel campaign-overrides" aria-labelledby="campaign-overrides-title">
      <SectionHeading eyebrow="Decision history" title="Overrides" id="campaign-overrides-title">Each change keeps the customer, action, reason, and time visible for review. Overrides never change model scores.</SectionHeading>
      <ol className="override-list">{campaign.overrides.map((override) => <li key={override.override_id}>
        <span className={`override-icon override-icon-${override.action}`} aria-hidden="true"><Icon name={override.action === "include" ? "plus" : "x"} size={16} /></span>
        <div className="override-body">
          <div className="override-head"><strong>{override.action === "include" ? "Included override" : "Excluded recommendation"}</strong><Link className="record-link" to={`/customers/${encodeURIComponent(override.customer_id)}`}>{override.customer_id}</Link>{override.replacement_customer_id && <span className="cell-note">replacing {override.replacement_customer_id}</span>}</div>
          <p>{override.reason}</p>
          <span className="cell-note">{formatDate(override.created_at)}</span>
        </div>
        {canOverride && <button type="button" className="text-button" disabled={busy !== null} onClick={() => void removeOverride(override.override_id)}>Remove<span className="sr-only"> override for {override.customer_id}</span></button>}
      </li>)}</ol>
    </section>
  );

  return (
    <section className="page-stack campaign-detail-page" aria-labelledby="campaign-detail-title">
      <DetailHeader
        campaign={campaign}
        actions={<>
          <Link className="button-link button-ghost" to="/campaigns"><Icon name="arrowLeft" size={18} />Back to campaigns</Link>
          <button type="button" className="button-secondary" aria-controls="assistant-panel" onClick={() => openAssistant({ campaign_id: campaign.campaign_id })}><Icon name="chat" size={18} />Ask assistant</button>
          {campaign.status === "confirmed" && <button type="button" className="button-secondary" disabled={busy !== null} onClick={() => void archive()}><Icon name="archive" size={18} />{busy === "archive" ? "Archiving…" : "Archive campaign"}</button>}
          {canOptimize && <button type="button" disabled={busy !== null} onClick={() => { if (campaign.status === "optimized" && campaign.optimization) setReoptimizePrompt(true); else void runOptimization(); }}><Icon name="refresh" size={18} />{busy === "optimize" ? "Optimizing…" : campaign.status === "optimized" ? "Re-optimize" : "Run optimization"}</button>}
        </>}
      />

      <ol className="lifecycle" aria-label="Campaign lifecycle">
        {lifecycle.map((item, index) => {
          const state = index < lifecycleIndex ? "is-done" : index === lifecycleIndex ? "is-current" : undefined;
          return <li key={item.key} className={state} aria-current={index === lifecycleIndex ? "step" : undefined}><span className="lifecycle-dot" aria-hidden="true">{index < lifecycleIndex ? <Icon name="check" size={12} /> : null}</span>{item.label}</li>;
        })}
      </ol>

      {reoptimizePrompt && <Notice tone="warning" role="alert" title="Replace the current optimization snapshot?" actions={<><button type="button" className="button-small" disabled={busy !== null} onClick={() => void runOptimization(true)}>Replace snapshot</button><button type="button" className="button-secondary button-small" onClick={() => setReoptimizePrompt(false)}>Keep current snapshot</button></>}>Re-optimization recalculates the ranked recommendations against a new database snapshot and clears unconfirmed overrides.</Notice>}
      {error && <p ref={errorRef} tabIndex={-1} className="notice notice-danger notice-inline" role="alert"><Icon name="alert" size={18} className="notice-icon" />{error}</p>}

      {campaign.status === "confirmed" && <Notice tone="success" role="status" title="Campaign confirmed.">The final selection is preserved as an immutable snapshot{campaign.confirmed_at ? ` (${formatDate(campaign.confirmed_at)})` : ""}. No automatic outreach was sent — record contact outcomes manually below.</Notice>}
      {campaign.status === "archived" && <Notice tone="neutral" role="status" title="Campaign archived.">The queue, history, and estimate stay readable. Editing and new outcome entry are unavailable. Archived campaigns are hidden from the default campaign list.</Notice>}

      {readOnly && <OutreachPanel campaignId={campaign.campaign_id} archived={campaign.status === "archived"} />}

      <div className="campaign-overview-grid">
        <CampaignCapacityMeter campaign={campaign} />
        <section className="panel settings-panel" aria-labelledby="settings-title">
          <div className="panel-heading">
            <div><p className="eyebrow">{canEdit ? "Draft settings" : "Settings"}</p><h2 id="settings-title">Campaign assumptions</h2></div>
            {canEdit && <button type="button" className="button-secondary button-small" onClick={() => setEditOpen((current) => !current)} aria-expanded={editOpen}><Icon name="edit" size={16} />{editOpen ? "Close edit" : "Edit draft"}</button>}
          </div>
          {editOpen && canEdit ? (
            <form className="campaign-edit-form" onSubmit={saveDraft}>
              <p className="section-heading-text">Changing these values does not optimize the list. Run optimization when you are ready.</p>
              <div className="field-grid field-grid-2">
                <label className="field" htmlFor="edit-campaign-name"><span className="field-label">Campaign name</span><input id="edit-campaign-name" value={editName} maxLength={120} onChange={(event) => setEditName(event.target.value)} /></label>
                <label className="field" htmlFor="edit-campaign-capacity"><span className="field-label">Customer capacity</span><input id="edit-campaign-capacity" type="number" min={1} step={1} inputMode="numeric" value={editCapacity} onChange={(event) => setEditCapacity(event.target.value)} /></label>
                <label className="field" htmlFor="edit-horizon"><span className="field-label">Value horizon (months)</span><input id="edit-horizon" type="number" min={1} max={24} step={1} value={editHorizon} onChange={(event) => setEditHorizon(event.target.value)} /></label>
                <label className="field" htmlFor="edit-cost"><span className="field-label">Cost per contacted customer (dataset currency units)</span><input id="edit-cost" type="number" min={0} max={1000000} step="0.01" value={editCost} onChange={(event) => setEditCost(event.target.value)} /></label>
              </div>
              <div className="button-row"><button type="button" className="button-secondary" onClick={() => setEditOpen(false)}>Cancel</button><button type="submit" disabled={busy !== null}>{busy === "save" ? "Saving draft…" : "Save draft"}</button></div>
            </form>
          ) : (
            <dl className="meta-list">
              <div><dt>Customer capacity</dt><dd>{campaign.capacity.toLocaleString()}</dd></div>
              <div><dt>Value horizon</dt><dd>{campaign.value_horizon_months} months</dd></div>
              <div><dt>Cost per contacted customer</dt><dd>{campaign.contact_cost_per_customer.toFixed(2)} dataset currency units</dd></div>
              <div><dt>Created</dt><dd>{formatDate(campaign.created_at)}</dd></div>
              {campaign.confirmed_at && <div><dt>Confirmed</dt><dd>{formatDate(campaign.confirmed_at)}</dd></div>}
            </dl>
          )}
        </section>
      </div>

      {campaign.status === "draft" && (
        <div className="panel">
          <EmptyState
            icon="target"
            eyebrow="No optimization snapshot"
            title="Run optimization when the draft boundaries are ready"
            actions={<button type="button" disabled={busy !== null} onClick={() => void runOptimization()}><Icon name="refresh" size={18} />{busy === "optimize" ? "Optimizing…" : "Run optimization"}</button>}
          >
            <p>Optimization reads a consistent customer snapshot and creates ranked recommendations up to the capacity of {campaign.capacity.toLocaleString()}. It does not select or contact anyone.</p>
          </EmptyState>
        </div>
      )}

      <CampaignFormula campaign={campaign} />

      {recommendationsSection}

      {overrideTarget && canOverride && (
        <form ref={overrideRef} className="panel override-form" onSubmit={submitOverride} aria-labelledby="override-title">
          <SectionHeading eyebrow="Human override" title={overrideTarget.action === "include" ? "Include a below-threshold customer" : "Exclude a recommendation"} id="override-title">
            Customer <strong className="record-id">{overrideTarget.customerId}</strong> will be recorded with an explicit reason. This does not change the model score.
          </SectionHeading>
          {overrideTarget.action === "include" && proposedSelectionCount >= campaign.capacity && (
            <label className="field" htmlFor="replacement-customer">
              <span className="field-label">Replace a proposed customer <span className="field-required" aria-hidden="true">*</span></span>
              <select id="replacement-customer" required value={replacementCustomerId} onChange={(event) => setReplacementCustomerId(event.target.value)}><option value="">Choose one…</option>{replacementOptions.map((item) => <option key={item.customer_id} value={item.customer_id}>{item.customer_id} · priority {formatPriority(item.priority_score)}</option>)}</select>
              <small className="field-hint">Capacity is full, so including this customer removes one proposed customer.</small>
            </label>
          )}
          <label className="field" htmlFor="override-reason">
            <span className="field-label">Reason <span className="field-required" aria-hidden="true">*</span></span>
            <textarea id="override-reason" required minLength={5} maxLength={500} value={overrideReason} onChange={(event) => setOverrideReason(event.target.value)} placeholder="Explain the business reason for this decision." />
            <small className="field-hint">{overrideReason.length}/500 characters · minimum 5</small>
          </label>
          <div className="button-row"><button type="button" className="button-secondary" onClick={() => setOverrideTarget(null)}>Cancel</button><button type="submit" disabled={busy !== null}>{busy === "override" ? "Recording override…" : "Record override"}</button></div>
        </form>
      )}

      {overridesSection}

      {campaign.status === "optimized" && (
        <section className="panel campaign-confirm-panel" aria-labelledby="campaign-confirm-title">
          <SectionHeading eyebrow="Explicit confirmation" title="Confirm selected outreach list" id="campaign-confirm-title">Confirmation preserves this snapshot and records the {proposedSelectionCount.toLocaleString()} selected customer{proposedSelectionCount === 1 ? "" : "s"}. It does not send email, SMS, or calls, or launch an external campaign.</SectionHeading>
          <label className="acknowledge"><input type="checkbox" checked={confirmChecked} onChange={(event) => setConfirmChecked(event.target.checked)} /><span>I reviewed the ranked recommendations and overrides, and I confirm this list for the stated capacity.</span></label>
          <div className="confirm-bar">
            <div>
              <strong>{proposedSelectionCount.toLocaleString()} of {campaign.capacity.toLocaleString()} capacity</strong>
              {!hasSelection && <p className="field-hint">There are no recommendations to confirm in this snapshot.</p>}
              {proposedSelectionCount > campaign.capacity && <p className="field-error">Selection is above capacity. Resolve the list before confirming.</p>}
              {hasSelection && proposedSelectionCount <= campaign.capacity && <p>After confirmation the list can no longer be changed.</p>}
            </div>
            <button type="button" disabled={!canConfirm || busy !== null || !hasSelection} onClick={() => void confirmSelection()}>{busy === "confirm" ? "Confirming…" : "Confirm campaign"}</button>
          </div>
        </section>
      )}
    </section>
  );
}

function DetailHeader({ campaign, actions }: { campaign?: Campaign; actions?: ReactNode }) {
  return (
    <PageHeader
      titleId="campaign-detail-title"
      crumbs={[{ label: "Overview", to: "/" }, { label: "Campaigns", to: "/campaigns" }, { label: campaign?.name ?? "Campaign" }]}
      eyebrow="Campaign workbench"
      title="Campaign details"
      meta={campaign ? <>
        <p className="entity-title">{campaign.name}</p>
        <CampaignStatusBadge status={campaign.status} />
        <span className="meta-item">Version {campaign.version}</span>
        <span className="meta-item">Updated {formatDate(campaign.updated_at || campaign.created_at)}</span>
      </> : undefined}
      actions={actions}
    />
  );
}
