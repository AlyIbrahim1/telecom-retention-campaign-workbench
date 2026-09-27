import type { ImportJob } from "../../../api/imports";
import type { Tone } from "../Notice";

export function ImportCounts({ job }: { job: ImportJob }) {
  const items: Array<{ label: string; value: number; tone?: Tone }> = [
    { label: "Total rows", value: job.total_rows },
    { label: "Valid rows", value: job.valid_rows, tone: "success" },
    { label: "Invalid rows", value: job.invalid_rows, tone: job.invalid_rows ? "danger" : undefined },
    { label: "Warnings", value: job.warning_count, tone: job.warning_count ? "warning" : undefined },
    { label: "Succeeded", value: job.succeeded_rows, tone: "success" },
    { label: "Failed", value: job.failed_rows, tone: job.failed_rows ? "danger" : undefined },
  ];
  return (
    <dl className="stat-grid stat-grid-6">
      {items.map((item) => <div key={item.label} className={item.tone ? `stat stat-${item.tone}` : "stat"}><dt>{item.label}</dt><dd>{item.value.toLocaleString()}</dd></div>)}
    </dl>
  );
}
