import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";

import {
  cancelChatAction,
  confirmChatAction,
  createChatSession,
  normalizeChatMessage,
  sendChatMessage,
  type ChatContext,
  type ChatEvidence,
  type ChatMessage,
  type ChatSession,
  type StagedAction,
} from "../api/chat";
import { ApiError } from "../api/customers";
import "../features/chat/chat.css";

type BusyState = "starting" | "sending" | "confirming" | "cancelling" | null;

const SUGGESTIONS = [
  "Explain this customer's score",
  "What does campaign priority mean?",
  "Suggest a retention idea",
];

function idempotencyKey() {
  return typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `chat-action-${Date.now()}`;
}

function safeActionMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return "The assistant could not complete that request. Try again.";
  if (error.status === 0) return "The local API could not be reached. The rest of the workspace is still available.";
  switch (error.problem.code) {
    case "ai_unavailable":
    case "chat_unavailable":
      return "The assistant is unavailable because its provider is not configured. You can keep using customers and campaigns.";
    case "staged_action_expired":
      return "This preview expired. Ask the assistant to prepare a fresh preview.";
    case "staged_action_consumed":
    case "staged_action_invalid":
      return "This preview is no longer valid. Ask the assistant to prepare a fresh preview.";
    case "conflict":
    case "version_conflict":
    case "customer_version_conflict":
      return "The customer changed elsewhere. Review the latest record before asking for another update preview.";
    case "duplicate_customer_id":
      return "That customer ID already exists. Ask the assistant to prepare an update instead of a create.";
    case "validation_failed":
      return "Some customer fields need correction before a preview can be prepared.";
    case "ai_refused":
      return "The assistant declined that request. Ask about stored facts or a non-binding retention idea.";
    case "rate_limited":
      return "The assistant is busy. Wait a moment and try again.";
    case "ai_timeout":
      return "The assistant took too long to respond. Try again with a shorter question.";
    default:
      return "The assistant could not complete that request. Try again.";
  }
}

function mergeMessages(current: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const result = [...current];
  const ids = new Set(result.map((message) => message.message_id));
  incoming.forEach((message) => {
    if (!ids.has(message.message_id)) {
      result.push(message);
      ids.add(message.message_id);
    }
  });
  return result;
}

function latestPendingAction(messages: ChatMessage[]): StagedAction | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const action = messages[index].staged_action;
    if (action && action.status === "pending") return action;
  }
  return null;
}

function actionIdempotencyKey(action: StagedAction, keys: Map<string, string>): string {
  const existing = keys.get(action.action_id);
  if (existing) return existing;
  const key = action.idempotency_key || idempotencyKey();
  keys.set(action.action_id, key);
  return key;
}

