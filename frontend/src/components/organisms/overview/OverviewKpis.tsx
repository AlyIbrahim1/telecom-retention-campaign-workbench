import type { CustomerOverview } from "../../../api/overview";

const units = (value: number | null, digits = 2) =>
  value === null ? "—" : value.toLocaleString("en", { minimumFractionDigits: digits, maximumFractionDigits: digits });

export function OverviewKpis({ data }: { data: CustomerOverview }) {
  const internetShare = data.active_customers ? Math.round((data.internet_customers / data.active_customers) * 100) : 0;
  const tiles: Array<{ label: string; value: string; note?: string; lead?: boolean }> = [
    { label: "Active customers", value: data.active_customers.toLocaleString("en"), note: data.inactive_customers ? `${data.inactive_customers.toLocaleString("en")} inactive` : "No inactive records", lead: true },
    { label: "Monthly charges, total", value: units(data.monthly_charges_total, 0), note: "Dataset currency units" },
    { label: "Average monthly charge", value: units(data.monthly_charges_average), note: `Median ${units(data.monthly_charges_median)}` },
    { label: "Average tenure", value: data.tenure_average === null ? "—" : `${data.tenure_average.toLocaleString("en")} mo`, note: `Median ${data.tenure_median ?? "—"} months` },
    { label: "Average total charges", value: units(data.total_charges_average, 0), note: "Lifetime per customer" },
    { label: "Internet subscribers", value: `${internetShare}%`, note: `${data.internet_customers.toLocaleString("en")} customers` },
  ];
  return (
    <dl className="kpi-grid" aria-label="Customer dataset summary">
      {tiles.map((tile) => (
        <div key={tile.label} className={`kpi${tile.lead ? " kpi-lead" : ""}`}>
          <dt>{tile.label}</dt>
          <dd>
            <strong>{tile.value}</strong>
            {tile.note && <span>{tile.note}</span>}
          </dd>
        </div>
      ))}
    </dl>
  );
}
