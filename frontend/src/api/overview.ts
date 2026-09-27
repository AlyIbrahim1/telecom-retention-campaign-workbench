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
