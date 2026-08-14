const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8000";

export type YesNo = "Yes" | "No";
export type CustomerInput = {
  customer_id: string;
  gender: "Female" | "Male";
  senior_citizen: YesNo;
  partner: YesNo;
  dependents: YesNo;
  tenure: number;
  phone_service: YesNo;
  multiple_lines: "Yes" | "No" | "No phone service";
  internet_service: "DSL" | "Fiber optic" | "No";
  online_security: "Yes" | "No" | "No internet service";
  online_backup: "Yes" | "No" | "No internet service";
  device_protection: "Yes" | "No" | "No internet service";
  tech_support: "Yes" | "No" | "No internet service";
  streaming_tv: "Yes" | "No" | "No internet service";
  streaming_movies: "Yes" | "No" | "No internet service";
  contract: "Month-to-month" | "One year" | "Two year";
  paperless_billing: YesNo;
  payment_method:
    | "Bank transfer (automatic)"
    | "Credit card (automatic)"
    | "Electronic check"
    | "Mailed check";
  monthly_charges: number;
  total_charges: number;
};

export type ValidationWarning = {
  code: "out_of_distribution";
  field: "tenure" | "monthly_charges" | "total_charges";
  message: string;
};

export type Prediction = {
  customer_id: string;
  risk_score: number;
  recommended_for_review: boolean;
  model_version: string;
  threshold: number;
  threshold_policy_version: string;
  scored_at: string;
  warnings: ValidationWarning[];
};

export type CustomerRecord = {
  customer: CustomerInput;
  is_active: boolean;
  version: number;
  created_at: string;
  updated_at: string;
  source: string;
  current_prediction: Prediction | null;
};

export type CustomerDetail = CustomerRecord & {
  predictions: Prediction[];
  audit_events: AuditEvent[];
};

export type AuditEvent = {
  event_id: string;
  action: string;
  actor: string;
  source: string;
  created_at: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  correlation_id?: string | null;
};

export type CustomerPreview = {
  normalized_customer: CustomerInput;
  prediction: Prediction;
  warnings: ValidationWarning[];
};

export type CustomerWrite = {
  customer: CustomerRecord;
  prediction: Prediction;
};

export type CustomerListItem = {
  customer_id: string;
  contract: CustomerInput["contract"];
  internet_service: CustomerInput["internet_service"];
  tenure: number;
  monthly_charges: number;
  total_charges: number;
  risk_score: number | null;
  recommended_for_review: boolean | null;
  last_scored_at: string | null;
  current_prediction?: Prediction | null;
  outreach_status: string | null;
  is_active: boolean;
  version: number;
};

export type CustomerListResponse = {
  items: CustomerListItem[];
  total: number;
  page: number;
  page_size: number;
};

export type ListQuery = {
  page: number;
  page_size: 25 | 50 | 100;
  search?: string;
  recommended?: "true" | "false";
  score_freshness?: "fresh" | "missing";
  outreach_status?: string;
  contract?: CustomerInput["contract"];
  internet_service?: CustomerInput["internet_service"];
  is_active?: "true" | "false";
  sort: "customer_id" | "risk_score" | "monthly_charges" | "total_charges" | "last_scored_at";
  order: "asc" | "desc";
};

export type ApiFieldError = {
  field?: string;
  code: string;
  message: string;
};

export type ApiProblem = {
  code?: string;
  title?: string;
  detail?: string;
  status?: number;
  correlation_id?: string;
  errors?: ApiFieldError[];
};

export class ApiError extends Error {
  readonly problem: ApiProblem;
  readonly status: number;

  constructor(status: number, problem: ApiProblem) {
    super(problem.detail || problem.title || "The request could not be completed.");
    this.name = "ApiError";
    this.status = status;
    this.problem = problem;
  }
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
      detail: "Customer services could not be reached. Check the application services and try again.",
    });
  }

  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiError(response.status, (body ?? {}) as ApiProblem);
  }
  return body as T;
}

function listParams(query: ListQuery): string {
  const params = new URLSearchParams();
  params.set("page", String(query.page));
  params.set("page_size", String(query.page_size));
  params.set("sort", query.sort);
  params.set("order", query.order);
  const optional: Record<string, string | undefined> = {
    q: query.search?.trim() || undefined,
    recommended: query.recommended,
    score_freshness: query.score_freshness,
    outreach_status: query.outreach_status,
    contract: query.contract,
    internet_service: query.internet_service,
    is_active: query.is_active,
  };
  Object.entries(optional).forEach(([key, value]) => {
    if (value) params.set(key, value);
  });
  return params.toString();
}

export async function listCustomers(query: ListQuery): Promise<CustomerListResponse> {
  const body = await requestJson<Partial<CustomerListResponse>>(
    `/api/v1/customers?${listParams(query)}`,
  );
  // A safe empty response keeps the shell usable while an older API is
  // starting. A real list response always includes items and total.
  return {
    items: Array.isArray(body.items)
      ? body.items.map((item) => {
          const prediction = item.current_prediction;
          return {
            ...item,
            risk_score: item.risk_score ?? prediction?.risk_score ?? null,
            recommended_for_review: item.recommended_for_review ?? prediction?.recommended_for_review ?? null,
            last_scored_at: item.last_scored_at ?? prediction?.scored_at ?? null,
          };
        })
      : [],
    total: typeof body.total === "number" ? body.total : 0,
    page: typeof body.page === "number" ? body.page : query.page,
    page_size: typeof body.page_size === "number" ? body.page_size : query.page_size,
  };
}

export function getCustomer(customerId: string): Promise<CustomerDetail> {
  return requestJson<CustomerDetail>(`/api/v1/customers/${encodeURIComponent(customerId)}`);
}

export function previewCustomer(payload: CustomerInput): Promise<CustomerPreview> {
  return requestJson<CustomerPreview>("/api/v1/customers/preview", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function previewCustomerUpdate(
  customerId: string,
  payload: CustomerInput,
): Promise<CustomerPreview> {
  return requestJson<CustomerPreview>(
    `/api/v1/customers/${encodeURIComponent(customerId)}/preview-update`,
    { method: "POST", body: JSON.stringify(payload) },
  );
}

export function createCustomer(payload: CustomerInput, idempotencyKey: string): Promise<CustomerWrite> {
  return requestJson<CustomerWrite>("/api/v1/customers", {
    method: "POST",
    headers: { "Idempotency-Key": idempotencyKey },
    body: JSON.stringify(payload),
  });
}

export function updateCustomer(
  customerId: string,
  payload: CustomerInput,
  version: number,
  idempotencyKey: string,
): Promise<CustomerWrite> {
  return requestJson<CustomerWrite>(`/api/v1/customers/${encodeURIComponent(customerId)}`, {
    method: "PUT",
    headers: { "Idempotency-Key": idempotencyKey, "If-Match": String(version) },
    body: JSON.stringify(payload),
  });
}