export function ChatPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const context = useMemo<ChatContext>(() => {
    const customerId = searchParams.get("customerId") ?? searchParams.get("customer_id") ?? undefined;
    const campaignId = searchParams.get("campaignId") ?? searchParams.get("campaign_id") ?? undefined;
    return {
      ...(customerId ? { customer_id: customerId } : {}),
      ...(campaignId ? { campaign_id: campaignId } : {}),
    };
  }, [searchParams]);
  const contextKey = `${context.customer_id ?? ""}:${context.campaign_id ?? ""}`;
  const [session, setSession] = useState<ChatSession | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [busy, setBusy] = useState<BusyState>("starting");
  const [error, setError] = useState("");
  const [input, setInput] = useState("");
  const [pendingAction, setPendingAction] = useState<StagedAction | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const sessionRequest = useRef<{ key: string; promise: Promise<ChatSession> } | null>(null);
  const actionKeys = useRef(new Map<string, string>());

  const startSession = useCallback(() => {
    setBusy("starting");
    setError("");
    const request = sessionRequest.current?.key === contextKey
      ? sessionRequest.current.promise
      : createChatSession(context);
    sessionRequest.current = { key: contextKey, promise: request };
    request.then((nextSession) => {
      if (sessionRequest.current?.promise !== request) return;
      setSession(nextSession);
      setMessages(nextSession.messages);
      setPendingAction(latestPendingAction(nextSession.messages) ?? nextSession.staged_actions.find((action) => action.status === "pending") ?? null);
      if (!nextSession.ai_available || nextSession.status === "unavailable") {
        setError("The assistant is unavailable because its provider is not configured. You can keep using customers and campaigns.");
      }
    }).catch((reason: unknown) => {
      if (sessionRequest.current?.promise !== request) return;
      if (sessionRequest.current?.promise === request) sessionRequest.current = null;
      setSession(null);
      setMessages([]);
      setPendingAction(null);
      setError(safeActionMessage(reason));
    }).finally(() => {
      if (!sessionRequest.current || sessionRequest.current.promise === request) setBusy(null);
    });
  }, [context, contextKey]);

  useEffect(() => {
    actionKeys.current.clear();
    startSession();
  }, [startSession]);

  const removeContext = useCallback(() => {
    setSearchParams({});
  }, [setSearchParams]);

  async function sendMessage(contentValue: string) {
    const content = contentValue.trim();
    if (!content || !session?.session_id || busy !== null || error.includes("provider is not configured")) return;
    const userMessage = normalizeChatMessage({
      id: `local-${Date.now()}`,
      role: "user",
      content,
    }, "user");
    setMessages((current) => [...current, userMessage]);
    setInput("");
    setBusy("sending");
    setError("");
    try {
      const turn = await sendChatMessage(session.session_id, content);
      setMessages((current) => mergeMessages(current, turn.messages));
      const action = turn.staged_action ?? latestPendingAction(turn.messages);
      setPendingAction(action);
      const latest = turn.message ?? turn.messages[turn.messages.length - 1];
      if (latest?.content) setAnnouncement(`Assistant response: ${latest.content}`);
    } catch (reason) {
      setError(safeActionMessage(reason));
      setAnnouncement("The assistant request failed.");
    } finally {
      setBusy(null);
    }
  }

  function submitMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void sendMessage(input);
  }

  async function confirmAction() {
    if (!pendingAction || busy !== null) return;
    if (!pendingAction.confirmation_token) {
      setError("This preview is missing a confirmation token. Ask the assistant to prepare a fresh preview.");
      return;
    }
    setBusy("confirming");
    setError("");
    try {
      const result = await confirmChatAction(
        pendingAction.action_id,
        pendingAction.confirmation_token,
        actionIdempotencyKey(pendingAction, actionKeys.current),
      );
      setPendingAction(null);
      const confirmation = result.message || `${pendingAction.action === "create" ? "Customer creation" : "Customer update"} confirmed. No outreach was sent.`;
      setMessages((current) => [...current, normalizeChatMessage({ id: `confirmation-${pendingAction.action_id}`, role: "system", content: confirmation })]);
      setAnnouncement(confirmation);
    } catch (reason) {
      if (reason instanceof ApiError && reason.problem.code === "staged_action_consumed") {
        setPendingAction(null);
      }
      setError(safeActionMessage(reason));
      setAnnouncement("The staged action could not be confirmed.");
    } finally {
      setBusy(null);
    }
  }

  async function cancelAction() {
    if (!pendingAction || busy !== null) return;
    setBusy("cancelling");
    setError("");
    try {
      if (!pendingAction.confirmation_token) {
        setError("This preview is missing a confirmation token. Ask the assistant to prepare a fresh preview.");
        setBusy(null);
        return;
      }
      const result = await cancelChatAction(pendingAction.action_id, pendingAction.confirmation_token);
      setPendingAction(null);
      const cancellation = "Preview cancelled. No customer record was changed.";
      setMessages((current) => [...current, normalizeChatMessage({ id: `cancellation-${pendingAction.action_id}`, role: "system", content: cancellation })]);
      setAnnouncement(cancellation);
    } catch (reason) {
      if (reason instanceof ApiError && reason.problem.code === "staged_action_consumed") {
        setPendingAction(null);
      }
      setError(safeActionMessage(reason));
      setAnnouncement("The staged action could not be cancelled.");
    } finally {
      setBusy(null);
    }
  }

  const providerUnavailable = error.includes("provider is not configured");

  return (
    <section className="page-stack chat-page" aria-labelledby="chat-title">
      <div className="page-heading-action chat-heading">
        <div className="page-heading">
          <p className="eyebrow">Decision support</p>
          <h1 id="chat-title">Assistant chat</h1>
          <p className="page-description">Ask about stored facts, model output, campaign formulas, or non-binding retention ideas. The assistant cannot send outreach or change records without your confirmation.</p>
        </div>
        <div className="chat-context" aria-label="Chat context">
          <span className="chat-context-label">Context</span>
          {context.customer_id ? <span className="context-chip">Customer {context.customer_id}</span> : null}
          {context.campaign_id ? <span className="context-chip">Campaign {context.campaign_id}</span> : null}
          {!context.customer_id && !context.campaign_id ? <span className="context-chip context-chip-muted">No record selected</span> : null}
          {(context.customer_id || context.campaign_id) && <button type="button" className="text-button" onClick={removeContext}>Remove context</button>}
        </div>
      </div>

      <div className="chat-layout">
        <section className="chat-workspace" aria-label="Conversation">
          <div className="chat-transcript" aria-live="off">
            {busy === "starting" && !session ? <div className="loading-panel chat-state" role="status">Connecting to the assistant…</div> : null}
            {messages.length === 0 && busy !== "starting" && !providerUnavailable ? <EmptyChat onSuggestion={(suggestion) => void sendMessage(suggestion)} /> : null}
            {messages.map((message) => <ChatMessageView key={message.message_id} message={message} />)}
            {busy === "sending" && <div className="chat-busy" role="status">Assistant is thinking…</div>}
          </div>
          <section className="chat-label-legend" aria-label="Answer labels"><strong>Answer labels</strong><span>Customer record</span><span>Model output</span><span>Calculated priority</span><span>AI suggestion</span></section>
          <form className="chat-composer" onSubmit={submitMessage}>
            <label htmlFor="chat-input">Message the assistant</label>
            <textarea id="chat-input" value={input} onChange={(event) => setInput(event.target.value)} rows={3} maxLength={2000} placeholder="Ask about a customer, score, campaign, or retention idea…" disabled={!session || busy !== null || providerUnavailable} />
            <div className="chat-composer-footer"><span>{input.length}/2000 · Shift+Enter for a new line</span><button type="submit" disabled={!input.trim() || !session || busy !== null || providerUnavailable}>{busy === "sending" ? "Thinking…" : "Send message"}</button></div>
          </form>
        </section>

        <aside className="chat-side" aria-label="Assistant safety and staged action">
          {error && <div className="import-alert chat-alert" role="alert"><strong>{providerUnavailable ? "Assistant unavailable" : "Chat needs attention"}</strong><span>{error}</span><button type="button" className="button-secondary" onClick={startSession} disabled={busy !== null}>Try again</button></div>}
          {pendingAction ? <StagedActionCard action={pendingAction} busy={busy} onConfirm={() => void confirmAction()} onCancel={() => void cancelAction()} /> : <div className="chat-safety"><p className="eyebrow">Human control</p><h2>No pending write</h2><p>Customer creates and updates appear here as a structured preview. Nothing is saved from chat until you choose Confirm once.</p></div>}
          <div className="chat-safety"><p className="eyebrow">Grounding boundary</p><h2>What the assistant can use</h2><p>Only the selected customer or campaign context and bounded, stored facts. Customer notes are data, not instructions.</p></div>
        </aside>
      </div>
      <div className="sr-only" aria-live="polite" aria-atomic="true">{announcement}</div>
    </section>
  );
}

