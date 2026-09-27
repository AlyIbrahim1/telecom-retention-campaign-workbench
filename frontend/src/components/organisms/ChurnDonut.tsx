import { useState } from "react";

import type { PredictionOverview } from "../../api/overview";

type Segment = { key: "churn" | "stay"; label: string; value: number; className: string };

const RADIUS = 80;
const STROKE = 26;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const GAP = 3; // surface gap between arcs, in SVG units

const percent = (value: number) => (value > 0 && value < 0.005 ? "<1%" : `${Math.round(value * 100)}%`);

/** Donut of predicted churn vs predicted no churn among scored active customers. */
export function ChurnDonut({ data }: { data: PredictionOverview }) {
  const [active, setActive] = useState<Segment["key"]>("churn");
  const total = data.scored_customers;
  const segments: Segment[] = [
    { key: "churn", label: "Predicted to churn", value: data.predicted_churn, className: "donut-churn" },
    { key: "stay", label: "Predicted not to churn", value: data.predicted_no_churn, className: "donut-stay" },
  ];
  const visible = segments.filter((segment) => segment.value > 0);
  let offset = 0;
  const arcs = visible.map((segment) => {
    const length = total ? (segment.value / total) * CIRCUMFERENCE : 0;
    const drawn = visible.length > 1 ? Math.max(0, length - GAP) : length;
    const arc = { ...segment, dash: `${drawn} ${CIRCUMFERENCE - drawn}`, offset: -offset };
    offset += length;
    return arc;
  });
  const focus = segments.find((segment) => segment.key === active) ?? segments[0];
  const threshold = data.threshold !== null ? `${Math.round(data.threshold * 100)}%` : null;

  return (
    <div className="donut">
      <div className="donut-figure">
        <svg
          viewBox="0 0 200 200"
          role="img"
          aria-label={`Model predictions for ${total.toLocaleString("en")} scored customers: ${percent(total ? data.predicted_churn / total : 0)} predicted to churn, ${percent(total ? data.predicted_no_churn / total : 0)} predicted not to churn.`}
        >
          <circle className="donut-track" cx="100" cy="100" r={RADIUS} />
          {arcs.map((arc) => (
            <circle
              key={arc.key}
              className={`donut-arc ${arc.className}${active === arc.key ? " is-active" : ""}`}
              cx="100"
              cy="100"
              r={RADIUS}
              strokeWidth={STROKE}
              strokeDasharray={arc.dash}
              strokeDashoffset={arc.offset}
              transform="rotate(-90 100 100)"
              onMouseEnter={() => setActive(arc.key)}
            />
          ))}
        </svg>
        <div className="donut-center" aria-hidden="true">
          <strong>{percent(total ? focus.value / total : 0)}</strong>
          <span>{focus.key === "churn" ? "predicted churn" : "predicted no churn"}</span>
        </div>
      </div>
      <ul className="donut-legend">
        {segments.map((segment) => (
          <li
            key={segment.key}
            tabIndex={0}
            className={active === segment.key ? "is-active" : undefined}
            onMouseEnter={() => setActive(segment.key)}
            onFocus={() => setActive(segment.key)}
            aria-label={`${segment.label}: ${percent(total ? segment.value / total : 0)}, ${segment.value.toLocaleString("en")} customers`}
          >
            <span className={`donut-swatch ${segment.className}`} aria-hidden="true" />
            <span className="donut-legend-label" aria-hidden="true">{segment.label}</span>
            <span className="donut-legend-value" aria-hidden="true"><strong>{percent(total ? segment.value / total : 0)}</strong>{segment.value.toLocaleString("en")}</span>
          </li>
        ))}
      </ul>
      <p className="donut-note">
        {threshold ? `Churn is predicted when the latest model score is at or above the ${threshold} threshold.` : "Based on each customer's latest model prediction."}
        {" "}Predictions, not observed outcomes.
        {data.unscored_customers > 0 && ` ${data.unscored_customers.toLocaleString("en")} active customers have no score yet.`}
      </p>
    </div>
  );
}
