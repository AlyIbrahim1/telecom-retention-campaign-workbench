import { ApiError, type ApiProblem } from "./customers";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8000";

export type CampaignStatus = "draft" | "optimized" | "confirmed" | "archived";
export type CampaignOverrideAction = "exclude" | "include";

export type Campaign = {
  campaign_id: string;
  name: string;
  capacity: number;
  value_horizon_months: number;
  contact_cost_per_customer: number;
  status: CampaignStatus;
  version: number;
  created_at: string;
  updated_at: string | null;
  confirmed_at: string | null;
  latest_optimization_run_id: string | null;
  optimization: CampaignOptimization | null;
  recommendations: CampaignRecommendation[];
  overrides: CampaignOverride[];
  eligible_count: number;
  recommended_count: number;
  selected_count: number;
  unused_capacity: number;
};

export type CampaignListItem = Omit<Campaign, "recommendations" | "overrides" | "optimization">;

export type CampaignListResponse = {
  items: CampaignListItem[];
  total: number;
  page: number;
  page_size: number;
};

export type CampaignOptimization = {
  run_id: string;
  formula_version: string;
  monthly_weight: number;
  historical_weight: number;
  reference_population_timestamp: string | null;
  created_at: string | null;
  eligible_count: number;
  recommended_count: number;
  unused_capacity: number;
  model_versions: string[];
  prediction_scored_at: string | null;
};

export type CampaignRecommendation = {
  recommendation_id: string;
  customer_id: string;
  prediction_id: string | null;
  rank: number;
  risk_score: number;
  recommended_for_review: boolean;
  recommended: boolean;
  selected: boolean;
  override: boolean;
  selection_state: "recommended" | "selected" | "excluded" | "override" | "not_selected";
  monthly_charges: number | null;
  total_charges: number | null;
  monthly_spend_percentile: number;
  historical_spend_percentile: number;
  value_index: number;
  priority_score: number;
  model_version: string | null;
  scored_at: string | null;
  override_reason: string | null;
};

export type CampaignOverride = {
  override_id: string;
  customer_id: string;
  action: CampaignOverrideAction;
  reason: string;
  replacement_customer_id: string | null;
  created_at: string | null;
};

export type CampaignOverrideInput = {
  customer_id: string;
  action: CampaignOverrideAction;
  reason: string;
  replacement_customer_id?: string;
};

export type CampaignWriteInput = { name: string; capacity: number; value_horizon_months: number; contact_cost_per_customer: number };

async function parseProblem(response: Response): Promise<ApiProblem> {
  return (await response.json().catch(() => ({}))) as ApiProblem;
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
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
      detail: "Campaign services could not be reached. Check the application services and try again.",
    });
  }
  if (!response.ok) throw new ApiError(response.status, await parseProblem(response));
  return (await response.json().catch(() => ({}))) as T;
}

function queryString(page: number, pageSize: number, includeArchived: boolean): string {
  const params = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
  if (includeArchived) params.set("include_archived", "true");
  return `?${params.toString()}`;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function first(value: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) if (value[key] !== undefined && value[key] !== null) return value[key];
  return undefined;
}

function numberValue(value: unknown, fallback = 0): number {
  const number = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isFinite(number) ? number : fallback;
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = numberValue(value, NaN);
  return Number.isFinite(number) ? number : null;
}

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : value === undefined || value === null ? fallback : String(value);
}

function nullableString(value: unknown): string | null {
  return value === undefined || value === null || value === "" ? null : stringValue(value);
}

function booleanValue(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value.toLowerCase() === "true" || value === "1";
  if (typeof value === "number") return value !== 0;
  return fallback;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => stringValue(item)).filter(Boolean) : [];
}

function normalizeStatus(value: unknown): CampaignStatus {
  return ["draft", "optimized", "confirmed", "archived"].includes(String(value)) ? value as CampaignStatus : "draft";
}

