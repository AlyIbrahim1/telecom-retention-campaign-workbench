import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Fragment, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";

import { downloadOutreach, getOutreach, recordOutreach, type OutreachItem, type OutreachStatus } from "../../api/campaigns";
import { Badge, EmptyState, Icon, LoadingState, Notice, Pagination, SectionHeading, saveBlob, type Tone } from "../index";
import { formatAmount, formatDate } from "../index";

const labels: Record<OutreachStatus, string> = {
  not_started: "Not started", attempted: "Attempted", no_answer: "No answer",
  reached: "Reached", offer_accepted: "Offer accepted", offer_declined: "Offer declined",
};
const tones: Record<OutreachStatus, { tone: Tone; glyph: string }> = {
  not_started: { tone: "neutral", glyph: "○" },
  attempted: { tone: "info", glyph: "◌" },
  no_answer: { tone: "warning", glyph: "–" },
  reached: { tone: "info", glyph: "●" },
  offer_accepted: { tone: "success", glyph: "✓" },
  offer_declined: { tone: "neutral", glyph: "×" },
};
const recordable = ["attempted", "no_answer", "reached", "offer_accepted", "offer_declined"] as const;

function OutreachBadge({ status }: { status: OutreachStatus }) {
  return <Badge tone={tones[status].tone} icon={tones[status].glyph}>{labels[status]}</Badge>;
}

function units(value: number): string {
  return value.toFixed(2);
}

