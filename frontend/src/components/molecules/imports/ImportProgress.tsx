import type { ImportJob } from "../../../api/imports";
import { isImportActive } from "./ImportStatusBadge";

export function ImportProgress({ job }: { job: ImportJob }) {
  const progress = Math.round(Math.min(100, Math.max(0, job.progress_percent)));
  const denominator = job.valid_rows || job.total_rows;
  return (
    <div className="progress-block">
      <div className="progress-meta"><strong>{progress}%</strong><span>{job.processed_rows.toLocaleString()} of {denominator ? denominator.toLocaleString() : "—"} {job.valid_rows ? "valid " : ""}rows processed{job.invalid_rows ? ` · ${job.invalid_rows.toLocaleString()} invalid skipped` : ""}</span></div>
      <div className="progress-track" role="progressbar" aria-label="Import progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress} aria-valuetext={`${progress}% · ${job.processed_rows} of ${job.total_rows || "unknown"} rows processed`}>
        <span className={`progress-fill${isImportActive(job.status) ? " progress-fill-active" : ""}`} style={{ width: `${progress}%` }} />
      </div>
    </div>
  );
}
