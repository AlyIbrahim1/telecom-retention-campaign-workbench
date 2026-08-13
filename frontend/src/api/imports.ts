import { ApiError, type ApiProblem } from "./customers";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8000";

export type ImportMode = "create" | "update";
export type ImportStatus =
  | "uploaded"
  | "validating"
  | "ready"
  | "queued"
  | "running"
  | "completed"
  | "partially_completed"
  | "failed"
  | "cancelled";

export type ImportJob = {
  job_id: string;
  filename: string;
  mode: ImportMode;
  status: ImportStatus;
  file_hash?: string | null;
  created_at: string;
  updated_at?: string | null;
  total_rows: number;
  valid_rows: number;
  invalid_rows: number;
  warning_count: number;
  processed_rows: number;
  succeeded_rows: number;
  failed_rows: number;
  progress_percent: number;
  message?: string | null;
  idempotency_key?: string | null;
};

export type ImportListResponse = {
  items: ImportJob[];
  total: number;
  page: number;
  page_size: number;
};

export type ImportIssue = {
  row_number?: number | null;
  customer_id?: string | null;
  field?: string | null;
  code: string;
  message: string;
};

export type ImportPreflight = {
  job_id: string;
  filename: string;
  mode: ImportMode;
  file_hash?: string | null;
  detected_columns: string[];
  mappings: Record<string, string>;
  missing_columns: string[];
  extra_columns: string[];
  duplicate_columns: string[];
  ambiguous_columns: string[];
  duplicate_customer_ids: string[];
  database_conflicts: string[];
  database_missing: string[];
  total_rows: number;
  valid_rows: number;
  invalid_rows: number;
  warning_count: number;
  warnings: ImportIssue[];
  errors: ImportIssue[];
  sample_rows: Array<Record<string, unknown>>;
  proposed_idempotency_key?: string | null;
};

export type ImportProblem = ApiProblem & { errors?: ImportIssue[] };

async function parseProblem(response: Response): Promise<ImportProblem> {
  const body = await response.json().catch(() => ({}));
  return body as ImportProblem;
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

async function fileRequest(path: string, init?: RequestInit): Promise<Blob> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      headers: { Accept: "text/csv, application/octet-stream", ...init?.headers },
    });
  } catch {
    throw new ApiError(0, {
      code: "service_unavailable",
      title: "Connection unavailable",
      detail: "The local API could not be reached. Check the stack and try again.",
    });
  }
  if (!response.ok) throw new ApiError(response.status, await parseProblem(response));
  return response.blob();
}

function queryString(values: Record<string, string | number | undefined>): string {
  const params = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => {
    if (value !== undefined && value !== "") params.set(key, String(value));
  });
  const query = params.toString();
  return query ? `?${query}` : "";
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function asIssueList(value: unknown): ImportIssue[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const source = item as Record<string, unknown>;
    return [{
      row_number: typeof source.row_number === "number" ? source.row_number : null,
      customer_id: typeof source.customer_id === "string" ? source.customer_id : null,
      field: typeof source.field === "string" ? source.field : null,
      code: String(source.code ?? source.error_code ?? "import_row_error"),
      message: String(source.message ?? "The row needs correction."),
    }];
  });
}

function normalizeJob(value: unknown): ImportJob {
  const body = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const jobId = String(body.job_id ?? body.id ?? "");
  const totalRows = asNumber(body.total_rows ?? body.row_count);
  const processed = asNumber(body.processed_rows ?? body.processed_count);
  const rows = Array.isArray(body.rows) ? body.rows as Array<Record<string, unknown>> : [];
  const succeeded = asNumber(body.succeeded_rows ?? body.success_count, rows.filter((row) => ["created", "updated", "success", "succeeded"].includes(String(row.status))).length);
  const failed = asNumber(body.failed_rows ?? body.failure_count, rows.filter((row) => ["invalid", "failed", "error"].includes(String(row.status))).length);
  const processedRows = processed || (body.status === "completed" || body.status === "partially_completed" ? totalRows : 0);
  const progress = asNumber(body.progress_percent ?? body.progress, totalRows ? (processedRows / totalRows) * 100 : 0);
  return {
    job_id: jobId,
    filename: String(body.filename ?? body.original_filename ?? "Import file"),
    mode: body.mode === "update" ? "update" : "create",
    status: (body.status as ImportStatus) ?? "uploaded",
    file_hash: typeof body.file_hash === "string" ? body.file_hash : typeof body.file_sha256 === "string" ? body.file_sha256 : null,
    created_at: String(body.created_at ?? new Date().toISOString()),
    updated_at: typeof body.updated_at === "string" ? body.updated_at : null,
    total_rows: totalRows,
    valid_rows: asNumber(body.valid_rows ?? body.valid_count),
    invalid_rows: asNumber(body.invalid_rows ?? body.invalid_count),
    warning_count: asNumber(body.warning_count ?? body.warnings_count ?? body.warning_rows),
    processed_rows: processedRows,
    succeeded_rows: succeeded,
    failed_rows: failed,
    progress_percent: Math.min(100, Math.max(0, progress)),
    message: typeof body.message === "string" ? body.message : null,
    idempotency_key: typeof body.idempotency_key === "string" ? body.idempotency_key : null,
  };
}

