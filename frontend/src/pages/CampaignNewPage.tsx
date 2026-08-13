import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";

import { ApiError } from "../api/customers";
import { createCampaign } from "../api/campaigns";
import "../features/campaigns/campaigns.css";

function idempotencyKey() {
  return typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `campaign-create-${Date.now()}`;
}

function actionMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return "The campaign could not be created. Your entries are still here.";
  if (error.status === 0) return "The local API could not be reached. Your entries are still here.";
  if (["campaign_conflict", "duplicate_campaign_name", "conflict"].includes(error.problem.code ?? "")) return "A campaign with that name already exists. Choose a different name.";
  if (["validation_error", "validation_failed", "campaign_invalid", "campaign_capacity_exceeded"].includes(error.problem.code ?? "")) return error.message;
  return error.message || "The campaign could not be created. Try again.";
}

export function CampaignNewPage() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [capacity, setCapacity] = useState("25");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [creationKey, setCreationKey] = useState<string | null>(null);

  function validate(): string {
    const trimmed = name.trim();
    if (!trimmed) return "Enter a campaign name.";
    if (trimmed.length > 120) return "Campaign names must be 120 characters or fewer.";
    if (!/^\d+$/.test(capacity.trim()) || Number(capacity) < 1) return "Capacity must be a positive whole number.";
    return "";
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const validation = validate();
    if (validation) {
      setError(validation);
      return;
    }
    setBusy(true);
    setError("");
    const key = creationKey ?? idempotencyKey();
    setCreationKey(key);
    try {
      const campaign = await createCampaign({ name: name.trim(), capacity: Number(capacity) }, key);
      setCreationKey(null);
      navigate(`/campaigns/${encodeURIComponent(campaign.campaign_id)}`);
    } catch (reason) {
      setError(actionMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="page-stack campaign-new-page" aria-labelledby="new-campaign-title">
      <div className="page-heading"><p className="eyebrow">Campaign workbench</p><h1 id="new-campaign-title">New campaign</h1><p className="page-description">Give the review list a clear name and a maximum size. Optimization will create a snapshot; it will not contact customers.</p></div>
      <div className={`form-summary ${error ? "form-summary-visible" : ""}`} role="alert" aria-live="polite">{error && <p>{error}</p>}</div>
      <form className="campaign-new-form" onSubmit={handleSubmit} noValidate>
        <div className="section-heading"><p className="eyebrow">Draft setup</p><h2>Campaign boundaries</h2><p>Capacity is the maximum number of customers that can be confirmed for this campaign. You can edit both fields while the campaign is still a draft.</p></div>
        <label className="form-field" htmlFor="campaign-name"><span>Campaign name <span aria-hidden="true">*</span></span><input id="campaign-name" name="name" required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. August retention review" /><small>Use 1–120 characters that make the review purpose easy to recognize.</small></label>
        <label className="form-field" htmlFor="campaign-capacity"><span>Customer capacity <span aria-hidden="true">*</span></span><input id="campaign-capacity" name="capacity" required min={1} step={1} inputMode="numeric" type="number" value={capacity} onChange={(event) => setCapacity(event.target.value)} /><small>A positive whole number. This is a planning limit, not an automatic contact count.</small></label>
        <div className="campaign-new-guidance"><strong>What happens next</strong><ol><li>Optimization checks eligible, freshly scored active customers.</li><li>The workbench shows risk score, spending-derived value, and campaign priority.</li><li>You can record reasoned overrides, then confirm the final list explicitly.</li></ol></div>
        <div className="form-actions"><Link className="button-link button-secondary" to="/campaigns">Cancel</Link><button type="submit" disabled={busy}>{busy ? "Creating draft…" : "Create draft campaign"}</button></div>
      </form>
    </section>
  );
}