function normalizeOptimization(value: unknown): CampaignOptimization | null {
  if (!value || typeof value !== "object") return null;
  const source = record(value);
  const weights = record(source.weights);
  const runId = stringValue(first(source, ["run_id", "optimization_run_id", "id"]));
  return {
    run_id: runId,
    formula_version: stringValue(first(source, ["formula_version", "formulaVersion"]), "risk-spend-v1"),
    monthly_weight: numberValue(first(source, ["monthly_weight", "monthly_spend_weight", "monthly_weight_value", "weights.monthly"]), numberValue(weights.monthly, 0.6)),
    historical_weight: numberValue(first(source, ["historical_weight", "total_weight", "historical_spend_weight", "weights.total"]), numberValue(weights.total, 0.4)),
    reference_population_timestamp: nullableString(first(source, ["reference_population_timestamp", "population_timestamp", "population_as_of"])),
    created_at: nullableString(first(source, ["created_at", "optimized_at"])),
    eligible_count: numberValue(first(source, ["eligible_count", "eligible_customers"])),
    recommended_count: numberValue(first(source, ["recommended_count", "recommendation_count"])),
    unused_capacity: numberValue(first(source, ["unused_capacity"])),
    model_versions: stringArray(first(source, ["model_versions"])),
    prediction_scored_at: nullableString(first(source, ["prediction_scored_at", "scored_at"])),
  };
}

function normalizeRecommendation(value: unknown, index: number): CampaignRecommendation {
  const source = record(value);
  const recommended = booleanValue(first(source, ["recommended", "recommended_for_campaign", "is_recommended", "recommended_for_review"]));
  // A recommendation is not a human selection. The API should send an
  // explicit selection flag after review; otherwise keep this false so the
  // UI never implies that optimization contacted or selected anyone.
  const selected = booleanValue(first(source, ["selected", "selected_for_outreach", "is_selected"]));
  const override = booleanValue(first(source, ["override", "is_override"]));
  const action = stringValue(first(source, ["selection_state", "decision", "outreach_decision"]));
  const selectionState: CampaignRecommendation["selection_state"] = action === "excluded" || action === "exclude"
    ? "excluded"
    : action === "override" || override
      ? "override"
      : selected
        ? "selected"
        : recommended
          ? "recommended"
          : "not_selected";
  return {
    recommendation_id: stringValue(first(source, ["recommendation_id", "id"]), `recommendation-${index + 1}`),
    customer_id: stringValue(first(source, ["customer_id", "customerId"]), `Customer ${index + 1}`),
    prediction_id: nullableString(first(source, ["prediction_id", "predictionId"])),
    rank: Math.max(1, Math.trunc(numberValue(first(source, ["rank", "campaign_rank"]), index + 1))),
    risk_score: Math.min(1, Math.max(0, numberValue(first(source, ["risk_score", "risk"])))),
    recommended_for_review: booleanValue(first(source, ["recommended_for_review", "review_recommended", "recommended"]), recommended),
    recommended,
    selected,
    override,
    selection_state: selectionState,
    monthly_charges: nullableNumber(first(source, ["monthly_charges", "monthly_spend"])),
    total_charges: nullableNumber(first(source, ["total_charges", "historical_charges", "total_spend"])),
    monthly_spend_percentile: Math.min(1, Math.max(0, numberValue(first(source, ["monthly_spend_percentile", "monthly_percentile"])))),
    historical_spend_percentile: Math.min(1, Math.max(0, numberValue(first(source, ["historical_spend_percentile", "total_spend_percentile", "historical_percentile", "total_percentile"])))),
    value_index: Math.min(1, Math.max(0, numberValue(first(source, ["value_index", "customer_value_index"])))),
    priority_score: Math.min(100, Math.max(0, numberValue(first(source, ["priority_score", "campaign_priority_score"])))),
    model_version: nullableString(first(source, ["model_version"])),
    scored_at: nullableString(first(source, ["scored_at", "prediction_scored_at"])),
    override_reason: nullableString(first(source, ["override_reason", "reason"])),
  };
}

function normalizeOverride(value: unknown, index: number): CampaignOverride {
  const source = record(value);
  const action = stringValue(first(source, ["action", "decision"]));
  return {
    override_id: stringValue(first(source, ["override_id", "id"]), `override-${index + 1}`),
    customer_id: stringValue(first(source, ["customer_id", "customerId"])),
    action: action === "include" ? "include" : "exclude",
    reason: stringValue(source.reason),
    replacement_customer_id: nullableString(first(source, ["replacement_customer_id", "replace_customer_id"])),
    created_at: nullableString(first(source, ["created_at"])),
  };
}

