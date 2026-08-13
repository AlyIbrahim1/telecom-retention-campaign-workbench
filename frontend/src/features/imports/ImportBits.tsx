import { Link } from "react-router-dom";

import type { ImportJob, ImportStatus } from "../../api/imports";

export const ACTIVE_IMPORT_STATUSES: ImportStatus[] = ["uploaded", "validating", "queued", "running"];

export function isImportActive(status: ImportStatus): boolean {
  return ACTIVE_IMPORT_STATUSES.includes(status);
}

export function isImportTerminal(status: ImportStatus): boolean {
  return ["completed", "partially_completed", "failed", "cancelled"].includes(status);
}

export function importStatusLabel(status: ImportStatus): string {
  return status.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function ImportStatusBadge({ status }: { status: ImportStatus }) {
  const tone = status === "completed" ? "status-recommended" : status === "failed" || status === "cancelled" || status === "partially_completed" ? "status-warning" : "status-muted";
  return <span className={`status ${tone}`}><span aria-hidden="true">{status === "completed" ? "●" : status === "failed" || status === "cancelled" ? "!" : "○"}</span>{importStatusLabel(status)}</span>;
}

export function ImportProgress({ job }: { job: ImportJob }) {
  const progress = Math.round(Math.min(100, Math.max(0, job.progress_percent)));
  return (
    <div className="import-progress">
      <div className="import-progress-track" role="progressbar" aria-label="Import progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress} aria-valuetext={`${progress}% · ${job.processed_rows} of ${job.total_rows || "unknown"} rows processed`}><span style={{ transform: `scaleX(${progress / 100})` }} /></div>
      <div className="import-progress-meta"><strong>{progress}%</strong><span>{job.processed_rows} of {job.total_rows || "—"} rows processed</span></div>
    </div>
  );
}

export function ImportErrorState({ title, message, retry, back = true }: { title: string; message: string; retry?: () => void; back?: boolean }) {
  return (
    <section className="system-state" aria-labelledby="import-error-title">
      <p className="eyebrow">Data operations</p>
      <h1 id="import-error-title">{title}</h1>
      <p role="alert">{message}</p>
      <div className="state-actions">
        {retry && <button type="button" onClick={retry}>Try again</button>}
        {back && <Link className="button-link button-secondary" to="/imports">Back to imports</Link>}
      </div>
    </section>
  );
}

export function ImportCounts({ job }: { job: ImportJob }) {
  return (
    <dl className="import-counts">
      <div><dt>Total rows</dt><dd>{job.total_rows}</dd></div>
      <div><dt>Valid rows</dt><dd>{job.valid_rows}</dd></div>
      <div><dt>Invalid rows</dt><dd>{job.invalid_rows}</dd></div>
      <div><dt>Warnings</dt><dd>{job.warning_count}</dd></div>
      <div><dt>Succeeded</dt><dd>{job.succeeded_rows}</dd></div>
      <div><dt>Failed</dt><dd>{job.failed_rows}</dd></div>
    </dl>
  );
}