export function OutreachPanel({ campaignId, archived }: { campaignId: string; archived: boolean }) {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState<OutreachStatus | "all">("all");
  const [editing, setEditing] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState<typeof recordable[number]>("attempted");
  const [note, setNote] = useState("");
  const [key, setKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const formRef = useRef<HTMLFormElement>(null);
  const query = useQuery({
    queryKey: ["outreach", campaignId, page, filter],
    queryFn: () => getOutreach(campaignId, page, filter === "all" ? undefined : filter),
    placeholderData: (previous) => previous,
  });

  function edit(item: OutreachItem) {
    setEditing(item.selection_id);
    setStatus("attempted");
    setNote("");
    setKey(null);
    setError("");
    setSaved("");
    window.setTimeout(() => formRef.current?.querySelector<HTMLElement>("select")?.focus(), 0);
  }

  function toggleHistory(selectionId: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(selectionId)) next.delete(selectionId);
      else next.add(selectionId);
      return next;
    });
  }

  async function save(event: FormEvent<HTMLFormElement>, customerId: string) {
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
      setSaved(`${labels[status]} recorded for ${customerId}.`);
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
      await saveBlob(await downloadOutreach(campaignId), `${campaignId}-outreach.csv`);
    } catch {
      setError("Outreach CSV could not be downloaded. Try again.");
    }
  }

  const data = query.data;
  const summary = data?.summary;
  const pageCount = data ? Math.max(1, Math.ceil(data.total / (data.page_size || 25))) : 1;
  const contactedPercent = summary && summary.selected ? Math.round((summary.contacted / summary.selected) * 100) : 0;

  return (
    <section className="panel outreach-panel" aria-labelledby="outreach-title">
      <SectionHeading
        eyebrow={archived ? "Archived — read only" : "After confirmation"}
        title="Outreach queue"
        id="outreach-title"
        actions={<button type="button" className="button-secondary button-small" onClick={() => void exportCsv()}><Icon name="download" size={16} />Export outreach CSV</button>}
      >
        {archived ? "Recorded outcomes stay readable. New outcome entry is unavailable for archived campaigns." : "Record simulated contact outcomes manually. No messages or calls are sent by this app."}
      </SectionHeading>

      {summary && (
        <div className="outreach-summary">
          <div className="outreach-progress">
            <dl className="stat-grid stat-grid-4" aria-label="Outreach progress">
              <div className="stat"><dt>Selected</dt><dd>{summary.selected.toLocaleString()}</dd></div>
              <div className="stat"><dt>Contacts recorded</dt><dd>{summary.contacted.toLocaleString()}</dd></div>
              <div className="stat"><dt>Reached</dt><dd>{summary.reached.toLocaleString()}</dd></div>
              <div className="stat stat-success"><dt>Accepted offers</dt><dd>{summary.accepted.toLocaleString()}</dd></div>
            </dl>
            <div className="progress-block">
              <div className="progress-meta"><strong>{contactedPercent}%</strong><span>of selected customers have a recorded outcome</span></div>
              <div className="progress-track" role="progressbar" aria-label="Selected customers with a recorded outcome" aria-valuemin={0} aria-valuemax={summary.selected || 1} aria-valuenow={summary.contacted}><span className="progress-fill" style={{ width: `${contactedPercent}%` }} /></div>
            </div>
          </div>

          <section className="estimate-card" aria-labelledby="estimate-title">
            <p className="eyebrow">Illustrative estimate</p>
            <h3 id="estimate-title">Illustrative net value</h3>
            <p className={`estimate-figure${summary.illustrative_net_value < 0 ? " estimate-negative" : ""}`}>{units(summary.illustrative_net_value)}<span> dataset currency units</span></p>
            <dl className="estimate-math" aria-label="Estimate assumptions">
              <div><dt>Accepted offers' saved monthly charges × {summary.value_horizon_months} months</dt><dd>+{units(summary.associated_value)}</dd></div>
              <div><dt>{summary.contacted.toLocaleString()} recorded contact{summary.contacted === 1 ? "" : "s"} × {units(summary.contact_cost_per_customer)} per customer</dt><dd>−{units(summary.estimated_contact_cost)}</dd></div>
              <div className="estimate-total"><dt>Illustrative net value</dt><dd>{units(summary.illustrative_net_value)}</dd></div>
            </dl>
            <p className="estimate-caveat">An estimate from manually entered outcomes and the campaign's assumptions. It is not realized savings and does not show that churn was prevented.</p>
          </section>
        </div>
      )}

      <div className="table-controls">
        <label className="field field-inline" htmlFor="outreach-filter">
          <span className="field-label">Status filter</span>
          <select id="outreach-filter" value={filter} onChange={(event) => { setFilter(event.target.value as OutreachStatus | "all"); setPage(1); }}>
            <option value="all">All statuses</option>
            {(Object.keys(labels) as OutreachStatus[]).map((value) => <option key={value} value={value}>{labels[value]}</option>)}
          </select>
        </label>
        {query.isFetching && data && <span className="inline-loading"><span className="spinner" aria-hidden="true" />Updating</span>}
      </div>

      {saved && <Notice tone="success" role="status">{saved}</Notice>}
      {error && <Notice tone="danger" role="alert">{error}</Notice>}
      {query.isPending && <LoadingState label="Loading outreach queue…" rows={4} />}
      {query.isError && !data && <Notice tone="danger" role="alert" title="Outreach queue could not be loaded." actions={<button type="button" className="button-small" onClick={() => void query.refetch()}><Icon name="refresh" size={16} />Try again</button>} />}

      {data && (data.total === 0 ? (
        <EmptyState compact icon="users" title="No customers match this view.">
          <p>{summary?.selected ? "Change the status filter to see other selections." : "This campaign has no confirmed selections."}</p>
        </EmptyState>
      ) : <>
        <div className="table-frame">
          <div className="table-scroll" tabIndex={0} role="region" aria-label="Outreach queue table">
            <table className="data-table outreach-table">
              <caption className="sr-only">Confirmed outreach selections</caption>
              <thead><tr><th scope="col">Customer</th><th scope="col" className="num">Risk score</th><th scope="col" className="num">Priority</th><th scope="col" className="num">Monthly charges</th><th scope="col">Contact status</th><th scope="col">Last activity</th><th scope="col">Actions</th></tr></thead>
              <tbody>{data.items.map((item) => {
                const latest = item.events[item.events.length - 1];
                const open = expanded.has(item.selection_id) || editing === item.selection_id;
                const rowId = `outreach-${item.selection_id}`;
                return <Fragment key={item.selection_id}>
                  <tr className={open ? "row-expanded" : undefined}>
                    <th scope="row" data-label="Customer" id={rowId}><Link className="record-link" to={`/customers/${encodeURIComponent(item.customer_id)}`}>{item.customer_id}</Link></th>
                    <td data-label="Risk score" className="num">{(item.risk_score * 100).toFixed(1)}%</td>
                    <td data-label="Priority" className="num">{item.priority_score.toFixed(1)}</td>
                    <td data-label="Monthly charges" className="num">{formatAmount(item.monthly_charges)}<span className="cell-note">Saved at confirmation</span></td>
                    <td data-label="Contact status"><OutreachBadge status={item.status} /></td>
                    <td data-label="Last activity" className="cell-date">{latest ? <>{formatDate(latest.created_at)}<span className="cell-note">by {latest.actor}</span></> : <span className="cell-muted">No events yet</span>}</td>
                    <td data-label="Actions" className="action-cell">
                      <div className="button-row button-row-tight">
                        {!archived && <button type="button" className="button-secondary button-small" aria-describedby={rowId} onClick={() => edit(item)}>Record outcome</button>}
                        {item.events.length > 0 && <button type="button" className="button-ghost button-small" aria-expanded={expanded.has(item.selection_id)} aria-describedby={rowId} onClick={() => toggleHistory(item.selection_id)}><Icon name="history" size={16} />History ({item.events.length})</button>}
                      </div>
                    </td>
                  </tr>
                  {open && <tr className="row-detail">
                    <td colSpan={7}>
                      <div className="row-detail-grid">
                        {item.events.length > 0 && expanded.has(item.selection_id) && (
                          <div>
                            <h4 className="row-detail-title">Event history <span className="cell-note">append-only, newest last</span></h4>
                            <ol className="event-list">{item.events.map((entry) => <li key={entry.event_id}><OutreachBadge status={entry.status} /><span className="event-meta">{formatDate(entry.created_at)} · {entry.actor}</span>{entry.note && <p>{entry.note}</p>}</li>)}</ol>
                          </div>
                        )}
                        {editing === item.selection_id && !archived && (
                          <form ref={formRef} className="outcome-form" onSubmit={(event) => void save(event, item.customer_id)}>
                            <h4 className="row-detail-title">Record outcome for {item.customer_id}</h4>
                            <label className="field" htmlFor={`status-${item.selection_id}`}><span className="field-label">Status</span><select id={`status-${item.selection_id}`} value={status} onChange={(event) => { setStatus(event.target.value as typeof status); setKey(null); }}>{recordable.map((value) => <option key={value} value={value}>{labels[value]}</option>)}</select></label>
                            <div className="field"><label className="field-label" htmlFor={`note-${item.selection_id}`}>Note (optional)</label><textarea id={`note-${item.selection_id}`} value={note} maxLength={500} rows={2} aria-describedby={`note-hint-${item.selection_id}`} onChange={(event) => { setNote(event.target.value); setKey(null); }} /><small className="field-hint" id={`note-hint-${item.selection_id}`}>{note.length}/500 · Recorded with the time and your local operator name. Nothing is sent to the customer.</small></div>
                            <div className="button-row"><button type="button" className="button-secondary" onClick={() => setEditing(null)}>Cancel</button><button type="submit" disabled={busy}>{busy ? "Saving…" : "Save outcome"}</button></div>
                          </form>
                        )}
                      </div>
                    </td>
                  </tr>}
                </Fragment>;
              })}</tbody>
            </table>
          </div>
        </div>
        <Pagination label="Outreach pages" page={page} pageCount={pageCount} onPage={setPage} total={data.total} pageSize={data.page_size} itemLabel="selections" />
      </>)}
    </section>
  );
}
