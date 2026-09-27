import type { StagedAction } from "../../../api/chat";
import { Icon } from "../../atoms/Icon";
import { Notice } from "../../molecules/Notice";

export type BusyState = "starting" | "sending" | "confirming" | "cancelling" | null;

export function StagedActionCard({ action, busy, onConfirm, onCancel }: { action: StagedAction; busy: BusyState; onConfirm: () => void; onCancel: () => void }) {
  const hasToken = Boolean(action.confirmation_token);
  return (
    <section className="staged-action" aria-labelledby="staged-action-title">
      <p className="eyebrow">Confirmation required</p>
      <h3 id="staged-action-title">Review {action.action === "create" ? "new customer" : "customer update"}</h3>
      <p className="staged-action-copy">This is a preview outside the assistant's prose. Confirm once to save it, or cancel to discard it.</p>
      {action.customer_id && <p className="record-meta"><strong>{action.customer_id}</strong>{action.expected_version != null ? ` · Expected version ${action.expected_version}` : ""}</p>}
      {action.changes.length > 0 ? <dl className="staged-fields">{action.changes.map((change) => <div key={change.field}><dt>{humanField(change.field)}</dt><dd>{formatValue(change.before)} <span aria-hidden="true">→</span> {formatValue(change.after)}</dd></div>)}</dl> : <dl className="staged-fields">{Object.entries(action.fields).map(([field, value]) => <div key={field}><dt>{humanField(field)}</dt><dd>{formatValue(value)}</dd></div>)}</dl>}
      {action.prediction && <div className="staged-prediction"><strong>Model output</strong><span>{action.prediction.risk_score != null ? `${Math.round(action.prediction.risk_score * 100)}% risk score` : "Prediction available"}</span>{action.prediction.model_version && <small>{action.prediction.model_version}</small>}</div>}
      {action.warnings.length > 0 && <Notice tone="warning" title="Review warnings"><ul>{action.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></Notice>}
      {!hasToken && <p className="field-error">This preview no longer has a confirmation token. Ask for a fresh preview before making a change.</p>}
      <div className="button-row"><button type="button" disabled={busy !== null || !hasToken} onClick={onConfirm}>{busy === "confirming" ? "Confirming…" : "Confirm once"}</button><button type="button" className="button-secondary" disabled={busy !== null || !hasToken} onClick={onCancel}>{busy === "cancelling" ? "Cancelling…" : "Cancel preview"}</button></div>
      {action.expires_at && <p className="staged-expiry"><Icon name="clock" size={14} />Preview expires {new Date(action.expires_at).toLocaleString()}</p>}
    </section>
  );
}

function humanField(field: string): string {
  return field
    .split("_")
    .map((word) => word.toLowerCase() === "id" ? "ID" : `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(" ");
}

function formatValue(value: unknown): string {
  if (value == null || value === "") return "Not provided";
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return "Unavailable";
    }
  }
  return String(value);
}
