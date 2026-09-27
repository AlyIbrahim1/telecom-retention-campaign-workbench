export function LoadingState({ label, rows = 4 }: { label: string; rows?: number }) {
  return (
    <div className="loading-state" role="status" aria-live="polite">
      <span className="loading-label"><span className="spinner" aria-hidden="true" />{label}</span>
      <div className="skeleton-stack" aria-hidden="true">
        {Array.from({ length: rows }, (_, index) => <span key={index} className="skeleton-line" style={{ width: `${92 - index * 11}%` }} />)}
      </div>
    </div>
  );
}
