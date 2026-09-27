import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Link, useLocation, useParams } from "react-router-dom";

import { ApiError, getCustomer, type CustomerDetail, type CustomerInput } from "../api/customers";
import { useAssistant } from "../features/chat/AssistantContext";
import {
  Badge,
  EmptyState,
  Icon,
  LoadingState,
  Notice,
  PageHeader,
  SectionHeading,
  ErrorState,
  formatAmount,
  formatDate,
  ModelScore,
  RecommendationStatus,
  WarningList,
} from "../components/index";

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
  const { openAssistant } = useAssistant();
  const customer = useQuery({
    queryKey: ["customer", customerId],
    queryFn: () => getCustomer(customerId ?? ""),
    enabled: Boolean(customerId),
  });
  const message = (location.state as { message?: string } | null)?.message;

  if (customer.isPending) {
    return <section className="page-stack" aria-labelledby="customer-details-title"><DetailHeader customerId={customerId} /><div className="panel"><LoadingState label="Loading customer facts and prediction history…" rows={6} /></div></section>;
  }
  if (customer.isError || !customer.data?.customer) {
    const notFound = customer.error instanceof ApiError && customer.error.status === 404;
    return <ErrorState title="Customer details" message={notFound ? "That customer could not be found." : "Customer details could not be loaded. Try again when the API is ready."} onRetry={() => customer.refetch()} />;
  }

  const detail = customer.data;
  const current = detail.current_prediction;
  const id = detail.customer.customer_id;
  return (
    <section className="page-stack detail-page" aria-labelledby="customer-details-title">
      <DetailHeader
        customerId={id}
        meta={<>
          <span className="id-chip">{id}</span>
          <Badge tone={detail.is_active ? "success" : "neutral"} icon={detail.is_active ? "●" : "○"}>{detail.is_active ? "Active account" : "Inactive account"}</Badge>
          <span className="meta-item">Record version {detail.version}</span>
          <span className="meta-item">Source: {sourceLabel(detail.source)}</span>
        </>}
        actions={<>
          <Link className="button-link button-ghost" to="/customers"><Icon name="arrowLeft" size={18} />Back to customers</Link>
          <button type="button" className="button-secondary" aria-controls="assistant-panel" onClick={() => openAssistant({ customer_id: id })}><Icon name="chat" size={18} />Ask assistant</button>
          <Link className="button-link" to={`/customers/${encodeURIComponent(id)}/edit`}><Icon name="edit" size={18} />Update and re-score</Link>
        </>}
      />
      {message && <Notice tone="success" role="status">{message}</Notice>}

      <div className="detail-grid">
        <section className="panel score-panel" aria-labelledby="score-title">
          <div className="panel-heading">
            <div><p className="eyebrow">Current prediction</p><h2 id="score-title">Model score</h2></div>
            {current && <RecommendationStatus recommended={current.recommended_for_review} />}
          </div>
          {current ? <>
            <ModelScore prediction={current} size="lg" />
            <dl className="meta-list meta-list-grid">
              <div><dt>Review threshold</dt><dd>{Math.round(current.threshold * 100)}%</dd></div>
              <div><dt>Scored</dt><dd>{formatDate(current.scored_at)}</dd></div>
              <div><dt>Model version</dt><dd>{current.model_version}</dd></div>
              <div><dt>Threshold policy</dt><dd>{current.threshold_policy_version}</dd></div>
            </dl>
            <p className="decision-note"><Icon name="info" size={16} /><span><strong>About this score.</strong> It is a ranking signal for deciding whom to review, not a guaranteed probability or a causal explanation of churn.</span></p>
            <WarningList warnings={current.warnings} title="Scoring warnings" />
          </> : <EmptyState compact icon="info" title="No successful prediction yet"><p>Update this record to generate a new model score.</p></EmptyState>}
        </section>

        <aside className="panel record-panel" aria-labelledby="record-title">
          <div className="panel-heading"><div><p className="eyebrow">Record</p><h2 id="record-title">Account summary</h2></div></div>
          <dl className="meta-list">
            <div><dt>Contract</dt><dd>{detail.customer.contract}</dd></div>
            <div><dt>Internet</dt><dd>{detail.customer.internet_service === "No" ? "No internet service" : detail.customer.internet_service}</dd></div>
            <div><dt>Tenure</dt><dd>{detail.customer.tenure} months</dd></div>
            <div><dt>Monthly charges</dt><dd className="num">{formatAmount(detail.customer.monthly_charges)}</dd></div>
            <div><dt>Created</dt><dd>{formatDate(detail.created_at)}</dd></div>
            <div><dt>Last updated</dt><dd>{formatDate(detail.updated_at)}</dd></div>
          </dl>
          <div className="record-outreach" aria-label="Outreach status">
            <strong>Outreach status</strong>
            <span>No outreach decision is recorded in this customer workspace. Campaign selection remains a separate, human-confirmed action.</span>
          </div>
        </aside>
      </div>

      <section className="panel" aria-labelledby="facts-title">
        <SectionHeading eyebrow="Stored account facts" title="Customer facts" id="facts-title">These values are the canonical record used for the latest prediction.</SectionHeading>
        <div className="fact-groups">
          {DETAIL_GROUPS.map((group) => <FactGroup key={group.title} title={group.title} customer={detail.customer} fields={group.fields} />)}
        </div>
      </section>

      <div className="history-grid">
        <section className="panel" aria-labelledby="history-title">
          <SectionHeading eyebrow="Append-only history" title="Prediction history" id="history-title">Every score is kept as a separate snapshot; newer snapshots never overwrite older ones.</SectionHeading>
          {detail.predictions.length ? <ol className="timeline">{detail.predictions.map((prediction, index) => <li key={`${prediction.scored_at}-${index}`} className={index === 0 ? "timeline-latest" : undefined}><span className="timeline-dot" aria-hidden="true" /><div className="timeline-body"><div className="timeline-head"><strong>{Math.round(prediction.risk_score * 100)}% model score</strong>{index === 0 && <Badge tone="info">Latest</Badge>}</div><RecommendationStatus recommended={prediction.recommended_for_review} /><time dateTime={prediction.scored_at}>{formatDate(prediction.scored_at)}</time><span className="timeline-meta">{prediction.model_version} · {prediction.threshold_policy_version} · threshold {Math.round(prediction.threshold * 100)}%</span></div></li>)}</ol> : <EmptyState compact icon="history" title="No prediction history"><p>Use the explicit update action to score this record.</p></EmptyState>}
        </section>

        <section className="panel" aria-labelledby="audit-title">
          <SectionHeading eyebrow="Traceability" title="Record activity" id="audit-title">Each action is recorded with its actor, source, and time.</SectionHeading>
          {detail.audit_events.length ? <ol className="audit-list">{detail.audit_events.map((event) => <li key={event.event_id}><span className="audit-icon" aria-hidden="true"><Icon name={event.action.includes("create") ? "plus" : event.action.includes("update") ? "edit" : "clock"} size={16} /></span><div><strong>{humanAction(event.action)}</strong><span>{formatDate(event.created_at)} · {event.actor} · {sourceLabel(event.source)}</span></div></li>)}</ol> : <EmptyState compact icon="history" title="No activity recorded" />}
        </section>
      </div>
    </section>
  );
}

function DetailHeader({ customerId, meta, actions }: { customerId?: string; meta?: ReactNode; actions?: ReactNode }) {
  return (
    <PageHeader
      titleId="customer-details-title"
      crumbs={[{ label: "Overview", to: "/" }, { label: "Customers", to: "/customers" }, { label: customerId ?? "Customer" }]}
      eyebrow="Customer records"
      title="Customer details"
      description="Review stored facts, model output, and append-only history before updating."
      meta={meta}
      actions={actions}
    />
  );
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

function sourceLabel(source: string): string {
  const known: Record<string, string> = { csv: "CSV import", api: "API", ui: "Workbench form", chat: "Assistant", seed: "Demo seed" };
  return known[source.toLowerCase()] ?? humanAction(source);
}
