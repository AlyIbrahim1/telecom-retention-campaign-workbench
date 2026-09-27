import type { CustomerOverview, HistogramBin, MixItem, ShareItem } from "../../api/overview";

const count = (value: number) => value.toLocaleString("en");
const percent = (value: number) => (value > 0 && value < 0.005 ? "<1%" : `${Math.round(value * 100)}%`);
const money = (value: number) => value.toLocaleString("en", { maximumFractionDigits: 0 });

function niceMax(value: number): { max: number; step: number } {
  if (value <= 0) return { max: 4, step: 1 };
  const rough = value / 4;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((factor) => factor * magnitude).find((candidate) => candidate >= rough) ?? 10 * magnitude;
  return { max: Math.ceil(value / step) * step, step };
}

/** Single-series column histogram with a hover/focus tooltip per column. */
export function Histogram({
  bins,
  describe,
  xLabel,
  xTicks,
  caption,
}: {
  bins: HistogramBin[];
  describe: (bin: HistogramBin) => string;
  xLabel: string;
  xTicks: Array<{ value: number; label: string }>;
  caption: string;
}) {
  const total = bins.reduce((sum, bin) => sum + bin.customers, 0);
  const peak = Math.max(0, ...bins.map((bin) => bin.customers));
  const { max, step } = niceMax(peak);
  const ticks = Array.from({ length: Math.round(max / step) + 1 }, (_, index) => index * step);
  const domainMax = bins.length ? bins[bins.length - 1].upper : 1;
  return (
    <figure className="histogram">
      <figcaption className="sr-only">{caption}</figcaption>
      <div className="histogram-body">
        <div className="histogram-y" aria-hidden="true">
          {ticks.slice().reverse().map((tick) => <span key={tick}>{count(tick)}</span>)}
        </div>
        <div className="histogram-plot">
          <div className="histogram-grid" aria-hidden="true">
            {ticks.map((tick) => <span key={tick} style={{ bottom: `${(tick / max) * 100}%` }} />)}
          </div>
          <ol className="histogram-bins">
            {bins.map((bin) => {
              const share = total ? bin.customers / total : 0;
              return (
                <li key={bin.lower} className="histogram-bin" tabIndex={0} aria-label={`${describe(bin)}: ${count(bin.customers)} customers (${percent(share)})`}>
                  <span className="histogram-column" style={{ height: `${max ? (bin.customers / max) * 100 : 0}%` }} />
                  <span className="chart-tooltip" aria-hidden="true">
                    <strong>{describe(bin)}</strong>
                    <span>{count(bin.customers)} customers</span>
                    <span>{percent(share)} of active customers</span>
                  </span>
                </li>
              );
            })}
          </ol>
        </div>
      </div>
      <div className="histogram-x" aria-hidden="true">
        {xTicks.map((tick) => <span key={tick.value} style={{ left: `${(tick.value / domainMax) * 100}%` }}>{tick.label}</span>)}
      </div>
      <p className="chart-axis-title" aria-hidden="true">{xLabel}</p>
    </figure>
  );
}

/** Horizontal bars for a categorical mix: share and count beside each bar. */
export function MixBars({ items, labels }: { items: MixItem[]; labels?: Record<string, string> }) {
  const total = items.reduce((sum, item) => sum + item.customers, 0);
  const peak = Math.max(1, ...items.map((item) => item.customers));
  return (
    <ul className="bar-list">
      {items.map((item) => {
        const name = labels?.[item.label] ?? item.label;
        const share = total ? item.customers / total : 0;
        return (
          <li key={item.label} className="bar-row" tabIndex={0} aria-label={`${name}: ${count(item.customers)} customers, ${percent(share)}`}>
            <div className="bar-row-meta" aria-hidden="true">
              <span className="bar-row-label">{name}</span>
              <span className="bar-row-value"><strong>{percent(share)}</strong>{count(item.customers)}</span>
            </div>
            <span className="bar-row-track" aria-hidden="true">
              <span className="bar-row-fill" style={{ width: `${(item.customers / peak) * 100}%` }} />
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** Share of a base that has a feature, as a meter against a tinted track. */
export function ShareMeters({ items, baseLabel = "customers" }: { items: ShareItem[]; baseLabel?: string }) {
  return (
    <ul className="bar-list">
      {items.map((item) => {
        const share = item.base ? item.customers / item.base : 0;
        return (
          <li key={item.key} className="bar-row" tabIndex={0} aria-label={`${item.label}: ${percent(share)}, ${count(item.customers)} of ${count(item.base)} ${baseLabel}`}>
            <div className="bar-row-meta" aria-hidden="true">
              <span className="bar-row-label">{item.label}</span>
              <span className="bar-row-value"><strong>{percent(share)}</strong>{count(item.customers)}</span>
            </div>
            <span className="bar-row-track bar-row-track-meter" aria-hidden="true">
              <span className="bar-row-fill" style={{ width: `${share * 100}%` }} />
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export function InsightTables({ data }: { data: CustomerOverview }) {
  const mixes: Array<[string, MixItem[]]> = [
    ["Contract", data.by_contract],
    ["Internet service", data.by_internet_service],
    ["Payment method", data.by_payment_method],
  ];
  const shares: Array<[string, ShareItem[]]> = [
    ["Add-on (internet customers)", data.add_on_adoption],
    ["Account profile", data.account_profile],
  ];
  const histograms: Array<[string, HistogramBin[], (bin: HistogramBin) => string]> = [
    ["Tenure", data.tenure_distribution, (bin) => `${bin.lower}–${bin.upper} months`],
    ["Monthly charges", data.monthly_charges_distribution, (bin) => `${money(bin.lower)}–${money(bin.upper)}`],
  ];
  return (
    <details className="disclosure chart-table">
      <summary>View the data as tables</summary>
      <div className="table-scroll" tabIndex={0} role="region" aria-label="Customer mix table">
        <table className="data-table">
          <caption>Customer mix</caption>
          <thead><tr><th scope="col">Category</th><th scope="col" className="num">Customers</th><th scope="col" className="num">Share</th></tr></thead>
          <tbody>
            {mixes.flatMap(([group, rows]) => {
              const total = rows.reduce((sum, row) => sum + row.customers, 0);
              return rows.map((row) => (
                <tr key={`${group}-${row.label}`}>
                  <th scope="row">{group}: {row.label === "No" ? "No internet" : row.label}</th>
                  <td className="num" data-label="Customers">{count(row.customers)}</td>
                  <td className="num" data-label="Share">{percent(total ? row.customers / total : 0)}</td>
                </tr>
              ));
            })}
            {shares.flatMap(([group, rows]) => rows.map((row) => (
              <tr key={`${group}-${row.key}`}>
                <th scope="row">{group}: {row.label}</th>
                <td className="num" data-label="Customers">{count(row.customers)} of {count(row.base)}</td>
                <td className="num" data-label="Share">{percent(row.base ? row.customers / row.base : 0)}</td>
              </tr>
            )))}
          </tbody>
        </table>
      </div>
      <div className="table-scroll" tabIndex={0} role="region" aria-label="Distribution table">
        <table className="data-table">
          <caption>Distributions</caption>
          <thead><tr><th scope="col">Band</th><th scope="col" className="num">Customers</th></tr></thead>
          <tbody>
            {histograms.flatMap(([group, bins, describe]) => bins.map((bin) => (
              <tr key={`${group}-${bin.lower}`}>
                <th scope="row">{group}: {describe(bin)}</th>
                <td className="num" data-label="Customers">{count(bin.customers)}</td>
              </tr>
            )))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
