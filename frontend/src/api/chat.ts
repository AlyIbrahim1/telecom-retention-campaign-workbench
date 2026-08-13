import { ApiError, type ApiProblem } from "./customers";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8000";

export type ChatRole = "user" | "assistant" | "system";
export type ChatEvidenceKind =
  | "customer_record"
  | "model_output"
  | "calculated_priority"
  | "ai_suggestion";

export type ChatContext = {
  customer_id?: string;
  campaign_id?: string;
};

export type ChatEvidence = {
  kind: ChatEvidenceKind;
  label: string;
  content: string;
};

export type StagedAction = {
  action_id: string;
  action: "create" | "update";
  customer_id?: string | null;
  expires_at?: string | null;
  confirmation_token?: string | null;
  expected_version?: number | null;
  idempotency_key?: string | null;
  fields: Record<string, unknown>;
  changes: Array<{ field: string; before?: unknown; after?: unknown }>;
  prediction?: {
    risk_score?: number | null;
    recommended_for_review?: boolean | null;
    model_version?: string | null;
    threshold?: number | null;
  } | null;
  warnings: string[];
  status: "pending" | "confirmed" | "cancelled" | "expired" | "consumed";
};

export type ChatMessage = {
  message_id: string;
  role: ChatRole;
  content: string;
  created_at?: string | null;
  evidence: ChatEvidence[];
  staged_action?: StagedAction | null;
};

export type ChatSession = {
  session_id: string;
  status: "ready" | "loading" | "unavailable" | "closed" | string;
  context: ChatContext;
  messages: ChatMessage[];
  staged_actions: StagedAction[];
  ai_available: boolean;
  unavailable_reason?: string | null;
};

export type ChatTurn = {
  message?: ChatMessage;
  messages: ChatMessage[];
  staged_action?: StagedAction | null;
};

export type ChatActionResult = {
  action_id: string;
  status: "confirmed" | "cancelled" | "expired" | "consumed" | string;
  customer_id?: string | null;
  message?: string | null;
};

const EVIDENCE_LABELS: Record<ChatEvidenceKind, string> = {
  customer_record: "Customer record",
  model_output: "Model output",
  calculated_priority: "Calculated priority",
  ai_suggestion: "AI suggestion",
};

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : value == null ? fallback : String(value);
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function evidenceKind(value: unknown): ChatEvidenceKind {
  if (value === "model_output" || value === "calculated_priority" || value === "ai_suggestion") {
    return value;
  }
  return "customer_record";
}

function normalizeEvidence(value: unknown): ChatEvidence[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const source = objectValue(item);
    const kind = evidenceKind(source.kind ?? source.type ?? source.category);
    const content = stringValue(source.content ?? source.text ?? source.value);
    return content
      ? [{ kind, label: stringValue(source.label, EVIDENCE_LABELS[kind]), content }]
      : [];
  });
}

function normalizePrediction(value: unknown): StagedAction["prediction"] {
  const source = objectValue(value);
  if (!Object.keys(source).length) return null;
  return {
    risk_score: numberValue(source.risk_score ?? source.score),
    recommended_for_review:
      typeof source.recommended_for_review === "boolean" ? source.recommended_for_review : null,
    model_version: typeof source.model_version === "string" ? source.model_version : null,
    threshold: numberValue(source.threshold),
  };
}

function normalizeChanges(value: unknown): StagedAction["changes"] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      const source = objectValue(item);
      const field = stringValue(source.field ?? source.name);
      return field
        ? [{ field, before: source.before, after: source.after ?? source.value }]
        : [];
    });
  }
  const source = objectValue(value);
  return Object.entries(source).map(([field, after]) => ({ field, after }));
}

export function normalizeStagedAction(value: unknown): StagedAction | null {
  const source = objectValue(value);
  const actionId = stringValue(source.action_id ?? source.id);
  if (!actionId) return null;
  const action = source.action === "update" || source.type === "update" ? "update" : "create";
  const preview = objectValue(source.preview ?? source.normalized_customer ?? source.customer ?? source.fields);
  const prediction = normalizePrediction(source.prediction ?? preview.prediction);
  const fields = objectValue(preview.normalized_customer ?? preview.customer ?? preview.fields ?? preview);
  return {
    action_id: actionId,
    action,
    customer_id:
      typeof source.customer_id === "string"
        ? source.customer_id
        : typeof fields.customer_id === "string"
          ? fields.customer_id
          : null,
    expires_at: typeof source.expires_at === "string" ? source.expires_at : null,
    confirmation_token:
      typeof source.confirmation_token === "string"
        ? source.confirmation_token
        : typeof source.token === "string"
          ? source.token
          : null,
    expected_version: numberValue(source.expected_version ?? source.version),
    idempotency_key: typeof source.idempotency_key === "string" ? source.idempotency_key : null,
    fields,
    changes: normalizeChanges(source.changes ?? preview.changes),
    prediction,
    warnings: Array.isArray(source.warnings)
      ? source.warnings.filter((item): item is string => typeof item === "string")
      : [],
    status:
      source.status === "confirmed" || source.status === "cancelled" || source.status === "expired" || source.status === "consumed"
        ? source.status
        : "pending",
  };
}