function EmptyChat({ onSuggestion }: { onSuggestion: (suggestion: string) => void }) {
  return (
    <div className="chat-empty">
      <p className="eyebrow">Start with a question</p>
      <h2>Make the next customer decision clearer.</h2>
      <p>Try a suggested question or write your own. Answers keep stored facts, model output, calculated priority, and AI suggestions separate.</p>
      <div className="chat-suggestions" aria-label="Suggested questions">
        {SUGGESTIONS.map((suggestion) => <button key={suggestion} type="button" className="button-secondary" onClick={() => onSuggestion(suggestion)}>{suggestion}</button>)}
      </div>
    </div>
  );
}

function ChatMessageView({ message }: { message: ChatMessage }) {
  return (
    <article className={`chat-message chat-message-${message.role}`} aria-label={`${message.role === "user" ? "You" : message.role === "assistant" ? "Assistant" : "System"} message`}>
      <div className="chat-message-meta"><strong>{message.role === "user" ? "You" : message.role === "assistant" ? "Assistant" : "Workspace"}</strong>{message.created_at ? <time dateTime={message.created_at}>{new Date(message.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time> : null}</div>
      <p>{message.content}</p>
      {message.evidence.length > 0 && <div className="chat-evidence" aria-label="Answer sources">{message.evidence.map((item, index) => <EvidenceBlock key={`${item.kind}-${index}`} evidence={item} />)}</div>}
    </article>
  );
}

function EvidenceBlock({ evidence }: { evidence: ChatEvidence }) {
  return <section className={`evidence-block evidence-${evidence.kind}`}><strong>{evidence.label}</strong><p>{evidence.content}</p></section>;
}

function StagedActionCard({ action, busy, onConfirm, onCancel }: { action: StagedAction; busy: BusyState; onConfirm: () => void; onCancel: () => void }) {
  const hasToken = Boolean(action.confirmation_token);
  return (
    <section className="staged-action" aria-labelledby="staged-action-title">
      <p className="eyebrow">Confirmation required</p>
      <h2 id="staged-action-title">Review {action.action === "create" ? "new customer" : "customer update"}</h2>
      <p className="staged-action-copy">This is a preview outside the assistant's prose. Confirm once to save it, or cancel to discard it.</p>
      {action.customer_id && <p className="record-meta"><strong>{action.customer_id}</strong>{action.expected_version != null ? ` · Expected version ${action.expected_version}` : ""}</p>}
      {action.changes.length > 0 ? <dl className="staged-fields">{action.changes.map((change) => <div key={change.field}><dt>{humanField(change.field)}</dt><dd>{formatValue(change.before)} <span aria-hidden="true">→</span> {formatValue(change.after)}</dd></div>)}</dl> : <dl className="staged-fields">{Object.entries(action.fields).map(([field, value]) => <div key={field}><dt>{humanField(field)}</dt><dd>{formatValue(value)}</dd></div>)}</dl>}
      {action.prediction && <div className="staged-prediction"><strong>Model output</strong><span>{action.prediction.risk_score != null ? `${Math.round(action.prediction.risk_score * 100)}% risk score` : "Prediction available"}</span>{action.prediction.model_version && <small>{action.prediction.model_version}</small>}</div>}
      {action.warnings.length > 0 && <div className="warning-panel"><strong>Review warnings</strong><ul>{action.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></div>}
      {!hasToken && <p className="field-error">This preview no longer has a confirmation token. Ask for a fresh preview before making a change.</p>}
      <div className="form-actions"><button type="button" disabled={busy !== null || !hasToken} onClick={onConfirm}>{busy === "confirming" ? "Confirming…" : "Confirm once"}</button><button type="button" className="button-secondary" disabled={busy !== null || !hasToken} onClick={onCancel}>{busy === "cancelling" ? "Cancelling…" : "Cancel preview"}</button></div>
      {action.expires_at && <small className="cell-note">Preview expires {new Date(action.expires_at).toLocaleString()}</small>}
    </section>
  );
}

function humanField(field: string): string {
  return field.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatValue(value: unknown): string {
  if (value == null || value === "") return "Not provided";
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return "Unavailable";
    }
  }
  return String(value);
}
