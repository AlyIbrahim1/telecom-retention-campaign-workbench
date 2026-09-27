import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";

import { ApiError } from "../api/customers";
import { createCampaign } from "../api/campaigns";
import { Icon, PageHeader, SectionHeading } from "../components/index";
import "../features/campaigns/campaigns.css";

function idempotencyKey() {
  return typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `campaign-create-${Date.now()}`;
}

function actionMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return "The campaign could not be created. Your entries are still here.";
  if (error.status === 0) return "Campaign services could not be reached. Your entries are still here.";
  if (["campaign_conflict", "duplicate_campaign_name", "conflict"].includes(error.problem.code ?? "")) return "A campaign with that name already exists. Choose a different name.";
  if (["validation_error", "validation_failed", "campaign_invalid", "campaign_capacity_exceeded"].includes(error.problem.code ?? "")) return error.message;
  return error.message || "The campaign could not be created. Try again.";
}

export function CampaignNewPage() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [capacity, setCapacity] = useState("25");
  const [valueHorizon, setValueHorizon] = useState("3");
  const [contactCost, setContactCost] = useState("5");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [creationKey, setCreationKey] = useState<string | null>(null);
  const summaryRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (error) summaryRef.current?.focus();
  }, [error]);

  function validate(): string {
    const trimmed = name.trim();
    if (!trimmed) return "Enter a campaign name.";
    if (trimmed.length > 120) return "Campaign names must be 120 characters or fewer.";
    if (!/^\d+$/.test(capacity.trim()) || Number(capacity) < 1) return "Capacity must be a positive whole number.";
    if (!/^\d+$/.test(valueHorizon) || Number(valueHorizon) < 1 || Number(valueHorizon) > 24) return "Value horizon must be 1–24 months.";
    if (!contactCost.trim() || !Number.isFinite(Number(contactCost)) || Number(contactCost) < 0 || Number(contactCost) > 1000000) return "Contact cost must be between 0 and 1,000,000.";
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
      const campaign = await createCampaign({ name: name.trim(), capacity: Number(capacity), value_horizon_months: Number(valueHorizon), contact_cost_per_customer: Number(contactCost) }, key);
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
      <PageHeader
        titleId="new-campaign-title"
        crumbs={[{ label: "Overview", to: "/" }, { label: "Campaigns", to: "/campaigns" }, { label: "New campaign" }]}
        eyebrow="Campaign workbench"
        title="New campaign"
        description="Give the review list a clear name, a maximum size, and the assumptions used for its illustrative estimate. Creating a draft does not contact anyone."
      />
      <div ref={summaryRef} tabIndex={-1} className={`form-summary${error ? " form-summary-visible" : ""}`} role="alert" aria-live="assertive">{error && <p><Icon name="alert" size={18} />{error}</p>}</div>
      <div className="split-layout">
        <form className="panel campaign-new-form" onSubmit={handleSubmit} noValidate aria-busy={busy}>
          <SectionHeading eyebrow="Draft setup" title="Campaign boundaries">Capacity is the maximum number of customers that can be confirmed. You can edit every field while the campaign is still a draft.</SectionHeading>
          <label className="field" htmlFor="campaign-name"><span className="field-label">Campaign name <span className="field-required" aria-hidden="true">*</span></span><input id="campaign-name" name="name" required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. August retention review" autoComplete="off" /><small className="field-hint">1–120 characters that make the review purpose easy to recognize.</small></label>
          <label className="field" htmlFor="campaign-capacity"><span className="field-label">Customer capacity <span className="field-required" aria-hidden="true">*</span></span><input id="campaign-capacity" name="capacity" required min={1} step={1} inputMode="numeric" type="number" value={capacity} onChange={(event) => setCapacity(event.target.value)} /><small className="field-hint">A positive whole number. This is a planning limit, not an automatic contact count.</small></label>
          <fieldset className="subfieldset">
            <legend>Estimate assumptions</legend>
            <div className="field-grid field-grid-2">
              <label className="field" htmlFor="campaign-horizon"><span className="field-label">Value horizon (months)</span><input id="campaign-horizon" type="number" min={1} max={24} step={1} value={valueHorizon} onChange={(event) => setValueHorizon(event.target.value)} /><small className="field-hint">1–24 months. Default 3.</small></label>
              <label className="field" htmlFor="campaign-contact-cost"><span className="field-label">Cost per contacted customer (dataset currency units)</span><input id="campaign-contact-cost" type="number" min={0} max={1000000} step="0.01" value={contactCost} onChange={(event) => setContactCost(event.target.value)} /><small className="field-hint">Default 5. Used only for the illustrative estimate.</small></label>
            </div>
          </fieldset>
          <div className="form-footer"><Link className="button-link button-secondary" to="/campaigns">Cancel</Link><button type="submit" disabled={busy}>{busy ? <><span className="spinner" aria-hidden="true" />Creating draft…</> : "Create draft campaign"}</button></div>
        </form>
        <aside className="panel guidance-panel" aria-labelledby="next-steps-title">
          <p className="eyebrow">What happens next</p>
          <h2 id="next-steps-title">Three explicit steps</h2>
          <ol className="numbered-steps">
            <li><strong>Optimize</strong><span>Rank eligible, freshly scored active customers by risk and relative spend, within capacity.</span></li>
            <li><strong>Review and override</strong><span>Inspect risk score, spend-derived value, and priority. Exclude or include customers with a recorded reason.</span></li>
            <li><strong>Confirm explicitly</strong><span>Tick the confirmation statement to freeze the list. Nothing is sent — outcomes are entered by hand afterwards.</span></li>
          </ol>
          <p className="decision-note"><Icon name="info" size={16} /><span>The horizon and contact cost only feed an illustrative estimate. They are not a forecast of realized savings.</span></p>
        </aside>
      </div>
    </section>
  );
}
