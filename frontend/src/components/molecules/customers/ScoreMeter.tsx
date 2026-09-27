import type { Prediction } from "../../../api/customers";

/** Compact score display: a bold percentage plus a 0–100 bar. */
export function ScoreMeter({ score, threshold, label = "Model score", size = "sm" }: { score: number | null | undefined; threshold?: number | null; label?: string; size?: "sm" | "lg" }) {
  if (score === null || score === undefined || Number.isNaN(score)) {
    return <span className="score-missing">No score yet</span>;
  }
  const percentage = Math.round(score * 100);
  const above = threshold !== null && threshold !== undefined ? score >= threshold : percentage >= 50;
  return (
    <span className={`score-meter score-meter-${size}${above ? " score-meter-high" : ""}`}>
      <span className="score-meter-top">
        <strong className="score-value">{percentage}%</strong>
        <span className="score-label">{label}</span>
      </span>
      <span className="score-bar" aria-hidden="true">
        <span className="score-bar-fill" style={{ width: `${percentage}%` }} />
        {threshold !== null && threshold !== undefined && <span className="score-bar-threshold" style={{ left: `${Math.round(threshold * 100)}%` }} />}
      </span>
    </span>
  );
}

export function ModelScore({ prediction, size = "sm" }: { prediction: Prediction | null; size?: "sm" | "lg" }) {
  if (!prediction) {
    return <span className="score-missing">No score yet</span>;
  }
  return <ScoreMeter score={prediction.risk_score} threshold={prediction.threshold} size={size} />;
}
