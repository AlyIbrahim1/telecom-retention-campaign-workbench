import type { ImportMode, ImportPreflight } from "../../../api/imports";
import { Icon, Notice, SectionHeading } from "../../index";

export function PreflightReview({ preflight, mode, schemaBlocking, canConfirm, onConfirm }: { preflight: ImportPreflight; mode: ImportMode; schemaBlocking: boolean; canConfirm: boolean; onConfirm: () => void }) {
  const sampleColumns = preflight.sample_rows.length ? Object.keys(preflight.sample_rows[0]).slice(0, 10) : [];
  const writeVerb = mode === "create" ? "created" : "updated and re-scored";
  return (
    <section className="panel preflight-panel" aria-labelledby="preflight-review-title">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Step 4 · No data written</p>
          <h2 id="preflight-review-title">Review preflight</h2>
          <p className="section-heading-text">{preflight.filename} · {mode === "create" ? "Create mode" : "Update mode"}</p>
        </div>
        {preflight.file_hash ? <span className="hash-chip" title={preflight.file_hash}><span className="hash-label">SHA-256</span><code>{preflight.file_hash.slice(0, 16)}…</code></span> : <span className="hash-chip">File checked</span>}
      </div>

      <dl className="stat-grid stat-grid-4">
        <div className="stat"><dt>Total rows</dt><dd>{preflight.total_rows}</dd></div>
        <div className="stat stat-success"><dt>Valid rows</dt><dd>{preflight.valid_rows}</dd></div>
        <div className={preflight.invalid_rows ? "stat stat-danger" : "stat"}><dt>Invalid rows</dt><dd>{preflight.invalid_rows}</dd></div>
        <div className={preflight.warning_count ? "stat stat-warning" : "stat"}><dt>Warnings</dt><dd>{preflight.warning_count}</dd></div>
      </dl>

      {schemaBlocking && <Notice tone="danger" role="alert" title="Schema needs correction before confirmation."><IssueList preflight={preflight} schemaOnly /></Notice>}

      <div className="outcome-split" aria-label="What confirmation will do">
        <div className="outcome outcome-write"><Icon name="check" size={18} /><span><strong>{schemaBlocking ? 0 : preflight.valid_rows.toLocaleString()} row{preflight.valid_rows === 1 ? "" : "s"}</strong> will be {writeVerb} after you confirm on the next screen.</span></div>
        <div className="outcome outcome-skip"><Icon name="x" size={18} /><span><strong>{preflight.invalid_rows.toLocaleString()} row{preflight.invalid_rows === 1 ? "" : "s"}</strong> will be skipped and reported in the error CSV. Skipped rows never write customer data.</span></div>
      </div>

      <div className="preflight-columns">
        <section aria-labelledby="mapping-title">
          <h3 id="mapping-title">Column mapping</h3>
          {preflight.detected_columns.length ? (
            <div className="mapping-list-wrap">
              <table className="mapping-table">
                <caption className="sr-only">Detected CSV columns and the customer fields they map to</caption>
                <thead><tr><th scope="col">CSV column</th><th scope="col">Customer field</th></tr></thead>
                <tbody>{preflight.detected_columns.map((column) => <tr key={column}><td><code>{column}</code></td><td>{preflight.mappings[column] ? preflight.mappings[column] : <span className="cell-muted">Not mapped</span>}</td></tr>)}</tbody>
              </table>
            </div>
          ) : <p className="cell-muted">No columns returned.</p>}
        </section>
        <section aria-labelledby="row-checks-title">
          <h3 id="row-checks-title">Row checks</h3>
          <IssueList preflight={preflight} />
        </section>
      </div>

      {preflight.sample_rows.length > 0 && (
        <details className="disclosure">
          <summary>View safe sample ({preflight.sample_rows.length} rows)</summary>
          <div className="table-scroll sample-scroll" tabIndex={0} role="region" aria-label="Safe sample rows">
            <table className="data-table sample-table">
              <caption className="sr-only">Safe preflight sample rows</caption>
              <thead><tr>{sampleColumns.map((key) => <th scope="col" key={key}>{key}</th>)}</tr></thead>
              <tbody>{preflight.sample_rows.map((row, index) => <tr key={index}>{sampleColumns.map((key) => <td key={key} data-label={key}>{String(row[key] ?? "")}</td>)}</tr>)}</tbody>
            </table>
          </div>
        </details>
      )}

      <div className="confirm-bar">
        <div>
          <strong>Explicit confirmation</strong>
          <p>{preflight.invalid_rows > 0 ? `${preflight.invalid_rows} invalid row${preflight.invalid_rows === 1 ? "" : "s"} will be skipped; valid rows can still be processed.` : "All rows passed validation."} Continue only if this mode and count are correct.</p>
          {!canConfirm && <p className="field-hint">{schemaBlocking ? "Correct the schema before confirming." : preflight.valid_rows === 0 ? "There are no valid rows to process." : mode === "update" ? "Acknowledge update mode in step 2 before confirming." : "Review the preflight before confirming."}</p>}
        </div>
        <button type="button" disabled={!canConfirm} onClick={onConfirm}>Continue to confirmation<Icon name="arrowRight" size={18} /></button>
      </div>
    </section>
  );
}

function IssueList({ preflight, schemaOnly = false }: { preflight: ImportPreflight; schemaOnly?: boolean }) {
  const issues = [
    ...preflight.missing_columns.map((value) => ({ code: "Missing column", message: value })),
    ...preflight.extra_columns.map((value) => ({ code: "Unexpected column", message: value })),
    ...preflight.duplicate_columns.map((value) => ({ code: "Duplicate column", message: value })),
    ...preflight.ambiguous_columns.map((value) => ({ code: "Ambiguous column", message: value })),
    ...(schemaOnly ? [] : preflight.duplicate_customer_ids.map((value) => ({ code: "Duplicate ID in file", message: value }))),
    ...(schemaOnly ? [] : preflight.database_conflicts.map((value) => ({ code: "Already exists", message: value }))),
    ...(schemaOnly ? [] : preflight.database_missing.map((value) => ({ code: "Not found for update", message: value }))),
    ...(schemaOnly ? [] : preflight.errors.slice(0, 12).map((issue) => ({ code: humanCode(issue.code), message: `${issue.row_number ? `Row ${issue.row_number}` : issue.field ? `Field ${issue.field}` : "Row"}${issue.customer_id ? ` (${issue.customer_id})` : ""}: ${issue.message}` }))),
    ...(schemaOnly ? [] : preflight.warnings.slice(0, 6).map((issue) => ({ code: "Warning", message: `${issue.row_number ? `Row ${issue.row_number}: ` : ""}${issue.message}` }))),
  ];
  if (!issues.length) return <p className="issue-clear"><Icon name="check" size={18} />No blocking issues found.</p>;
  const hidden = schemaOnly ? 0 : Math.max(0, preflight.errors.length - 12);
  return (
    <>
      <ul className="issue-list">{issues.map((issue, index) => <li key={`${issue.code}-${issue.message}-${index}`}><span className={`issue-code${issue.code === "Warning" ? " issue-code-warning" : ""}`}>{issue.code}</span><span>{issue.message}</span></li>)}</ul>
      {hidden > 0 && <p className="field-hint">{hidden} more row error{hidden === 1 ? "" : "s"} will be listed in the error CSV after processing.</p>}
    </>
  );
}

function humanCode(code: string): string {
  const text = code.replaceAll("_", " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}
