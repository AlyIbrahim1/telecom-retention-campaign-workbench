import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { matchPath, useLocation } from "react-router-dom";

import {
  cancelChatAction,
  confirmChatAction,
  createChatSession,
  normalizeChatMessage,
  sendChatMessage,
  type ChatContext,
  type ChatMessage,
  type ChatSession,
  type StagedAction,
} from "../../api/chat";
import { ApiError } from "../../api/customers";
import { Icon, LoadingState, Notice } from "../index";
import { contextKey, useAssistant } from "../../features/chat/AssistantContext";
import { EmptyChat } from "../molecules/chat/EmptyChat";
import { ChatMessageView } from "../molecules/chat/ChatMessageView";
import { StagedActionCard, type BusyState } from "./chat/StagedActionCard";
import "../../features/chat/chat.css";

function idempotencyKey() {
  return typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `chat-action-${Date.now()}`;
}

function safeActionMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return "The assistant could not complete that request. Try again.";
  if (error.status === 0) return "Assistant services could not be reached. The rest of the workspace is still available.";
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


/** The record the current page is about, if any. */
function routeContext(pathname: string): ChatContext {
  const customer = matchPath("/customers/:customerId/*", pathname);
  const customerId = customer?.params.customerId;
  if (customerId && customerId !== "new") return { customer_id: decodeURIComponent(customerId) };
  const campaign = matchPath("/campaigns/:campaignId/*", pathname);
  const campaignId = campaign?.params.campaignId;
  if (campaignId && campaignId !== "new") return { campaign_id: decodeURIComponent(campaignId) };
  return {};
}

function describeContext(context: ChatContext): string | null {
  if (context.customer_id) return `Customer ${context.customer_id}`;
  if (context.campaign_id) return `Campaign ${context.campaign_id}`;
  return null;
}

/**
 * Toggleable assistant side panel. It stays mounted once opened, so the
 * conversation survives navigation; it only starts a chat session the first
 * time it is opened, and a new one whenever its record context changes.
 */
export function AssistantPanel() {
  const { open, request, closeAssistant } = useAssistant();
  const location = useLocation();
  const suggested = useMemo(() => routeContext(location.pathname), [location.pathname]);
  const [activated, setActivated] = useState(false);
  const [context, setContext] = useState<ChatContext>({});
  const handledRequest = useRef<number | null>(null);

  // First open: adopt an explicit request, else the record on screen.
  useEffect(() => {
    if (!open) return;
    if (request && handledRequest.current !== request.nonce) {
      handledRequest.current = request.nonce;
      setContext(request.context);
      setActivated(true);
      return;
    }
    if (!activated) {
      setContext(suggested);
      setActivated(true);
    }
  }, [open, request, activated, suggested]);

  if (!activated) {
    return <aside id="assistant-panel" className="assistant-panel" aria-labelledby="assistant-title" hidden><h2 id="assistant-title">Assistant</h2></aside>;
  }
  return (
    <AssistantConversation
      open={open}
      context={context}
      suggested={suggested}
      onContext={setContext}
      onClose={closeAssistant}
    />
  );
}

