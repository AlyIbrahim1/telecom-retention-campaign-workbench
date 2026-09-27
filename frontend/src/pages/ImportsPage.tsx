import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";

import { downloadTemplate, listImports } from "../api/imports";
import {
  EmptyState,
  Icon,
  LoadingState,
  Notice,
  PageHeader,
  Pagination,
  saveBlob,
  formatDate,
  ImportErrorState,
  ImportStatusBadge,
  isImportActive,
} from "../components/index";

import "../features/imports/imports.css";

const PAGE_SIZE = 25;

export function ImportsPage() {
  const [page, setPage] = useState(1);
  const [downloadError, setDownloadError] = useState("");
  const imports = useQuery({
    queryKey: ["imports", page],
    queryFn: () => listImports(page, PAGE_SIZE),
    placeholderData: (previous) => previous,
    refetchInterval: (query) => (query.state.data?.items.some((job) => isImportActive(job.status)) ? 4000 : false),
  });

  async function handleTemplate() {
    setDownloadError("");
    try {
      await saveBlob(await downloadTemplate(), "customer-import-template.csv");
    } catch {
      setDownloadError("The template could not be downloaded. Try again when the API is ready.");
    }
  }

  if (imports.isPending) {
    return <section className="page-stack imports-page" aria-labelledby="imports-title"><ImportsHeader onTemplate={handleTemplate} /><div className="panel"><LoadingState label="Loading import history…" rows={5} /></div></section>;
  }
  if (imports.isError) {
    return <ImportErrorState title="Imports" message="Import history could not be loaded. Try again when the API is ready." retry={() => imports.refetch()} />;
  }
  const pageSize = imports.data.page_size || PAGE_SIZE;
  const pageCount = Math.max(1, Math.ceil((imports.data.total || 0) / pageSize));

  return (
    <section className="page-stack imports-page" aria-labelledby="imports-title">
      <ImportsHeader onTemplate={handleTemplate} />
      {downloadError && <Notice tone="danger" role="alert">{downloadError}</Notice>}
      <div className="list-toolbar">
        <p role="status" className="result-count"><strong>{imports.data.total.toLocaleString()}</strong> import job{imports.data.total === 1 ? "" : "s"}{imports.isFetching && <span className="inline-loading"><span className="spinner" aria-hidden="true" />Updating</span>}</p>
      </div>
      {imports.data.items.length === 0 ? (
        <div className="panel">
          <EmptyState
            icon="upload"
            eyebrow="No jobs yet"
            title="Import a CSV when you are ready"
            actions={<><Link className="button-link" to="/imports/new"><Icon name="plus" size={18} />Start an import</Link><button type="button" className="button-secondary" onClick={handleTemplate}><Icon name="download" size={18} />Download template</button></>}
          >
            <p>Download the canonical template, choose create or update mode, then run a preflight before any customer data is written.</p>
          </EmptyState>
        </div>
      ) : (
        <div className="table-frame">
          <div className="table-scroll" tabIndex={0} role="region" aria-label="Import job history table">
            <table className="data-table import-table">
              <caption className="sr-only">Import job history</caption>
              <thead>
                <tr>
                  <th scope="col">File</th>
                  <th scope="col">Mode</th>
                  <th scope="col">Status</th>
                  <th scope="col" className="num">Total</th>
                  <th scope="col" className="num">Succeeded</th>
                  <th scope="col" className="num">Failed</th>
                  <th scope="col">Created</th>
                </tr>
              </thead>
              <tbody>
                {imports.data.items.map((job) => (
                  <tr key={job.job_id}>
                    <th scope="row" data-label="File">
                      <Link className="record-link" to={`/imports/${encodeURIComponent(job.job_id)}`}>{job.filename}</Link>
                      <span className="cell-note mono">{job.job_id.slice(0, 8)}</span>
                    </th>
                    <td data-label="Mode"><span className={`mode-tag mode-tag-${job.mode}`}>{job.mode === "create" ? "Create" : "Update"}</span></td>
                    <td data-label="Status"><ImportStatusBadge status={job.status} /></td>
                    <td data-label="Total" className="num">{job.total_rows.toLocaleString()}</td>
                    <td data-label="Succeeded" className="num">{job.succeeded_rows.toLocaleString()}</td>
                    <td data-label="Failed" className={`num${job.failed_rows ? " text-danger" : ""}`}>{job.failed_rows.toLocaleString()}</td>
                    <td data-label="Created" className="cell-date">{formatDate(job.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <Pagination label="Import result pages" page={page} pageCount={pageCount} onPage={setPage} total={imports.data.total} pageSize={pageSize} itemLabel="jobs" />
    </section>
  );
}

function ImportsHeader({ onTemplate }: { onTemplate: () => void }) {
  return (
    <PageHeader
      titleId="imports-title"
      crumbs={[{ label: "Overview", to: "/" }, { label: "Imports" }]}
      eyebrow="Data operations"
      title="Imports"
      description="Preflight a bounded CSV, review every row outcome, and explicitly confirm any customer writes."
      actions={<>
        <button type="button" className="button-secondary" onClick={onTemplate}><Icon name="download" size={18} />CSV template</button>
        <Link className="button-link" to="/imports/new"><Icon name="plus" size={18} />New import</Link>
      </>}
    />
  );
}
