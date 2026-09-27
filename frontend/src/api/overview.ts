import { ApiError, type ApiProblem } from "./customers";

export type Overview = {
  customers_scored: number;
  campaigns_awaiting_review: number;
  confirmed_selections: number;
  contacts_recorded: number;
  accepted_offers: number;
};

export async function getOverview(): Promise<Overview> {
  let response: Response;
  try {
    response = await fetch(`${import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8000"}/api/v1/overview`);
  } catch {
    throw new ApiError(0, { code: "service_unavailable", title: "Connection unavailable", detail: "Overview could not be loaded." });
  }
  if (!response.ok) throw new ApiError(response.status, await response.json() as ApiProblem);
  return response.json() as Promise<Overview>;
}

export type MixItem = { label: string; customers: number };
export type HistogramBin = { lower: number; upper: number; customers: number };
export type ShareItem = { key: string; label: string; customers: number; base: number };
export type CustomerOverview = {
  active_customers: number;
  inactive_customers: number;
  monthly_charges_total: number;
  monthly_charges_average: number | null;
  monthly_charges_median: number | null;
  total_charges_average: number | null;
  tenure_average: number | null;
  tenure_median: number | null;
  internet_customers: number;
  by_contract: MixItem[];
  by_internet_service: MixItem[];
  by_payment_method: MixItem[];
  tenure_distribution: HistogramBin[];
  monthly_charges_distribution: HistogramBin[];
  add_on_adoption: ShareItem[];
  account_profile: ShareItem[];
};

export async function getCustomerOverview(): Promise<CustomerOverview> {
  let response: Response;
  try {
    response = await fetch(`${import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8000"}/api/v1/overview/customers`);
  } catch {
    throw new ApiError(0, { code: "service_unavailable", title: "Connection unavailable", detail: "Customer statistics could not be loaded." });
  }
  if (!response.ok) throw new ApiError(response.status, await response.json().catch(() => ({})) as ApiProblem);
  const body = await response.json() as Partial<CustomerOverview>;
  const list = <T,>(value: T[] | undefined) => (Array.isArray(value) ? value : []);
  const num = (value: number | null | undefined) => (typeof value === "number" && Number.isFinite(value) ? value : null);
  return {
    active_customers: body.active_customers ?? 0,
    inactive_customers: body.inactive_customers ?? 0,
    monthly_charges_total: body.monthly_charges_total ?? 0,
    monthly_charges_average: num(body.monthly_charges_average),
    monthly_charges_median: num(body.monthly_charges_median),
    total_charges_average: num(body.total_charges_average),
    tenure_average: num(body.tenure_average),
    tenure_median: num(body.tenure_median),
    internet_customers: body.internet_customers ?? 0,
    by_contract: list(body.by_contract),
    by_internet_service: list(body.by_internet_service),
    by_payment_method: list(body.by_payment_method),
    tenure_distribution: list(body.tenure_distribution),
    monthly_charges_distribution: list(body.monthly_charges_distribution),
    add_on_adoption: list(body.add_on_adoption),
    account_profile: list(body.account_profile),
  };
}

export type PredictionOverview = {
  active_customers: number;
  scored_customers: number;
  unscored_customers: number;
  predicted_churn: number;
  predicted_no_churn: number;
  threshold: number | null;
  model_version: string | null;
};

export async function getPredictionOverview(): Promise<PredictionOverview> {
  let response: Response;
  try {
    response = await fetch(`${import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8000"}/api/v1/overview/predictions`);
  } catch {
    throw new ApiError(0, { code: "service_unavailable", title: "Connection unavailable", detail: "Prediction summary could not be loaded." });
  }
  if (!response.ok) throw new ApiError(response.status, await response.json().catch(() => ({})) as ApiProblem);
  const body = await response.json() as Partial<PredictionOverview>;
  return {
    active_customers: body.active_customers ?? 0,
    scored_customers: body.scored_customers ?? 0,
    unscored_customers: body.unscored_customers ?? 0,
    predicted_churn: body.predicted_churn ?? 0,
    predicted_no_churn: body.predicted_no_churn ?? 0,
    threshold: typeof body.threshold === "number" ? body.threshold : null,
    model_version: typeof body.model_version === "string" ? body.model_version : null,
  };
}