function AssistantConversation({
  open,
  context,
  suggested,
  onContext,
  onClose,
}: {
  open: boolean;
  context: ChatContext;
  suggested: ChatContext;
  onContext: (context: ChatContext) => void;
  onClose: () => void;
}) {
  const key = contextKey(context);
  const [session, setSession] = useState<ChatSession | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [busy, setBusy] = useState<BusyState>("starting");
  const [error, setError] = useState("");
  const [input, setInput] = useState("");
  const [pendingAction, setPendingAction] = useState<StagedAction | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [sessionNonce, setSessionNonce] = useState(0);
  const sessionRequest = useRef<{ key: string; promise: Promise<ChatSession> } | null>(null);
  const actionKeys = useRef(new Map<string, string>());
  const transcriptRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const panelRef = useRef<HTMLElement>(null);

  const startSession = useCallback(() => {
    setBusy("starting");
    setError("");
    const requestKey = `${key}#${sessionNonce}`;
    const request = sessionRequest.current?.key === requestKey
      ? sessionRequest.current.promise
      : createChatSession(context);
    sessionRequest.current = { key: requestKey, promise: request };
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
      sessionRequest.current = null;
      setSession(null);
      setMessages([]);
      setPendingAction(null);
      setError(safeActionMessage(reason));
    }).finally(() => {
      if (!sessionRequest.current || sessionRequest.current.promise === request) setBusy(null);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, sessionNonce]);

  useEffect(() => {
    actionKeys.current.clear();
    setMessages([]);
    setPendingAction(null);
    startSession();
  }, [startSession]);

  // Keep the newest message in view.
  useEffect(() => {
    const node = transcriptRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [messages, pendingAction, busy]);

  // Focus the composer (or the panel) when the panel opens; Escape closes it.
  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => {
      if (inputRef.current && !inputRef.current.disabled) inputRef.current.focus({ preventScroll: true });
      else panelRef.current?.focus();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [open]);

  // Escape closes the panel from anywhere while it is open.
  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !event.defaultPrevented) onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const providerUnavailableNow = error.includes("provider is not configured");
  // If the composer becomes unavailable while focused, keep focus in the panel.
  useEffect(() => {
    if (!open || !providerUnavailableNow) return;
    const active = document.activeElement;
    if (active === document.body || active === inputRef.current) panelRef.current?.focus();
  }, [open, providerUnavailableNow]);

  async function sendMessage(contentValue: string) {
    const content = contentValue.trim();
    if (!content || !session?.session_id || busy !== null || error.includes("provider is not configured")) return;
    const userMessage = normalizeChatMessage({ id: `local-${Date.now()}`, role: "user", content }, "user");
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
      const result = await confirmChatAction(pendingAction.action_id, pendingAction.confirmation_token, actionIdempotencyKey(pendingAction, actionKeys.current));
      setPendingAction(null);
      const confirmation = result.message || `${pendingAction.action === "create" ? "Customer creation" : "Customer update"} confirmed. No outreach was sent.`;
      setMessages((current) => [...current, normalizeChatMessage({ id: `confirmation-${pendingAction.action_id}`, role: "system", content: confirmation })]);
      setAnnouncement(confirmation);
    } catch (reason) {
      if (reason instanceof ApiError && reason.problem.code === "staged_action_consumed") setPendingAction(null);
      setError(safeActionMessage(reason));
      setAnnouncement("The staged action could not be confirmed.");
    } finally {
      setBusy(null);
    }
  }

  async function cancelAction() {
    if (!pendingAction || busy !== null) return;
    if (!pendingAction.confirmation_token) {
      setError("This preview is missing a confirmation token. Ask the assistant to prepare a fresh preview.");
      return;
    }
    setBusy("cancelling");
    setError("");
    try {
      await cancelChatAction(pendingAction.action_id, pendingAction.confirmation_token);
      setPendingAction(null);
      const cancellation = "Preview cancelled. No customer record was changed.";
      setMessages((current) => [...current, normalizeChatMessage({ id: `cancellation-${pendingAction.action_id}`, role: "system", content: cancellation })]);
      setAnnouncement(cancellation);
    } catch (reason) {
      if (reason instanceof ApiError && reason.problem.code === "staged_action_consumed") setPendingAction(null);
      setError(safeActionMessage(reason));
      setAnnouncement("The staged action could not be cancelled.");
    } finally {
      setBusy(null);
    }
  }

  const providerUnavailable = error.includes("provider is not configured");
  const activeLabel = describeContext(context);
  const suggestedLabel = describeContext(suggested);
  const offerSwitch = suggestedLabel !== null && contextKey(suggested) !== key;

  return (
    <aside
      id="assistant-panel"
      ref={panelRef}
      className="assistant-panel"
      aria-labelledby="assistant-title"
      aria-busy={busy === "sending"}
      hidden={!open}
      tabIndex={-1}
    >
      <header className="assistant-header">
        <div className="assistant-title-block">
          <p className="eyebrow">Optional decision support</p>
          <h2 id="assistant-title">Assistant</h2>
        </div>
        <div className="assistant-header-actions">
          <button type="button" className="button-ghost button-small" onClick={() => setSessionNonce((value) => value + 1)} disabled={busy !== null}>
            <Icon name="plus" size={16} />New chat
          </button>
          <button type="button" className="button-ghost icon-button" aria-label="Close assistant" onClick={onClose}>
            <Icon name="x" size={18} />
          </button>
        </div>
      </header>

      <div className="assistant-context" aria-label="Chat context">
        <span className="chat-context-label">Context</span>
        {activeLabel ? (
          <span className="context-chip">
            <Icon name={context.customer_id ? "users" : "target"} size={14} />
            <span>{activeLabel}</span>
            <button type="button" className="chip-remove" aria-label="Remove context" title="Remove context" onClick={() => onContext({})}><Icon name="x" size={14} /></button>
          </span>
        ) : <span className="context-chip context-chip-muted">No record selected</span>}
        {offerSwitch && (
          <p className="assistant-switch">
            <span>You are viewing {suggestedLabel}.</span>
            <button type="button" className="text-button" onClick={() => onContext(suggested)}>Ask about it instead</button>
          </p>
        )}
      </div>

      {error && (
        <div className="assistant-alert">
          <Notice
            tone={providerUnavailable ? "warning" : "danger"}
            role="alert"
            title={providerUnavailable ? "Assistant unavailable" : "Chat needs attention"}
            actions={<button type="button" className="button-secondary button-small" onClick={startSession} disabled={busy !== null}><Icon name="refresh" size={16} />Try again</button>}
          >
            {error}{providerUnavailable ? " To enable chat, set an API key in the local environment and restart the API." : ""}
          </Notice>
        </div>
      )}

      <div className="assistant-body" ref={transcriptRef} aria-live="off">
        {busy === "starting" && !session ? <LoadingState label="Connecting to the assistant…" rows={3} /> : null}
        {messages.length === 0 && busy !== "starting" && !providerUnavailable ? <EmptyChat onSuggestion={(suggestion) => void sendMessage(suggestion)} disabled={!session || busy !== null} /> : null}
        {messages.map((message) => <ChatMessageView key={message.message_id} message={message} />)}
        {busy === "sending" && <div className="chat-busy" role="status"><span className="typing-dots" aria-hidden="true"><span /><span /><span /></span>Assistant is thinking…</div>}
        {pendingAction && <StagedActionCard action={pendingAction} busy={busy} onConfirm={() => void confirmAction()} onCancel={() => void cancelAction()} />}
      </div>

      <div className="assistant-footer">
        {messages.some((message) => message.evidence.length > 0) && <div className="chat-label-legend" role="note" aria-label="Answer labels">
          <span className="legend-item evidence-customer_record">Customer record</span>
          <span className="legend-item evidence-model_output">Model output</span>
          <span className="legend-item evidence-calculated_priority">Calculated priority</span>
          <span className="legend-item evidence-ai_suggestion">AI suggestion</span>
        </div>}
        <form className="chat-composer" onSubmit={submitMessage}>
          <label htmlFor="chat-input" className="sr-only">Message the assistant</label>
          <textarea
            id="chat-input"
            ref={inputRef}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void sendMessage(input); } }}
            rows={2}
            maxLength={2000}
            placeholder={providerUnavailable ? "Chat is unavailable until an AI provider is configured." : "Ask about a customer, score, campaign, or retention idea…"}
            disabled={providerUnavailable}
          />
          <div className="chat-composer-footer">
            <span>{busy === "starting" ? "Connecting…" : "Enter to send · Shift+Enter for a new line"}</span>
            <button type="submit" className="button-small" disabled={!input.trim() || !session || busy !== null || providerUnavailable}>{busy === "sending" ? "Thinking…" : "Send message"}</button>
          </div>
        </form>
        <p className="assistant-boundary"><Icon name="shield" size={14} />Uses only the selected record and stored facts. Nothing is saved or sent without your confirmation.</p>
      </div>
      <div className="sr-only" aria-live="polite" aria-atomic="true">{announcement}</div>
    </aside>
  );
}
