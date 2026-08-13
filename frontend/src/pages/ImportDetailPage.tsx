import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";

import { ApiError } from "../api/customers";
import { cancelImport, confirmImport, downloadImportErrors, downloadImportResults, getImport } from "../api/imports";
import { formatDate } from "../features/customers/CustomerBits";
import { ImportCounts, ImportErrorState, ImportProgress, ImportStatusBadge, isImportActive, isImportTerminal } from "../features/imports/ImportBits";
import "../features/imports/imports.css";

function writeKey() {
  return typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `import-confirm-${Date.now()}`;
}

async function saveBlob(blob: Blob, filename: string) {
  const href = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = href;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(href);
}

function actionError(error: unknown): string {
  if (!(error instanceof ApiError)) return "The action could not be completed. The latest job state is still available.";
  if (error.problem.code === "import_not_ready") return "This import is not ready for that action. Refresh the latest job state and try again.";
  if (error.problem.code === "import_cancelled") return "This import has already been cancelled.";
  if (error.status === 0) return "The local API could not be reached. The latest job state is still available.";
  return error.message || "The action could not be completed.";
}

export function ImportDetailPage() {
  const { jobId } = useParams<{ jobId: string }>();
  const queryClient = useQueryClient();
  const [actionBusy, setActionBusy] = useState<"confirm" | "cancel" | null>(null);
  const [actionErrorMessage, setActionErrorMessage] = useState("");
  const [downloadError, setDownloadError] = useState("");
  const jobQuery = useQuery({
    queryKey: ["import", jobId],
    queryFn: () => getImport(jobId ?? ""),
    enabled: Boolean(jobId),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status && isImportActive(status) ? 2000 : false;
    },
  });

  if (jobQuery.isPending) {
    return <section className="page-stack import-detail-page" aria-labelledby="import-detail-title"><DetailHeader jobId={jobId} /><div className="loading-panel" role="status">Loading import progress…</div></section>;
  }
  if (jobQuery.isError || !jobQuery.data) {
    const notFound = jobQuery.error instanceof ApiError && jobQuery.error.status === 404;
    return <ImportErrorState title="Import details" message={notFound ? "That import job could not be found." : "Import details could not be loaded. Try again when the API is ready."} retry={() => jobQuery.refetch()} />;
  }
  const job = jobQuery.data;
  const canConfirm = job.status === "ready" || job.status === "uploaded";
  const canCancel = !isImportTerminal(job.status) && job.status !== "completed";

  async function handleConfirm() {
    setActionBusy("confirm");
    setActionErrorMessage("");
    try {
      await confirmImport(job.job_id, job.idempotency_key || writeKey());
      await queryClient.invalidateQueries({ queryKey: ["import", job.job_id] });
      await jobQuery.refetch();
    } catch (error) {
      setActionErrorMessage(actionError(error));
    } finally {
      setActionBusy(null);
    }
  }

  async function handleCancel() {
    setActionBusy("cancel");
    setActionErrorMessage("");
    try {
      await cancelImport(job.job_id);
      await queryClient.invalidateQueries({ queryKey: ["import", job.job_id] });
      await jobQuery.refetch();
    } catch (error) {
      setActionErrorMessage(actionError(error));
    } finally {
      setActionBusy(null);
    }
  }

  async function handleDownload(kind: "results" | "errors") {
    setDownloadError("");
    try {
      const blob = kind === "results" ? await downloadImportResults(job.job_id) : await downloadImportErrors(job.job_id);
      await saveBlob(blob, `${job.filename.replace(/\.csv$/i, "")}-${kind}.csv`);
    } catch {
      setDownloadError(`The ${kind} CSV could not be downloaded. Try again when the API is ready.`);
    }
  }

  return (
    <section className="page-stack import-detail-page" aria-labelledby="import-detail-title">
      <DetailHeader jobId={job.job_id} />
      <div className="detail-actions"><Link className="button-link button-secondary" to="/imports">Back to imports</Link>{canConfirm && <button type="button" disabled={actionBusy !== null} onClick={handleConfirm}>{actionBusy === "confirm" ? "Confirming…" : "Confirm and process import"}</button>}{canCancel && <button type="button" className="button-secondary" disabled={actionBusy !== null} onClick={handleCancel}>{actionBusy === "cancel" ? "Cancelling…" : "Cancel import"}</button>}</div>
      {actionErrorMessage && <p className="import-alert" role="alert">{actionErrorMessage}</p>}
      {downloadError && <p className="import-alert" role="alert">{downloadError}</p>}
      <section className="import-status-panel" aria-labelledby="import-status-title"><div className="preview-heading"><div><p className="eyebrow">{job.mode === "create" ? "Create mode" : "Update mode"}</p><h2 id="import-status-title">{job.filename}</h2><p className="import-job-meta">Job {job.job_id} · Started {formatDate(job.created_at)}</p></div><ImportStatusBadge status={job.status} /></div>{isImportActive(job.status) && <ImportProgress job={job} />}{job.message && <p className="import-job-message" role="status">{job.message}</p>}<ImportCounts job={job} /></section>
      <section className="import-outcomes" aria-labelledby="import-outcomes-title"><div className="section-heading"><p className="eyebrow">Row-level transparency</p><h2 id="import-outcomes-title">Outcomes</h2><p>Valid rows are processed independently. Invalid rows never write customer data.</p></div>{job.status === "partially_completed" && <div className="import-alert"><strong>Partial success</strong><span>Some rows completed and some were rejected. Download both files to review every original row.</span></div>}{job.status === "failed" && <div className="import-alert"><strong>Import failed</strong><span>No new action is taken automatically. Review the job message and start a fresh preflight if needed.</span></div>}{job.status === "cancelled" && <div className="import-alert"><strong>Import cancelled</strong><span>Rows not yet processed were not written.</span></div>}<div className="download-actions"><button type="button" className="button-secondary" disabled={!isImportTerminal(job.status)} onClick={() => handleDownload("results")}>Download result CSV</button><button type="button" className="button-secondary" disabled={!isImportTerminal(job.status)} onClick={() => handleDownload("errors")}>Download error CSV</button></div></section>
      {isImportActive(job.status) && <p className="poll-note" role="status">This page checks for progress every two seconds while the job is active.</p>}
    </section>
  );
}

function DetailHeader({ jobId }: { jobId?: string }) {
  return <div className="page-heading"><p className="eyebrow">Data operations</p><h1 id="import-detail-title">Import details</h1><p className="page-description">Track a bounded job and inspect its deterministic row outcomes. <strong className="record-id">{jobId ?? "Import job"}</strong></p></div>;
}
