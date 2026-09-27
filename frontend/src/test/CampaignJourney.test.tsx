import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { routes } from "../app/router";

const draft = {
  campaign_id: "camp-001",
  name: "August review",
  capacity: 2,
  status: "draft",
  version: 1,
  created_at: "2026-08-13T09:00:00Z",
  updated_at: "2026-08-13T09:00:00Z",
  eligible_count: 0,
  recommended_count: 0,
  selected_count: 0,
  unused_capacity: 2,
  recommendations: [],
  overrides: [],
};

const optimized = {
  ...draft,
  status: "optimized",
  recommendations: [
    {
      recommendation_id: "rec-001",
      customer_id: "CUST-001",
      rank: 1,
      risk_score: 0.83,
      recommended: true,
      recommended_for_review: true,
      selected: false,
      monthly_charges: 90,
      total_charges: 300,
      monthly_spend_percentile: 0.8,
      historical_spend_percentile: 0.6,
      value_index: 0.72,
      priority_score: 59.76,
      model_version: "random-forest-bundle-v1",
      scored_at: "2026-08-13T09:00:00Z",
    },
    {
      recommendation_id: "rec-002",
      customer_id: "CUST-002",
      rank: 2,
      risk_score: 0.32,
      recommended: true,
      recommended_for_review: true,
      selected: false,
      monthly_charges: 60,
      total_charges: 100,
      monthly_spend_percentile: 0.3,
      historical_spend_percentile: 0.2,
      value_index: 0.26,
      priority_score: 8.32,
      model_version: "random-forest-bundle-v1",
      scored_at: "2026-08-13T09:00:00Z",
    },
  ],
  eligible_count: 2,
  recommended_count: 2,
  selected_count: 0,
  unused_capacity: 0,
  optimization: {
    run_id: "run-001",
    formula_version: "risk-spend-v1",
    monthly_weight: 0.6,
    historical_weight: 0.4,
    reference_population_timestamp: "2026-08-13T09:00:00Z",
    eligible_count: 2,
    recommended_count: 2,
    unused_capacity: 0,
  },
};

function response(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
}

function renderPath(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  return render(<QueryClientProvider client={queryClient}><RouterProvider router={router} /></QueryClientProvider>);
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/health/ready")) return response({ ready: true });
    if (url.endsWith("/api/v1/campaigns") && init?.method === "POST") return response(draft, 201);
    if (url.endsWith("/api/v1/campaigns/camp-001/optimize")) return response(optimized);
    if (url.endsWith("/api/v1/campaigns/camp-001/overrides")) return response({ ...optimized, overrides: [{ override_id: "override-1", customer_id: "CUST-001", action: "exclude", reason: "Existing service issue", created_at: "2026-08-13T09:05:00Z" }] });
    if (url.endsWith("/api/v1/campaigns/camp-001/confirm")) return response({ ...optimized, status: "confirmed", selected_count: 1, confirmed_at: "2026-08-13T09:10:00Z" });
    if (url.endsWith("/api/v1/campaigns/camp-001")) return response(optimized);
    if (url.includes("/api/v1/campaigns?")) return response({ items: [draft], total: 1, page: 1, page_size: 25 });
    return response({ code: "not_found", detail: "not found" }, 404);
  }));
});

describe("campaign browser journeys", () => {
  it("creates a named capacity-limited draft", async () => {
    const user = userEvent.setup();
    renderPath("/campaigns/new");
    expect(await screen.findByRole("heading", { name: "New campaign" })).toBeVisible();
    await user.type(screen.getByLabelText(/Campaign name/), "August review");
    await user.clear(screen.getByLabelText(/Customer capacity/));
    await user.type(screen.getByLabelText(/Customer capacity/), "2");
    await user.click(screen.getByRole("button", { name: "Create draft campaign" }));
    expect(await screen.findByRole("heading", { name: "Campaign details" })).toBeVisible();
    expect(await screen.findByRole("heading", { name: "Capacity" })).toBeVisible();
  });

  it("keeps recommendation, override, and confirmation actions explicit", async () => {
    const user = userEvent.setup();
    renderPath("/campaigns/camp-001");
    expect(await screen.findByRole("heading", { name: "Campaign details" })).toBeVisible();
    expect(await screen.findByText("risk-spend-v1")).toBeVisible();
    expect(screen.getAllByText("Recommended")).not.toHaveLength(0);
    await user.click(screen.getAllByRole("button", { name: "Exclude" })[0]);
    await user.type(screen.getByLabelText(/Reason/), "Existing service issue");
    await user.click(screen.getByRole("button", { name: "Record override" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith(expect.stringMatching(/\/api\/v1\/campaigns\/camp-001\/overrides$/), expect.objectContaining({ method: "POST", headers: expect.objectContaining({ "If-Match": "1" }) })));
    const confirmation = screen.getByLabelText(/I reviewed the ranked recommendations/);
    await user.click(confirmation);
    await user.click(screen.getByRole("button", { name: "Confirm campaign" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith(expect.stringMatching(/\/api\/v1\/campaigns\/camp-001\/confirm$/), expect.objectContaining({ method: "POST", headers: expect.objectContaining({ "If-Match": "1", "Idempotency-Key": expect.any(String) }) })));
  });
});

it("records a simulated offer acceptance and updates the illustrative value", async () => {
  const user = userEvent.setup();
  let events: Array<{ event_id: string; status: string; note: string | null; actor: string; created_at: string }> = [];
  const confirmed = { ...optimized, status: "confirmed", selected_count: 1, confirmed_at: "2026-08-13T09:10:00Z", value_horizon_months: 3, contact_cost_per_customer: 5 };
  vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/health/ready")) return response({ ready: true });
    if (url.endsWith("/api/v1/campaigns/camp-001")) return response(confirmed);
    if (url.includes("/api/v1/campaigns/camp-001/outreach?") && !init?.method) return response({
      items: [{ selection_id: "sel-001", customer_id: "CUST-001", risk_score: 0.83, priority_score: 59.76, monthly_charges: 90, status: events[0]?.status ?? "not_started", events }],
      total: 1, page: 1, page_size: 25,
      summary: { selected: 1, contacted: events.length ? 1 : 0, reached: events.length ? 1 : 0, accepted: events.length ? 1 : 0, value_horizon_months: 3, contact_cost_per_customer: 5, associated_value: events.length ? 270 : 0, estimated_contact_cost: events.length ? 5 : 0, illustrative_net_value: events.length ? 265 : 0 },
    });
    if (url.endsWith("/api/v1/campaigns/camp-001/outreach/sel-001/events") && init?.method === "POST") {
      const body = JSON.parse(String(init.body)) as { status: string; note: string | null };
      events = [{ event_id: "event-001", status: body.status, note: body.note, actor: "local-demo-user", created_at: "2026-08-13T09:12:00Z" }];
      return response(events[0], 201);
    }
    return response({ code: "not_found", detail: "not found" }, 404);
  }));
  renderPath("/campaigns/camp-001");
  expect(await screen.findByRole("heading", { name: "Outreach queue" })).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Record outcome" }));
  await user.selectOptions(screen.getByLabelText("Status"), "offer_accepted");
  await user.type(screen.getByLabelText("Note (optional)"), "Accepted during local demo");
  await user.click(screen.getByRole("button", { name: "Save outcome" }));
  expect(await screen.findByText(/Illustrative net value: 265\.00/)).toBeVisible();
  expect(screen.getByRole("cell", { name: "Offer accepted" })).toBeVisible();
});
