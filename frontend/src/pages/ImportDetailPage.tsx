import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";

import { ApiError } from "../api/customers";
import { cancelImport, confirmImport, downloadImportErrors, downloadImportResults, getImport } from "../api/imports";
import {
  formatDate,
  ImportCounts,
  ImportErrorState,
  ImportProgress,
  ImportStatusBadge,
  isImportActive,
  isImportTerminal,
  Icon,
  LoadingState,
  Notice,
  PageHeader,
  SectionHeading,
  saveBlob,
} from "../components/index";

import "../features/imports/imports.css";

function writeKey() {
  return typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `import-confirm-${Date.now()}`;
}

function actionError(error: unknown): string {
  if (!(error instanceof ApiError)) return "The action could not be completed. The latest job state is still available.";
  if (error.problem.code === "import_not_ready") return "This import is not ready for that action. Refresh the latest job state and try again.";
  if (error.problem.code === "import_cancelled") return "This import has already been cancelled.";
  if (error.status === 0) return "Import services could not be reached. The latest job state is still available.";
  return error.message || "The action could not be completed.";
}

export function ImportDetailPage() {
  const { jobId } = useParams<{ jobId: string }>();
  const queryClient = useQueryClient();
  const [actionBusy, setActionBusy] = useState<"confirm" | "cancel" | null>(null);
  const [actionErrorMessage, setActionErrorMessage] = useState("");
  const [downloadError, setDownloadError] = useState("");
  const errorRef = useRef<HTMLDivElement>(null);
  const jobQuery = useQuery({
    queryKey: ["import", jobId],
    queryFn: () => getImport(jobId ?? ""),
    enabled: Boolean(jobId),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status && isImportActive(status) ? 2000 : false;
    },
  });

  useEffect(() => {
    if (actionErrorMessage || downloadError) errorRef.current?.focus();
  }, [actionErrorMessage, downloadError]);

  if (jobQuery.isPending) {
    return <section className="page-stack import-detail-page" aria-labelledby="import-detail-title"><DetailHeader jobId={jobId} /><div className="panel"><LoadingState label="Loading import progress…" rows={4} /></div></section>;
  }
  if (jobQuery.isError || !jobQuery.data) {
    const notFound = jobQuery.error instanceof ApiError && jobQuery.error.status === 404;
    return <ImportErrorState title="Import details" message={notFound ? "That import job could not be found." : "Import details could not be loaded. Try again when the API is ready."} retry={() => jobQuery.refetch()} />;
  }
  const job = jobQuery.data;
  const awaitingConfirmation = job.status === "ready" || job.status === "uploaded";
  const canConfirm = awaitingConfirmation && job.valid_rows > 0;
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

  const active = isImportActive(job.status);
  const terminal = isImportTerminal(job.status);

  return (
    <section className="page-stack import-detail-page" aria-labelledby="import-detail-title">
      <DetailHeader
        jobId={job.job_id}
        filename={job.filename}
        actions={<>
          <Link className="button-link button-ghost" to="/imports"><Icon name="arrowLeft" size={18} />Back to imports</Link>
          {canCancel && <button type="button" className="button-secondary" disabled={actionBusy !== null} onClick={handleCancel}>{actionBusy === "cancel" ? "Cancelling…" : "Cancel import"}</button>}
        </>}
      />
      {(actionErrorMessage || downloadError) && <div ref={errorRef} tabIndex={-1} className="stack-sm">{actionErrorMessage && <Notice tone="danger" role="alert">{actionErrorMessage}</Notice>}{downloadError && <Notice tone="danger" role="alert">{downloadError}</Notice>}</div>}

      <section className="panel import-status-panel" aria-labelledby="import-status-title">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">{job.mode === "create" ? "Create mode" : "Update mode"}</p>
            <h2 id="import-status-title">{job.filename}</h2>
            <dl className="inline-meta">
              <div><dt>Job</dt><dd className="mono">{job.job_id}</dd></div>
              <div><dt>Created</dt><dd>{formatDate(job.created_at)}</dd></div>
              {job.updated_at && <div><dt>Updated</dt><dd>{formatDate(job.updated_at)}</dd></div>}
              {job.file_hash && <div><dt>SHA-256</dt><dd className="mono" title={job.file_hash}>{job.file_hash.slice(0, 16)}…</dd></div>}
            </dl>
          </div>
          <ImportStatusBadge status={job.status} />
        </div>
        {(active || terminal) && <ImportProgress job={job} />}
        {job.message && <p className="import-job-message">{job.message}</p>}
        <ImportCounts job={job} />
        {awaitingConfirmation && !canConfirm && <Notice tone="warning" title="Nothing to process">This preflight found no valid rows, so there is nothing to confirm. Correct the file and start a new import.</Notice>}
        {canConfirm && (
          <div className="confirm-bar confirm-bar-emphasis">
            <div>
              <strong>Ready to process</strong>
              <p>{job.valid_rows.toLocaleString()} valid row{job.valid_rows === 1 ? "" : "s"} will be {job.mode === "create" ? "created" : "updated and re-scored"}. {job.invalid_rows ? `${job.invalid_rows.toLocaleString()} invalid row${job.invalid_rows === 1 ? "" : "s"} will be skipped.` : "No rows will be skipped."} This cannot be undone from the workbench.</p>
            </div>
            <button type="button" disabled={actionBusy !== null} onClick={handleConfirm}>{actionBusy === "confirm" ? <><span className="spinner" aria-hidden="true" />Confirming…</> : "Confirm and process import"}</button>
          </div>
        )}
      </section>

      {active && <Notice tone="info" role="status" title="Processing"><span className="loading-label"><span className="spinner" aria-hidden="true" />This page checks for progress every two seconds while the job is active.</span></Notice>}

      <section className="panel import-outcomes" aria-labelledby="import-outcomes-title">
        <SectionHeading eyebrow="Row-level transparency" title="Outcomes" id="import-outcomes-title">Valid rows are processed independently. Invalid rows never write customer data.</SectionHeading>
        {job.status === "completed" && <Notice tone="success" title="Import completed">{job.succeeded_rows.toLocaleString()} row{job.succeeded_rows === 1 ? "" : "s"} processed successfully. Download the result CSV for a row-by-row record.</Notice>}
        {job.status === "partially_completed" && <Notice tone="warning" title="Partial success">Some rows completed and some were rejected. Download both files to review every original row.</Notice>}
        {job.status === "failed" && <Notice tone="danger" title="Import failed">No new action is taken automatically. Review the job message and start a fresh preflight if needed.</Notice>}
        {job.status === "cancelled" && <Notice tone="neutral" title="Import cancelled">Rows not yet processed were not written.</Notice>}
        {!terminal && <p className="field-hint">Result and error files become available when the job finishes.</p>}
        <div className="button-row">
          <button type="button" className="button-secondary" disabled={!terminal} onClick={() => handleDownload("results")}><Icon name="download" size={18} />Download result CSV</button>
          <button type="button" className="button-secondary" disabled={!terminal} onClick={() => handleDownload("errors")}><Icon name="download" size={18} />Download error CSV</button>
          {terminal && <Link className="button-link button-ghost" to="/customers"><Icon name="users" size={18} />Review customers</Link>}
        </div>
      </section>
    </section>
  );
}

function DetailHeader({ jobId, filename, actions }: { jobId?: string; filename?: string; actions?: ReactNode }) {
  return (
    <PageHeader
      titleId="import-detail-title"
      crumbs={[{ label: "Overview", to: "/" }, { label: "Imports", to: "/imports" }, { label: filename ?? jobId ?? "Import job" }]}
      eyebrow="Data operations"
      title="Import details"
      description="Track a bounded job and inspect its deterministic row outcomes."
      actions={actions}
    />
  );
}
