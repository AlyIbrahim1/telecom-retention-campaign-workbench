export function Pagination({
  label,
  page,
  pageCount,
  onPage,
  total,
  pageSize,
  itemLabel = "rows",
}: {
  label: string;
  page: number;
  pageCount: number;
  onPage: (page: number) => void;
  total?: number;
  pageSize?: number;
  itemLabel?: string;
}) {
  const from = total && pageSize ? (page - 1) * pageSize + 1 : null;
  const to = total && pageSize ? Math.min(page * pageSize, total) : null;
  return (
    <nav className="pagination" aria-label={label}>
      <span className="pagination-range">
        {from && to && total ? <>Showing <strong>{from.toLocaleString()}–{to.toLocaleString()}</strong> of {total.toLocaleString()} {itemLabel}</> : null}
      </span>
      <div className="pagination-controls">
        <button type="button" className="button-secondary button-small" disabled={page <= 1} onClick={() => onPage(1)} aria-label="First page">«</button>
        <button type="button" className="button-secondary button-small" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</button>
        <span className="pagination-page" aria-live="polite">Page {page} of {pageCount}</span>
        <button type="button" className="button-secondary button-small" disabled={page >= pageCount} onClick={() => onPage(page + 1)}>Next</button>
        <button type="button" className="button-secondary button-small" disabled={page >= pageCount} onClick={() => onPage(pageCount)} aria-label="Last page">»</button>
      </div>
    </nav>
  );
}

/* ------------------------------------------------------------------ */
/* Section heading inside a page                                       */
/* ------------------------------------------------------------------ */
