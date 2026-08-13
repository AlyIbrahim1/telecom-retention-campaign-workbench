import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { routes } from "../app/router";
import type { CustomerDetail, CustomerInput, CustomerPreview, CustomerWrite } from "../api/customers";

const customer: CustomerInput = {
  customer_id: "JOURNEY-001",
  gender: "Female",
  senior_citizen: "No",
  partner: "Yes",
  dependents: "No",
  tenure: 3,
  phone_service: "Yes",
  multiple_lines: "No",
  internet_service: "DSL",
  online_security: "No",
  online_backup: "No",
  device_protection: "No",
  tech_support: "No",
  streaming_tv: "Yes",
  streaming_movies: "No",
  contract: "Month-to-month",
  paperless_billing: "Yes",
  payment_method: "Electronic check",
  monthly_charges: 89.5,
  total_charges: 268.5,
};

const prediction = {
  customer_id: customer.customer_id,
  risk_score: 0.83,
  recommended_for_review: true,
  model_version: "random-forest-bundle-v1",
  threshold: 0.5268190582639384,
  threshold_policy_version: "fpr-cap-0.31-v1",
  scored_at: "2026-08-13T09:00:00Z",
  warnings: [],
};

const detail: CustomerDetail = {
  customer,
  is_active: true,
  version: 1,
  created_at: "2026-08-13T09:00:00Z",
  updated_at: "2026-08-13T09:00:00Z",
  source: "form",
  current_prediction: prediction,
  predictions: [prediction],
  audit_events: [{
    event_id: "audit-1",
    action: "customer_created",
    actor: "local-demo-user",
    source: "form",
    created_at: "2026-08-13T09:00:00Z",
  }],
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
    if (url.includes("/api/v1/customers?") && (!init || init.method === undefined)) {
      return response({
        items: [{
          customer_id: customer.customer_id,
          contract: customer.contract,
          internet_service: customer.internet_service,
          tenure: customer.tenure,
          monthly_charges: customer.monthly_charges,
          total_charges: customer.total_charges,
          risk_score: prediction.risk_score,
          recommended_for_review: prediction.recommended_for_review,
          last_scored_at: prediction.scored_at,
          outreach_status: null,
          is_active: true,
          version: 1,
        }],
        total: 1,
        page: 1,
        page_size: 25,
      });
    }
    if (url.endsWith("/api/v1/customers/preview") && init?.method === "POST") {
      const preview: CustomerPreview = { normalized_customer: customer, prediction, warnings: [] };
      return response(preview);
    }
    if (url.endsWith("/preview-update") && init?.method === "POST") {
      const preview: CustomerPreview = { normalized_customer: customer, prediction, warnings: [] };
      return response(preview);
    }
    if (url.endsWith("/api/v1/customers") && init?.method === "POST") {
      const write: CustomerWrite = { customer: detail, prediction };
      return response(write, 201);
    }
    if (url.endsWith("/api/v1/customers/JOURNEY-001") && init?.method === "PUT") {
      const write: CustomerWrite = { customer: { ...detail, version: 2 }, prediction };
      return response(write);
    }
    if (url.includes("/api/v1/customers/JOURNEY-001")) return response(detail);
    return response({ code: "not_found", detail: "not found" }, 404);
  }));
});

describe("customer browser journeys", () => {
  it("searches a server-side list and opens the customer record", async () => {
    const user = userEvent.setup();
    renderPath("/customers");

    expect(await screen.findByRole("heading", { name: "Customers" })).toBeVisible();
    expect(await screen.findByRole("link", { name: "JOURNEY-001" })).toBeVisible();
    await user.type(screen.getByRole("searchbox", { name: "Search customer ID" }), "JOURNEY");
    await waitFor(() => expect(fetch).toHaveBeenCalledWith(expect.stringContaining("q=JOURNEY"), expect.anything()));
    await user.click(screen.getByRole("link", { name: "JOURNEY-001" }));
    expect(await screen.findByRole("heading", { name: "Customer details" })).toBeVisible();
    expect(screen.getByText("Current prediction")).toBeVisible();
    expect(screen.getByText("83%", { exact: false })).toBeVisible();
  });

  it("previews then explicitly persists a new customer", async () => {
    const user = userEvent.setup();
    renderPath("/customers/new");
    expect(await screen.findByRole("heading", { name: "New customer" })).toBeVisible();

    await user.type(screen.getByLabelText("Customer ID"), "journey-001");
    await user.type(screen.getByLabelText("Tenure (months)"), "3");
    await user.type(screen.getByLabelText("Monthly charges"), "89.5");
    await user.type(screen.getByLabelText("Total charges"), "268.5");
    await user.click(screen.getByRole("button", { name: "Preview model score" }));
    expect(await screen.findByRole("heading", { name: /Review prediction before creating/ })).toBeVisible();
    expect(screen.getByText("No data saved yet")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Create customer" }));
    expect(await screen.findByRole("heading", { name: "Customer details" })).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent("Customer created and scored");
    expect(fetch).toHaveBeenCalledWith(expect.stringMatching(/\/api\/v1\/customers$/), expect.objectContaining({ method: "POST" }));
  });

  it("shows changed fields before an explicit versioned update", async () => {
    const user = userEvent.setup();
    renderPath("/customers/JOURNEY-001/edit");
    expect(await screen.findByRole("heading", { name: "Update customer" })).toBeVisible();
    const monthly = screen.getByLabelText("Monthly charges");
    await user.clear(monthly);
    await user.type(monthly, "95");
    await user.click(screen.getByRole("button", { name: "Preview model score" }));
    expect(await screen.findByRole("heading", { name: /Review prediction before saving/ })).toBeVisible();
    expect(screen.getByText("Monthly charges")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Save update" }));
    expect(await screen.findByRole("heading", { name: "Customer details" })).toBeVisible();
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining("/api/v1/customers/JOURNEY-001"), expect.objectContaining({ method: "PUT", headers: expect.objectContaining({ "If-Match": "1" }) }));
  });
});