export function normalizeChatMessage(value: unknown, fallbackRole: ChatRole = "assistant"): ChatMessage {
  const source = objectValue(value);
  const role: ChatRole = source.role === "user" || source.role === "system" ? source.role : fallbackRole;
  const stagedAction = normalizeStagedAction(source.staged_action ?? source.stagedAction ?? source.action);
  const evidence = normalizeEvidence(source.evidence ?? source.annotations ?? source.grounding);
  return {
    message_id: stringValue(source.message_id ?? source.id, `message-${Date.now()}-${Math.random()}`),
    role,
    content: stringValue(source.content ?? source.text ?? source.message),
    created_at: typeof source.created_at === "string" ? source.created_at : null,
    evidence,
    staged_action: stagedAction,
  };
}

export function normalizeChatSession(value: unknown): ChatSession {
  const source = objectValue(value);
  const context = objectValue(source.context);
  const rawMessages = Array.isArray(source.messages) ? source.messages : [];
  return {
    session_id: stringValue(source.session_id ?? source.id),
    status: stringValue(source.status, "ready"),
    context: {
      customer_id: stringValue(source.customer_id ?? context.customer_id) || undefined,
      campaign_id: stringValue(source.campaign_id ?? context.campaign_id) || undefined,
    },
    messages: rawMessages.map((message) => normalizeChatMessage(message)),
    staged_actions: Array.isArray(source.staged_actions)
      ? source.staged_actions.flatMap((item) => {
          const action = normalizeStagedAction(item);
          return action ? [action] : [];
        })
      : [],
    ai_available: source.ai_available !== false && source.available !== false,
    unavailable_reason: typeof source.unavailable_reason === "string" ? source.unavailable_reason : null,
  };
}

export function normalizeChatTurn(value: unknown): ChatTurn {
  const source = objectValue(value);
  const stagedActions = Array.isArray(source.staged_actions)
    ? source.staged_actions.flatMap((item) => {
        const action = normalizeStagedAction(item);
        return action ? [action] : [];
      })
    : [];
  const stagedAction = normalizeStagedAction(source.staged_action ?? source.stagedAction ?? source.action) ?? stagedActions[0] ?? null;
  const rawMessages = Array.isArray(source.messages) ? source.messages : [];
  const messageValue = source.message ?? (rawMessages.length ? rawMessages[rawMessages.length - 1] : source);
  const message = normalizeChatMessage(messageValue);
  const messages = rawMessages.length ? rawMessages.map((item) => normalizeChatMessage(item)) : [message];
  return { message, messages, staged_action: stagedAction ?? message.staged_action ?? null };
}

async function parseProblem(response: Response): Promise<ApiProblem> {
  return (await response.json().catch(() => ({}))) as ApiProblem;
}

async function jsonRequest<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      headers: {
        Accept: "application/json",
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...init?.headers,
      },
    });
  } catch {
    throw new ApiError(0, {
      code: "service_unavailable",
      title: "Connection unavailable",
      detail: "The local API could not be reached. Check the stack and try again.",
    });
  }
  if (!response.ok) throw new ApiError(response.status, await parseProblem(response));
  return (await response.json()) as T;
}

export async function createChatSession(context: ChatContext = {}): Promise<ChatSession> {
  return normalizeChatSession(await jsonRequest<unknown>("/api/v1/chat/sessions", {
    method: "POST",
    body: JSON.stringify(context),
  }));
}

export async function getChatSession(sessionId: string): Promise<ChatSession> {
  return normalizeChatSession(await jsonRequest<unknown>(`/api/v1/chat/sessions/${encodeURIComponent(sessionId)}`));
}

export async function sendChatMessage(sessionId: string, content: string): Promise<ChatTurn> {
  const body = await jsonRequest<unknown>(`/api/v1/chat/sessions/${encodeURIComponent(sessionId)}/messages`, {
    method: "POST",
    body: JSON.stringify({ content }),
  });
  return normalizeChatTurn(body);
}

export async function confirmChatAction(actionId: string, confirmationToken: string, idempotencyKey: string): Promise<ChatActionResult> {
  return jsonRequest<ChatActionResult>(`/api/v1/chat/staged-actions/${encodeURIComponent(actionId)}/confirm`, {
    method: "POST",
    headers: { "Idempotency-Key": idempotencyKey },
    body: JSON.stringify({ confirmation_token: confirmationToken }),
  });
}

export async function cancelChatAction(actionId: string, confirmationToken: string): Promise<ChatActionResult> {
  return jsonRequest<ChatActionResult>(`/api/v1/chat/staged-actions/${encodeURIComponent(actionId)}/cancel`, {
    method: "POST",
    body: JSON.stringify({ confirmation_token: confirmationToken }),
  });
}
