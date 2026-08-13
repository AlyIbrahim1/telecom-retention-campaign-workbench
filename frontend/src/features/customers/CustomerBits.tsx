import { Link } from "react-router-dom";

import type { Prediction, ValidationWarning } from "../../api/customers";

export function ModelScore({ prediction }: { prediction: Prediction | null }) {
  if (!prediction) {
    return <span className="score-missing">No score yet</span>;
  }
  const percentage = Math.round(prediction.risk_score * 100);
  return (
    <span className="score-wrap">
      <strong className="score-value">{percentage}%</strong>
      <span className="score-label">Model score</span>
    </span>
  );
}
export function RecommendationStatus({ recommended }: { recommended: boolean | null | undefined }) {
  if (recommended === null || recommended === undefined) {
    return <span className="status status-muted">Not scored</span>;
  }
  return recommended ? (
    <span className="status status-recommended"><span aria-hidden="true">●</span> Recommended for review</span>
  ) : (
    <span className="status status-neutral"><span aria-hidden="true">○</span> Below review threshold</span>
  );
}

export function WarningList({ warnings }: { warnings: ValidationWarning[] }) {
  if (!warnings.length) return null;
  return (
    <div className="warning-panel" role="status">
      <strong>Review before saving</strong>
      <ul>
        {warnings.map((warning) => <li key={`${warning.field}-${warning.message}`}>{warning.message}</li>)}
      </ul>
    </div>
  );
}

export function ErrorState({
  title,
  message,
  onRetry,
  backToCustomers = true,
}: {
  title: string;
  message: string;
  onRetry?: () => void;
  backToCustomers?: boolean;
}) {
  return (
    <section className="system-state" aria-labelledby="customer-error-title">
      <p className="eyebrow">Customer records</p>
      <h1 id="customer-error-title">{title}</h1>
      <p role="alert">{message}</p>
      <div className="state-actions">
        {onRetry && <button type="button" onClick={onRetry}>Try again</button>}
        {backToCustomers && <Link className="button-link button-secondary" to="/customers">Back to customers</Link>}
      </div>
    </section>
  );
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "Not scored";
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "Unknown";
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export function formatAmount(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat("en", { maximumFractionDigits: 2 }).format(value);
}
