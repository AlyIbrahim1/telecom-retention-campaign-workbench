import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";

import { downloadOutreach, getOutreach, recordOutreach, type OutreachStatus } from "../../api/campaigns";
import { formatDate } from "../customers/CustomerBits";

const labels: Record<OutreachStatus, string> = {
  not_started: "Not started", attempted: "Attempted", no_answer: "No answer",
  reached: "Reached", offer_accepted: "Offer accepted", offer_declined: "Offer declined",
};
const recordable = ["attempted", "no_answer", "reached", "offer_accepted", "offer_declined"] as const;

export function OutreachPanel({ campaignId, archived }: { campaignId: string; archived: boolean }) {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState<OutreachStatus | "all">("all");
  const [editing, setEditing] = useState<string | null>(null);
  const [status, setStatus] = useState<typeof recordable[number]>("attempted");
  const [note, setNote] = useState("");
  const [key, setKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const query = useQuery({
    queryKey: ["outreach", campaignId, page, filter],
    queryFn: () => getOutreach(campaignId, page, filter === "all" ? undefined : filter),
  });

  function edit(selectionId: string) {
    setEditing(selectionId);
    setStatus("attempted");
    setNote("");
    setKey(null);
    setError("");
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) return;
    setBusy(true);
    setError("");
    const attemptKey = key ?? crypto.randomUUID();
    setKey(attemptKey);
    try {
      await recordOutreach(campaignId, editing, status, note, attemptKey);
      setEditing(null);
      setKey(null);
      await queryClient.invalidateQueries({ queryKey: ["outreach", campaignId] });
      await queryClient.invalidateQueries({ queryKey: ["workspace-overview"] });
    } catch {
      setError("Outcome could not be recorded. Your entry is still here; try again.");
    } finally {
      setBusy(false);
    }
  }

  async function exportCsv() {
    setError("");
    try {
      const blob = await downloadOutreach(campaignId);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${campaignId}-outreach.csv`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch {
      setError("Outreach CSV could not be downloaded. Try again.");
    }
  }

  const data = query.data;
  const summary = data?.summary;
  return <section className="campaign-review outreach-panel" aria-labelledby="outreach-title">
    <div className="section-heading"><p className="eyebrow">After confirmation</p><h2 id="outreach-title">Outreach queue</h2><p>Record simulated contact outcomes manually. No messages or calls are sent by this app.</p></div>
    {summary && <>
      <dl className="overview-summary" aria-label="Outreach progress">
        <div><dt>Selected</dt><dd>{summary.selected}</dd></div>
        <div><dt>Contacts recorded</dt><dd>{summary.contacted}</dd></div>
        <div><dt>Reached</dt><dd>{summary.reached}</dd></div>
        <div><dt>Accepted offers</dt><dd>{summary.accepted}</dd></div>
      </dl>
      <div className="campaign-confirm-panel">
        <h3>Illustrative net value: {summary.illustrative_net_value.toFixed(2)} dataset currency units</h3>
        <p>Accepted offers are associated with {summary.associated_value.toFixed(2)} units over {summary.value_horizon_months} months. Estimated contact cost is {summary.estimated_contact_cost.toFixed(2)} units at {summary.contact_cost_per_customer.toFixed(2)} per customer with a recorded outcome.</p>
        <p>This is an estimate based on entered outcomes and assumptions. It does not establish that the campaign prevented churn.</p>
      </div>
    </>}
    <div className="campaign-actions"><label htmlFor="outreach-filter">Status filter <select id="outreach-filter" value={filter} onChange={(event) => { setFilter(event.target.value as OutreachStatus | "all"); setPage(1); }}><option value="all">All</option>{(Object.keys(labels) as OutreachStatus[]).map((value) => <option key={value} value={value}>{labels[value]}</option>)}</select></label><button type="button" className="button-secondary" onClick={() => void exportCsv()}>Export outreach CSV</button></div>
    {error && <p className="import-alert" role="alert">{error}</p>}
    {query.isPending && <div className="loading-panel" role="status">Loading outreach queue…</div>}
    {query.isError && <div className="system-state" role="alert"><p>Outreach queue could not be loaded.</p><button type="button" onClick={() => void query.refetch()}>Try again</button></div>}
    {data && (data.total === 0 ? <div className="empty-panel"><strong>No customers match this view.</strong><p>{summary?.selected ? "Change the status filter to see other selections." : "This campaign has no confirmed selections."}</p></div> : <>
      <div className="table-scroll"><table className="customer-table campaign-table"><caption className="sr-only">Confirmed outreach selections</caption><thead><tr><th scope="col">Customer</th><th scope="col">Risk score</th><th scope="col">Priority</th><th scope="col">Monthly charges</th><th scope="col">Contact status</th><th scope="col">History and action</th></tr></thead><tbody>{data.items.map((item) => <tr key={item.selection_id}>
        <th scope="row"><Link to={`/customers/${encodeURIComponent(item.customer_id)}`}>{item.customer_id}</Link></th><td>{(item.risk_score * 100).toFixed(1)}%</td><td>{item.priority_score.toFixed(1)}</td><td>{item.monthly_charges.toFixed(2)}</td><td>{labels[item.status]}</td><td>{item.events.length > 0 && <details><summary>History ({item.events.length})</summary><ol>{item.events.map((entry) => <li key={entry.event_id}>{labels[entry.status]} · {formatDate(entry.created_at)} · {entry.actor}{entry.note && <p>{entry.note}</p>}</li>)}</ol></details>}{!archived && <button type="button" className="button-secondary" onClick={() => edit(item.selection_id)}>Record outcome</button>}{editing === item.selection_id && !archived && <form onSubmit={(event) => void save(event)}><label>Status <select value={status} onChange={(event) => { setStatus(event.target.value as typeof status); setKey(null); }}>{recordable.map((value) => <option key={value} value={value}>{labels[value]}</option>)}</select></label><label>Note (optional) <textarea value={note} maxLength={500} onChange={(event) => { setNote(event.target.value); setKey(null); }} /></label><div className="form-actions"><button type="submit" disabled={busy}>{busy ? "Saving…" : "Save outcome"}</button><button type="button" className="button-secondary" onClick={() => setEditing(null)}>Cancel</button></div></form>}</td>
      </tr>)}</tbody></table></div>
      <div className="campaign-actions"><button type="button" className="button-secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button><span>Page {page} of {Math.ceil(data.total / data.page_size)}</span><button type="button" className="button-secondary" disabled={page * data.page_size >= data.total} onClick={() => setPage(page + 1)}>Next</button></div>
    </>)}
  </section>;
}
