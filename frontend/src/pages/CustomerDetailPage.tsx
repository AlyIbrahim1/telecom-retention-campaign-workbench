import { useQuery } from "@tanstack/react-query";
import { Link, useLocation, useParams } from "react-router-dom";

import { ApiError, getCustomer, type CustomerDetail, type CustomerInput } from "../api/customers";
import { ErrorState, formatAmount, formatDate, ModelScore, RecommendationStatus, WarningList } from "../features/customers/CustomerBits";
import { FIELD_LABELS, type FormField } from "../features/customers/constants";

const DETAIL_GROUPS: Array<{ title: string; fields: FormField[] }> = [
  { title: "Profile", fields: ["gender", "senior_citizen", "partner", "dependents"] },
  { title: "Phone", fields: ["phone_service", "multiple_lines"] },
  { title: "Internet and add-ons", fields: ["internet_service", "online_security", "online_backup", "device_protection", "tech_support", "streaming_tv", "streaming_movies"] },
  { title: "Contract and billing", fields: ["contract", "paperless_billing", "payment_method"] },
  { title: "Charges", fields: ["tenure", "monthly_charges", "total_charges"] },
];

export function CustomerDetailPage() {
  const { customerId } = useParams<{ customerId: string }>();
  const location = useLocation();
  const customer = useQuery({
    queryKey: ["customer", customerId],
    queryFn: () => getCustomer(customerId ?? ""),
    enabled: Boolean(customerId),
  });
  const message = (location.state as { message?: string } | null)?.message;

  if (customer.isPending) {
    return <section className="page-stack" aria-labelledby="customer-details-title"><DetailHeader customerId={customerId} /><div className="loading-panel" role="status">Loading customer facts and prediction history…</div></section>;
  }
  if (customer.isError || !customer.data?.customer) {
    const notFound = customer.error instanceof ApiError && customer.error.status === 404;
    return <ErrorState title="Customer details" message={notFound ? "That customer could not be found." : "Customer details could not be loaded. Try again when the API is ready."} onRetry={() => customer.refetch()} />;
  }

  const detail = customer.data;
  const current = detail.current_prediction;
  return (
    <section className="page-stack detail-page" aria-labelledby="customer-details-title">
      <DetailHeader customerId={detail.customer.customer_id} />
      {message && <p className="success-message" role="status">{message}</p>}
      <div className="detail-actions"><Link className="button-link" to={`/customers/${encodeURIComponent(detail.customer.customer_id)}/edit`}>Update and re-score</Link><Link className="button-link button-secondary" to={`/chat?customerId=${encodeURIComponent(detail.customer.customer_id)}`}>Ask assistant</Link><Link className="button-link button-secondary" to="/customers">Back to customers</Link></div>
      <p className="record-meta"><strong>{detail.is_active ? "Active record" : "Inactive record"}</strong> · Version {detail.version} · Source {detail.source}</p>

      <section className="score-panel" aria-labelledby="score-title">
        <div className="score-panel-heading"><div><p className="eyebrow">Current prediction</p><h2 id="score-title">Model score</h2></div><ModelScore prediction={current} /></div>
        {current ? <>
          <RecommendationStatus recommended={current.recommended_for_review} />
          <dl className="metadata-grid">
            <div><dt>Threshold</dt><dd>{Math.round(current.threshold * 100)}%</dd></div>
            <div><dt>Scored</dt><dd>{formatDate(current.scored_at)}</dd></div>
            <div><dt>Model version</dt><dd>{current.model_version}</dd></div>
            <div><dt>Threshold policy</dt><dd>{current.threshold_policy_version}</dd></div>
            <div><dt>Account state</dt><dd>{detail.is_active ? "Active" : "Inactive"}</dd></div>
            <div><dt>Record version</dt><dd>{detail.version}</dd></div>
          </dl>
          <p className="decision-note"><strong>About this score.</strong> It is a ranking signal, not a guaranteed probability or a causal explanation of churn.</p>
          <WarningList warnings={current.warnings} />
        </> : <div className="empty-inline"><strong>No successful prediction yet</strong><span>Update this record to generate a new model score.</span></div>}
      </section>

      <div className="info-panel" aria-label="Outreach status">
        <strong>Outreach status</strong>
        <span>No outreach decision is recorded in this customer workspace yet. Campaign selection remains a separate, human-confirmed action.</span>
      </div>

      <section aria-labelledby="facts-title">
        <div className="section-heading"><p className="eyebrow">Stored account facts</p><h2 id="facts-title">Customer facts</h2><p>These values are the canonical record used for the latest prediction.</p></div>
        <div className="fact-groups">
          {DETAIL_GROUPS.map((group) => <FactGroup key={group.title} title={group.title} customer={detail.customer} fields={group.fields} />)}
        </div>
      </section>

      <section aria-labelledby="history-title" className="timeline-section">
        <div className="section-heading"><p className="eyebrow">Append-only history</p><h2 id="history-title">Prediction history</h2><p>Every score is kept as a separate snapshot when the customer changes.</p></div>
        {detail.predictions.length ? <ol className="timeline">{detail.predictions.map((prediction, index) => <li key={`${prediction.scored_at}-${index}`}><div className="timeline-dot" aria-hidden="true" /><div><strong>{Math.round(prediction.risk_score * 100)}% model score</strong><RecommendationStatus recommended={prediction.recommended_for_review} /><time dateTime={prediction.scored_at}>{formatDate(prediction.scored_at)}</time><span className="timeline-meta">{prediction.model_version} · {prediction.threshold_policy_version}</span></div></li>)}</ol> : <div className="empty-inline"><strong>No prediction history</strong><span>Use the explicit update action to score this record.</span></div>}
      </section>

      <section aria-labelledby="audit-title" className="audit-section">
        <div className="section-heading"><p className="eyebrow">Traceability</p><h2 id="audit-title">Record activity</h2><p>Every action is recorded with its actor, source, and timestamp.</p></div>
        {detail.audit_events.length ? <ol className="audit-list">{detail.audit_events.map((event) => <li key={event.event_id}><strong>{humanAction(event.action)}</strong><span>{formatDate(event.created_at)} · {event.actor} · {event.source}</span></li>)}</ol> : <div className="empty-inline"><strong>No activity recorded</strong></div>}
      </section>
    </section>
  );
}

function DetailHeader({ customerId }: { customerId?: string }) {
  return <div className="page-heading"><p className="eyebrow">Customer records</p><h1 id="customer-details-title">Customer details</h1><p className="page-description"><strong className="record-id">{customerId ?? "Customer"}</strong> · Review facts, model output, and immutable history before updating.</p></div>;
}

function FactGroup({ title, customer, fields }: { title: string; customer: CustomerDetail["customer"]; fields: FormField[] }) {
  return <section className="fact-group" aria-labelledby={`fact-${title.replaceAll(" ", "-").toLowerCase()}`}><h3 id={`fact-${title.replaceAll(" ", "-").toLowerCase()}`}>{title}</h3><dl>{fields.map((field) => <div key={field}><dt>{FIELD_LABELS[field]}</dt><dd>{formatFact(field, customer[field])}</dd></div>)}</dl></section>;
}

function formatFact(field: FormField, value: CustomerInput[FormField]): string {
  if (field === "monthly_charges" || field === "total_charges") return formatAmount(Number(value));
  if (field === "tenure") return `${value} months`;
  return String(value);
}

function humanAction(action: string): string {
  return action.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