function normalizePreflight(value: unknown): ImportPreflight {
  const body = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const rowReports = Array.isArray(body.rows) ? body.rows as Array<Record<string, unknown>> : [];
  const rowErrors = rowReports.flatMap((row) => asIssueList(row.errors).map((issue) => ({ ...issue, row_number: issue.row_number ?? (typeof row.row_number === "number" ? row.row_number : null), customer_id: issue.customer_id ?? (typeof row.customer_id === "string" ? row.customer_id : null) })));
  const rowWarnings = rowReports.flatMap((row) => asIssueList(row.warnings).map((issue) => ({ ...issue, row_number: issue.row_number ?? (typeof row.row_number === "number" ? row.row_number : null), customer_id: issue.customer_id ?? (typeof row.customer_id === "string" ? row.customer_id : null) })));
  const errors = [...asIssueList(body.errors ?? body.row_errors), ...rowErrors];
  const warnings = [...asIssueList(body.warnings ?? body.row_warnings), ...rowWarnings];
  return {
    job_id: String(body.job_id ?? body.id ?? ""),
    filename: String(body.filename ?? body.original_filename ?? "Import file"),
    mode: body.mode === "update" ? "update" : "create",
    file_hash: typeof body.file_hash === "string" ? body.file_hash : null,
    detected_columns: asStringArray(body.detected_columns ?? body.columns),
    mappings: body.mappings && typeof body.mappings === "object" ? body.mappings as Record<string, string> : {},
    missing_columns: asStringArray(body.missing_columns),
    extra_columns: asStringArray(body.extra_columns),
    duplicate_columns: asStringArray(body.duplicate_columns),
    ambiguous_columns: asStringArray(body.ambiguous_columns),
    duplicate_customer_ids: asStringArray(body.duplicate_customer_ids),
    database_conflicts: asStringArray(body.database_conflicts ?? body.existing_customer_ids),
    database_missing: asStringArray(body.database_missing ?? body.missing_customer_ids),
    total_rows: asNumber(body.total_rows ?? body.row_count),
    valid_rows: asNumber(body.valid_rows ?? body.valid_count),
    invalid_rows: asNumber(body.invalid_rows ?? body.invalid_count, errors.length),
    warning_count: asNumber(body.warning_count ?? body.warnings_count ?? body.warning_rows, warnings.length),
    warnings,
    errors,
    sample_rows: Array.isArray(body.sample_rows) ? body.sample_rows as Array<Record<string, unknown>> : [],
    proposed_idempotency_key: typeof body.proposed_idempotency_key === "string" ? body.proposed_idempotency_key : null,
  };
}

export async function listImports(page = 1, pageSize = 25): Promise<ImportListResponse> {
  const body = await jsonRequest<unknown>(`/api/v1/imports${queryString({ page, page_size: pageSize })}`);
  const source = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const rawItems = Array.isArray(source.items) ? source.items : Array.isArray(body) ? body : [];
  return {
    items: rawItems.map(normalizeJob),
    total: asNumber(source.total, rawItems.length),
    page: asNumber(source.page, page),
    page_size: asNumber(source.page_size, pageSize),
  };
}

export async function getImport(jobId: string): Promise<ImportJob> {
  return normalizeJob(await jsonRequest<unknown>(`/api/v1/imports/${encodeURIComponent(jobId)}`));
}

export async function preflightImport(file: File, mode: ImportMode): Promise<ImportPreflight> {
  const form = new FormData();
  form.append("file", file, file.name);
  form.append("mode", mode);
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/api/v1/imports/preflight?mode=${mode}`, {
      method: "POST",
      headers: { Accept: "application/json" },
      body: form,
    });
  } catch {
    throw new ApiError(0, { code: "service_unavailable", title: "Connection unavailable", detail: "The local API could not be reached. Check the stack and try again." });
  }
  if (!response.ok) throw new ApiError(response.status, await parseProblem(response));
  return normalizePreflight(await response.json());
}

export function confirmImport(jobId: string, idempotencyKey: string): Promise<ImportJob> {
  return jsonRequest<unknown>(`/api/v1/imports/${encodeURIComponent(jobId)}/confirm`, {
    method: "POST",
    headers: { "Idempotency-Key": idempotencyKey },
    body: JSON.stringify({}),
  }).then(normalizeJob);
}

export function cancelImport(jobId: string): Promise<ImportJob> {
  return jsonRequest<unknown>(`/api/v1/imports/${encodeURIComponent(jobId)}/cancel`, {
    method: "POST",
    body: JSON.stringify({}),
  }).then(normalizeJob);
}

export function downloadTemplate(): Promise<Blob> {
  return fileRequest("/api/v1/imports/template");
}

export function downloadImportResults(jobId: string): Promise<Blob> {
  return fileRequest(`/api/v1/imports/${encodeURIComponent(jobId)}/results.csv`);
}

export function downloadImportErrors(jobId: string): Promise<Blob> {
  return fileRequest(`/api/v1/imports/${encodeURIComponent(jobId)}/errors.csv`);
}