function normalizeCampaign(value: unknown, fallbackId = ""): Campaign {
  const body = record(value);
  const nested = record(first(body, ["campaign", "data"]));
  const source = Object.keys(nested).length ? { ...nested, ...body } : body;
  const recommendationsRaw = first(source, ["recommendations", "items", "recommendation_rows"]);
  const overridesRaw = first(source, ["overrides", "override_events"]);
  const recommendations = Array.isArray(recommendationsRaw) ? recommendationsRaw.map(normalizeRecommendation) : [];
  const overrides = Array.isArray(overridesRaw) ? overridesRaw.map(normalizeOverride) : [];
  const optimization = normalizeOptimization(first(source, ["optimization", "optimization_run", "latest_optimization"]));
  const recommendedCount = numberValue(first(source, ["recommended_count", "recommendation_count"]), recommendations.filter((item) => item.recommended).length);
  const selectedCount = numberValue(first(source, ["selected_count", "selection_count", "confirmed_count"]), recommendations.filter((item) => item.selected).length);
  const eligibleCount = numberValue(first(source, ["eligible_count", "eligible_customers"]), optimization?.eligible_count ?? recommendations.length);
  const capacity = Math.max(1, Math.trunc(numberValue(first(source, ["capacity", "max_customers"]), 1)));
  const status = normalizeStatus(source.status);
  return {
    campaign_id: stringValue(first(source, ["campaign_id", "id"]), fallbackId),
    name: stringValue(source.name, "Untitled campaign"),
    capacity,
    value_horizon_months: numberValue(source.value_horizon_months, 3),
    contact_cost_per_customer: numberValue(source.contact_cost_per_customer, 5),
    status,
    version: Math.max(0, Math.trunc(numberValue(source.version, 1))),
    created_at: stringValue(source.created_at, new Date(0).toISOString()),
    updated_at: nullableString(source.updated_at),
    confirmed_at: nullableString(source.confirmed_at),
    latest_optimization_run_id: nullableString(first(source, ["latest_optimization_run_id", "optimization_run_id"])),
    optimization,
    recommendations,
    overrides,
    eligible_count: eligibleCount,
    recommended_count: optimization?.recommended_count ?? recommendedCount,
    selected_count: selectedCount,
    unused_capacity: Math.max(0, numberValue(first(source, ["unused_capacity"]), capacity - selectedCount)),
  };
}

function normalizeList(value: unknown, page: number, pageSize: number): CampaignListResponse {
  const body = record(value);
  const raw = Array.isArray(body.items) ? body.items : Array.isArray(value) ? value : [];
  const items = raw.map((item) => {
    const campaign = normalizeCampaign(item);
    return { ...campaign, recommendations: undefined, overrides: undefined, optimization: undefined } as unknown as CampaignListItem;
  });
  return {
    items,
    total: numberValue(body.total, items.length),
    page: numberValue(body.page, page),
    page_size: numberValue(body.page_size, pageSize),
  };
}

export async function listCampaigns(page = 1, pageSize = 25, includeArchived = false): Promise<CampaignListResponse> {
  return normalizeList(await requestJson<unknown>(`/api/v1/campaigns${queryString(page, pageSize, includeArchived)}`), page, pageSize);
}

export async function getCampaign(campaignId: string): Promise<Campaign> {
  return normalizeCampaign(await requestJson<unknown>(`/api/v1/campaigns/${encodeURIComponent(campaignId)}`), campaignId);
}

export async function createCampaign(payload: CampaignWriteInput, idempotencyKey: string): Promise<Campaign> {
  return normalizeCampaign(await requestJson<unknown>("/api/v1/campaigns", {
    method: "POST",
    headers: { "Idempotency-Key": idempotencyKey },
    body: JSON.stringify(payload),
  }));
}

export async function updateCampaign(campaignId: string, payload: CampaignWriteInput, version: number): Promise<Campaign> {
  return normalizeCampaign(await requestJson<unknown>(`/api/v1/campaigns/${encodeURIComponent(campaignId)}`, {
    method: "PATCH",
    headers: { "If-Match": String(version) },
    body: JSON.stringify(payload),
  }), campaignId);
}

