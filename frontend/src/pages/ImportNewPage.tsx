import { useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { Link, useNavigate } from "react-router-dom";

import { ApiError } from "../api/customers";
import { downloadTemplate, preflightImport, type ImportMode, type ImportPreflight } from "../api/imports";
import { Icon, Notice, PageHeader, SectionHeading, saveBlob } from "../components/index";
import { PreflightReview } from "../components/organisms/imports/PreflightReview";
import "../features/imports/imports.css";

const MAX_FILE_BYTES = 10 * 1024 * 1024;

function messageFor(error: unknown): string {
  if (!(error instanceof ApiError)) return "The preflight could not be completed. Your selected file and mode are still here.";
  if (error.problem.code === "import_limit_exceeded") return "This file is larger than the 10 MB upload limit. Choose a smaller CSV.";
  if (error.problem.code === "import_file_invalid" || error.problem.code === "import_schema_invalid") return error.message;
  if (error.status === 0) return "Import services could not be reached. Your selected file and mode are still here.";
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
  const [dragging, setDragging] = useState(false);

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
      setError("This file is larger than the 10 MB upload limit. Choose a smaller CSV.");
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
  const currentStep = preflight ? 4 : file ? 3 : 1;

  function handleDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setDragging(false);
    const dropped = event.dataTransfer.files?.[0];
    if (dropped) {
      setFile(dropped);
      setPreflight(null);
      setError("");
    }
  }

  return (
    <section className="page-stack import-new-page" aria-labelledby="new-import-title">
      <PageHeader
        titleId="new-import-title"
        crumbs={[{ label: "Overview", to: "/" }, { label: "Imports", to: "/imports" }, { label: "New import" }]}
        eyebrow="Data operations"
        title="New import"
        description="Choose one explicit mode, run a no-write preflight, then review the exact valid and invalid row counts before anything is written."
        actions={<button type="button" className="button-secondary" onClick={handleTemplate}><Icon name="download" size={18} />Download template</button>}
      />

      <ol className="stepper" aria-label="Import steps">
        {["Choose CSV", "Choose mode", "Run preflight", "Review results", "Confirm"].map((label, index) => {
          const number = index + 1;
          const state = number < currentStep ? "is-done" : number === currentStep ? "is-current" : undefined;
          return <li key={label} className={state} aria-current={number === currentStep ? "step" : undefined}><span className="stepper-index">{number < currentStep ? <Icon name="check" size={14} /> : number}</span><span>{label}</span></li>;
        })}
      </ol>

      <div ref={summaryRef} className={`form-summary${error ? " form-summary-visible" : ""}`} tabIndex={-1} role="alert" aria-live="assertive">{error && <p><Icon name="alert" size={18} />{error}</p>}</div>

      <div className="import-setup">
        <section className="panel import-step" aria-labelledby="import-file-step">
          <SectionHeading eyebrow="Step 1" title="Choose a CSV file" id="import-file-step">CSV only, UTF-8 (optional BOM), comma-separated, up to 10 MB and 10,000 rows.</SectionHeading>
          <label
            className={`dropzone${dragging ? " dropzone-active" : ""}${file ? " dropzone-filled" : ""}`}
            htmlFor="import-file"
            onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
          >
            <span className="dropzone-icon"><Icon name={file ? "file" : "upload"} size={26} /></span>
            {file ? (
              <span className="dropzone-copy"><strong>{file.name}</strong><small>{Math.ceil(file.size / 1024).toLocaleString()} KB · choose again to replace</small></span>
            ) : (
              <span className="dropzone-copy"><strong>Drop a CSV here or browse</strong><small>No file selected</small></span>
            )}
            <input ref={inputRef} id="import-file" aria-label="CSV file" type="file" accept=".csv,text/csv" onChange={selectFile} />
          </label>
          <p className="field-hint">Need the columns? <button type="button" className="text-button" onClick={handleTemplate}>Download the canonical template</button></p>
        </section>

        <fieldset className="panel import-step mode-choice">
          <legend className="sr-only">Step 2: Choose import mode</legend>
          <SectionHeading eyebrow="Step 2" title="Choose import mode">Create rejects IDs already in the database. Update replaces matching customer values and re-scores them; it never creates missing IDs.</SectionHeading>
          <div className="choice-grid">
            <label className={`choice-card${mode === "create" ? " is-selected" : ""}`}><input type="radio" name="mode" value="create" checked={mode === "create"} onChange={() => selectMode("create")} /><span><strong>Create new customers</strong><small>Existing IDs become row errors; no silent updates.</small></span></label>
            <label className={`choice-card${mode === "update" ? " is-selected" : ""}`}><input type="radio" name="mode" value="update" checked={mode === "update"} onChange={() => selectMode("update")} /><span><strong>Update existing customers</strong><small>Only existing IDs are eligible and all valid rows are re-scored.</small></span></label>
          </div>
          {mode === "update" && <label className="acknowledge"><input type="checkbox" checked={updateAck} onChange={(event) => setUpdateAck(event.target.checked)} /><span>I understand update mode replaces current values for matching IDs and creates new prediction snapshots.</span></label>}
        </fieldset>
      </div>

      <section className="panel import-step import-run" aria-labelledby="import-preflight-step">
        <SectionHeading eyebrow="Step 3" title="Run preflight" id="import-preflight-step">No customer or prediction data is written during preflight. Review the result before confirming.</SectionHeading>
        <div className="button-row">
          <button type="button" disabled={!file || busy} onClick={runPreflight}>{busy ? <><span className="spinner" aria-hidden="true" />Checking file…</> : <><Icon name="shield" size={18} />Run preflight</>}</button>
          {!file && <span className="field-hint">Choose a CSV file first.</span>}
        </div>
      </section>

      {preflight && <PreflightReview preflight={preflight} mode={mode} schemaBlocking={schemaBlocking} canConfirm={canConfirm} onConfirm={() => navigate(`/imports/${encodeURIComponent(preflight.job_id)}`)} />}
      <div className="button-row"><Link className="button-link button-ghost" to="/imports"><Icon name="arrowLeft" size={18} />Cancel and return to imports</Link></div>
    </section>
  );
}
