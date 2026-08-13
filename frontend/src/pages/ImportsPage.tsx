import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";

import { downloadTemplate, listImports } from "../api/imports";
import { formatDate } from "../features/customers/CustomerBits";
import { ImportErrorState, ImportStatusBadge } from "../features/imports/ImportBits";
import "../features/imports/imports.css";

async function saveBlob(blob: Blob, filename: string) {
  const href = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = href;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(href);
}

export function ImportsPage() {
  const [page, setPage] = useState(1);
  const [downloadError, setDownloadError] = useState("");
  const imports = useQuery({
    queryKey: ["imports", page],
    queryFn: () => listImports(page, 25),
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
    return <section className="page-stack imports-page" aria-labelledby="imports-title"><ImportsHeader onTemplate={handleTemplate} /><div className="loading-panel" role="status">Loading import history…</div></section>;
  }
  if (imports.isError) {
    return <ImportErrorState title="Imports" message="Import history could not be loaded. Try again when the API is ready." retry={() => imports.refetch()} />;
  }
  const pageCount = Math.max(1, Math.ceil((imports.data.total || 0) / imports.data.page_size));

  return (
    <section className="page-stack imports-page" aria-labelledby="imports-title">
      <ImportsHeader onTemplate={handleTemplate} />
      {downloadError && <p className="import-alert" role="alert">{downloadError}</p>}
      <div className="list-summary"><p role="status"><strong>{imports.data.total}</strong> import job{imports.data.total === 1 ? "" : "s"}</p></div>
      {imports.data.items.length === 0 ? (
        <div className="empty-panel"><p className="eyebrow">No jobs yet</p><h2>Import a CSV when you are ready</h2><p>Download the canonical template, choose create or update mode, then run a preflight before any customer data is written.</p><div className="state-actions"><Link className="button-link" to="/imports/new">Start an import</Link><button type="button" className="button-secondary" onClick={handleTemplate}>Download template</button></div></div>
      ) : (
        <div className="table-scroll import-table-scroll"><table className="customer-table import-table"><caption className="sr-only">Import job history</caption><thead><tr><th scope="col">File</th><th scope="col">Mode</th><th scope="col">Status</th><th scope="col">Rows</th><th scope="col">Created</th><th scope="col"><span className="sr-only">Open</span></th></tr></thead><tbody>{imports.data.items.map((job) => <tr key={job.job_id}><th scope="row" data-label="File"><Link to={`/imports/${encodeURIComponent(job.job_id)}`}>{job.filename}</Link><span className="cell-note">{job.job_id}</span></th><td data-label="Mode">{job.mode === "create" ? "Create" : "Update"}</td><td data-label="Status"><ImportStatusBadge status={job.status} /></td><td data-label="Rows">{job.total_rows}<span className="cell-note">{job.succeeded_rows} succeeded · {job.failed_rows} failed</span></td><td data-label="Created">{formatDate(job.created_at)}</td><td data-label="Open"><Link className="row-action" to={`/imports/${encodeURIComponent(job.job_id)}`}>Open<span className="sr-only"> {job.filename}</span></Link></td></tr>)}</tbody></table></div>
      )}
      <nav className="pagination" aria-label="Import result pages"><button type="button" className="button-secondary" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>Previous</button><span aria-live="polite">Page {page} of {pageCount}</span><button type="button" className="button-secondary" disabled={page >= pageCount} onClick={() => setPage((current) => current + 1)}>Next</button></nav>
    </section>
  );
}

function ImportsHeader({ onTemplate }: { onTemplate: () => void }) {
  return <div className="page-heading-action"><div><p className="eyebrow">Data operations</p><h1 id="imports-title">Imports</h1><p className="page-description">Preflight a bounded CSV, review every row outcome, and explicitly confirm any customer writes.</p></div><div className="detail-actions"><button type="button" className="button-secondary" onClick={onTemplate}>Download template</button><Link className="button-link" to="/imports/new">New import</Link></div></div>;
}