export async function optimizeCampaign(campaignId: string, version: number, acknowledgeReoptimization = false): Promise<Campaign> {
  return normalizeCampaign(await requestJson<unknown>(`/api/v1/campaigns/${encodeURIComponent(campaignId)}/optimize`, {
    method: "POST",
    headers: { "If-Match": String(version) },
    body: JSON.stringify(acknowledgeReoptimization ? { acknowledge_reoptimization: true } : {}),
  }), campaignId);
}

export async function addCampaignOverride(campaignId: string, payload: CampaignOverrideInput, version: number): Promise<Campaign> {
  return normalizeCampaign(await requestJson<unknown>(`/api/v1/campaigns/${encodeURIComponent(campaignId)}/overrides`, {
    method: "POST",
    headers: { "If-Match": String(version) },
    body: JSON.stringify(payload),
  }), campaignId);
}

export async function removeCampaignOverride(campaignId: string, overrideId: string, version: number): Promise<Campaign> {
  return normalizeCampaign(await requestJson<unknown>(`/api/v1/campaigns/${encodeURIComponent(campaignId)}/overrides/${encodeURIComponent(overrideId)}`, {
    method: "DELETE",
    headers: { "If-Match": String(version) },
  }), campaignId);
}

export async function confirmCampaign(campaignId: string, idempotencyKey: string, version: number): Promise<Campaign> {
  return normalizeCampaign(await requestJson<unknown>(`/api/v1/campaigns/${encodeURIComponent(campaignId)}/confirm`, {
    method: "POST",
    headers: { "Idempotency-Key": idempotencyKey, "If-Match": String(version) },
    body: JSON.stringify({}),
  }), campaignId);
}

export async function archiveCampaign(campaignId: string, version: number): Promise<Campaign> {
  return normalizeCampaign(await requestJson<unknown>(`/api/v1/campaigns/${encodeURIComponent(campaignId)}/archive`, {
    method: "POST",
    headers: { "If-Match": String(version) },
    body: JSON.stringify({}),
  }), campaignId);
}

export function campaignStatusLabel(status: CampaignStatus): string {
  return status[0].toUpperCase() + status.slice(1);
}

export type OutreachStatus = "not_started" | "attempted" | "no_answer" | "reached" | "offer_accepted" | "offer_declined";
export type OutreachEvent = { event_id: string; status: Exclude<OutreachStatus, "not_started">; note: string | null; actor: string; created_at: string };
export type OutreachItem = { selection_id: string; customer_id: string; risk_score: number; priority_score: number; monthly_charges: number; status: OutreachStatus; events: OutreachEvent[] };
export type OutreachSummary = {
  selected: number; contacted: number; reached: number; accepted: number;
  value_horizon_months: number; contact_cost_per_customer: number;
  associated_value: number; estimated_contact_cost: number; illustrative_net_value: number;
};
export type OutreachPage = { items: OutreachItem[]; total: number; page: number; page_size: number; summary: OutreachSummary };

export function getOutreach(campaignId: string, page = 1, status?: OutreachStatus): Promise<OutreachPage> {
  const query = new URLSearchParams({ page: String(page), page_size: "25" });
  if (status) query.set("status", status);
  return requestJson<OutreachPage>(`/api/v1/campaigns/${encodeURIComponent(campaignId)}/outreach?${query}`);
}

export function recordOutreach(campaignId: string, selectionId: string, status: Exclude<OutreachStatus, "not_started">, note: string, key: string): Promise<OutreachEvent> {
  return requestJson<OutreachEvent>(`/api/v1/campaigns/${encodeURIComponent(campaignId)}/outreach/${encodeURIComponent(selectionId)}/events`, {
    method: "POST", headers: { "Idempotency-Key": key }, body: JSON.stringify({ status, note: note.trim() || null }),
  });
}

export async function downloadOutreach(campaignId: string): Promise<Blob> {
  const response = await fetch(`${API_BASE_URL}/api/v1/campaigns/${encodeURIComponent(campaignId)}/outreach.csv`);
  if (!response.ok) throw new ApiError(response.status, await parseProblem(response));
  return response.blob();
}
