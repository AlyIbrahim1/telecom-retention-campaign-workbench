import { useRef, useState, type ChangeEvent } from "react";
import { Link, useNavigate } from "react-router-dom";

import { ApiError } from "../api/customers";
import { downloadTemplate, preflightImport, type ImportMode, type ImportPreflight } from "../api/imports";
import "../features/imports/imports.css";

const MAX_FILE_BYTES = 10 * 1024 * 1024;

async function saveBlob(blob: Blob, filename: string) {
  const href = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = href;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(href);
}

function messageFor(error: unknown): string {
  if (!(error instanceof ApiError)) return "The preflight could not be completed. Your selected file and mode are still here.";
  if (error.problem.code === "import_limit_exceeded") return "This file is larger than the 10 MB pilot limit. Choose a smaller CSV.";
  if (error.problem.code === "import_file_invalid" || error.problem.code === "import_schema_invalid") return error.message;
  if (error.status === 0) return "The local API could not be reached. Your selected file and mode are still here.";
  return error.message || "The preflight could not be completed. Try again.";
}

export function ImportNewPage() {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<ImportMode>("create");
  const [file, setFile] = useState<File | null>(null);
  const [preflight, setPreflight] = useState<ImportPreflight | null>(null);
  const [updateAck, setUpdateAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function handleTemplate() {
    setError("");
    try {
      await saveBlob(await downloadTemplate(), "customer-import-template.csv");
    } catch {
      setError("The template could not be downloaded. Your selected file and mode are still here.");
      summaryRef.current?.focus();
    }
  }

  function selectMode(next: ImportMode) {
    setMode(next);
    setPreflight(null);
    setError("");
    if (next === "create") setUpdateAck(false);
  }

  function selectFile(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0] ?? null;
    setFile(selected);
    setPreflight(null);
    setError("");
  }

  async function runPreflight() {
    if (!file) {
      setError("Choose a CSV file before running preflight.");
      summaryRef.current?.focus();
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setError("This file is larger than the 10 MB pilot limit. Choose a smaller CSV.");
      summaryRef.current?.focus();
      return;
    }
    setBusy(true);
    setError("");
    try {
      setPreflight(await preflightImport(file, mode));
    } catch (reason) {
      setError(messageFor(reason));
      summaryRef.current?.focus();
    } finally {
      setBusy(false);
    }
  }

  const schemaBlocking = Boolean(preflight && (preflight.missing_columns.length || preflight.extra_columns.length || preflight.duplicate_columns.length || preflight.ambiguous_columns.length));
  const canConfirm = Boolean(preflight && preflight.job_id && preflight.valid_rows > 0 && !schemaBlocking && (mode === "create" || updateAck));

  return (
    <section className="page-stack import-new-page" aria-labelledby="new-import-title">
      <div className="page-heading"><p className="eyebrow">Data operations</p><h1 id="new-import-title">New import</h1><p className="page-description">Choose one explicit mode, run a no-write preflight, then confirm the exact valid and invalid row counts.</p></div>
      <div ref={summaryRef} className={`form-summary ${error ? "form-summary-visible" : ""}`} tabIndex={-1} role="alert" aria-live="polite">{error && <p>{error}</p>}</div>

      <section className="import-step" aria-labelledby="import-file-step"><div className="section-heading"><p className="eyebrow">Step 1</p><h2 id="import-file-step">Choose a CSV file</h2><p>CSV only, UTF-8 (with optional BOM), comma-separated, up to 10 MB and 10,000 rows.</p></div><div className="detail-actions"><button type="button" className="button-secondary" onClick={handleTemplate}>Download canonical template</button><button type="button" className="button-secondary" onClick={() => inputRef.current?.click()}>Choose CSV</button></div><label className="file-picker" htmlFor="import-file"><span>CSV file</span><input ref={inputRef} id="import-file" aria-label="CSV file" type="file" accept=".csv,text/csv" onChange={selectFile} />{file ? <strong>{file.name} <small>({Math.ceil(file.size / 1024)} KB)</small></strong> : <small>No file selected</small>}</label></section>

      <fieldset className="import-step mode-choice"><legend><span className="eyebrow">Step 2</span><span>Choose import mode</span></legend><p>Create rejects IDs already in the database. Update replaces matching customer values and re-scores them; it never creates missing IDs.</p><div className="radio-grid"><label><input type="radio" name="mode" value="create" checked={mode === "create"} onChange={() => selectMode("create")} /><span><strong>Create new customers</strong><small>Existing IDs become row errors; no silent updates.</small></span></label><label><input type="radio" name="mode" value="update" checked={mode === "update"} onChange={() => selectMode("update")} /><span><strong>Update existing customers</strong><small>Only existing IDs are eligible and all valid rows are re-scored.</small></span></label></div>{mode === "update" && <label className="acknowledge"><input type="checkbox" checked={updateAck} onChange={(event) => setUpdateAck(event.target.checked)} /> <span>I understand update mode replaces current values for matching IDs and creates new immutable prediction snapshots.</span></label>}</fieldset>

      <section className="import-step" aria-labelledby="import-preflight-step"><div className="section-heading"><p className="eyebrow">Step 3</p><h2 id="import-preflight-step">Run preflight</h2><p>No customer or prediction data is written during preflight. Review the result before confirming.</p></div><button type="button" disabled={!file || busy} onClick={runPreflight}>{busy ? "Checking file…" : "Run preflight"}</button></section>

      {preflight && <PreflightReview preflight={preflight} mode={mode} schemaBlocking={schemaBlocking} canConfirm={canConfirm} onConfirm={() => navigate(`/imports/${encodeURIComponent(preflight.job_id)}`)} />}
      <div className="form-actions"><Link className="button-link button-secondary" to="/imports">Cancel</Link></div>
    </section>
  );
}

function PreflightReview({ preflight, mode, schemaBlocking, canConfirm, onConfirm }: { preflight: ImportPreflight; mode: ImportMode; schemaBlocking: boolean; canConfirm: boolean; onConfirm: () => void }) {
  return <section className="preflight-panel" aria-labelledby="preflight-review-title"><div className="preview-heading"><div><p className="eyebrow">Step 4 · No data written</p><h2 id="preflight-review-title">Review preflight</h2><p className="page-description">{preflight.filename} · {mode === "create" ? "Create mode" : "Update mode"}</p></div><strong className="preflight-hash">{preflight.file_hash ? `Hash ${preflight.file_hash.slice(0, 12)}…` : "File checked"}</strong></div><dl className="import-counts import-counts-large"><div><dt>Total rows</dt><dd>{preflight.total_rows}</dd></div><div><dt>Valid rows</dt><dd>{preflight.valid_rows}</dd></div><div><dt>Invalid rows</dt><dd>{preflight.invalid_rows}</dd></div><div><dt>Warnings</dt><dd>{preflight.warning_count}</dd></div></dl>{schemaBlocking && <div className="import-alert" role="alert"><strong>Schema needs correction before confirmation.</strong><IssueList preflight={preflight} schemaOnly /></div>}<div className="preflight-columns"><section><h3>Column mapping</h3>{preflight.detected_columns.length ? <ul>{preflight.detected_columns.map((column) => <li key={column}><code>{column}</code>{preflight.mappings[column] && <> → <strong>{preflight.mappings[column]}</strong></>}</li>)}</ul> : <p>No columns returned.</p>}</section><section><h3>Row checks</h3><IssueList preflight={preflight} /></section></div>{preflight.sample_rows.length > 0 && <details><summary>View safe sample ({preflight.sample_rows.length} rows)</summary><div className="sample-scroll"><table className="customer-table sample-table"><caption className="sr-only">Safe preflight sample rows</caption><tbody>{preflight.sample_rows.map((row, index) => <tr key={index}>{Object.entries(row).slice(0, 8).map(([key, value]) => <td key={key} data-label={key}><strong>{key}</strong>{String(value)}</td>)}</tr>)}</tbody></table></div></details>}<div className="confirm-panel"><strong>Explicit confirmation</strong><p>{preflight.invalid_rows > 0 ? `${preflight.invalid_rows} invalid row${preflight.invalid_rows === 1 ? "" : "s"} will be skipped; valid rows can still be processed.` : "All rows passed validation."} Confirm only if this mode and count are correct.</p><button type="button" disabled={!canConfirm} onClick={onConfirm}>Continue to confirmation</button>{!canConfirm && <small>{schemaBlocking ? "Correct the schema before confirming." : preflight.valid_rows === 0 ? "There are no valid rows to process." : mode === "update" ? "Acknowledge update mode before confirming." : "Review the preflight before confirming."}</small>}</div></section>;
}

function IssueList({ preflight, schemaOnly = false }: { preflight: ImportPreflight; schemaOnly?: boolean }) {
  const issues = [
    ...preflight.missing_columns.map((value) => ({ code: "missing_column", message: value })),
    ...preflight.extra_columns.map((value) => ({ code: "extra_column", message: value })),
    ...preflight.duplicate_columns.map((value) => ({ code: "duplicate_column", message: value })),
    ...preflight.ambiguous_columns.map((value) => ({ code: "ambiguous_column", message: value })),
    ...(schemaOnly ? [] : preflight.duplicate_customer_ids.map((value) => ({ code: "duplicate_file_customer_id", message: value }))),
    ...(schemaOnly ? [] : preflight.database_conflicts.map((value) => ({ code: "database_conflict", message: value }))),
    ...(schemaOnly ? [] : preflight.database_missing.map((value) => ({ code: "customer_missing_for_update", message: value }))),
    ...(schemaOnly ? [] : preflight.errors.slice(0, 12).map((issue) => ({ code: issue.code, message: `Row ${issue.row_number ?? "?"}: ${issue.message}` }))),
  ];
  if (!issues.length) return <p className="issue-clear">No blocking issues found.</p>;
  return <ul className="issue-list">{issues.map((issue, index) => <li key={`${issue.code}-${issue.message}-${index}`}><strong>{issue.code}</strong><span>{issue.message}</span></li>)}</ul>;
}
