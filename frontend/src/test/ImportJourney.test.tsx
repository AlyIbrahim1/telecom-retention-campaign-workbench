import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { routes } from "../app/router";

function response(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
}

const preflight = {
  job_id: "job-001",
  filename: "customers.csv",
  mode: "create",
  file_hash: "abcdef1234567890",
  detected_columns: ["customerID", "gender"],
  mappings: { customerID: "customer_id", gender: "gender" },
  missing_columns: [],
  extra_columns: [],
  duplicate_columns: [],
  ambiguous_columns: [],
  duplicate_customer_ids: [],
  database_conflicts: [],
  database_missing: [],
  total_rows: 2,
  valid_rows: 2,
  invalid_rows: 0,
  warning_count: 0,
  warnings: [],
  errors: [],
  sample_rows: [],
  proposed_idempotency_key: "preflight-key",
};

const job = {
  job_id: "job-001",
  filename: "customers.csv",
  mode: "create",
  status: "ready",
  created_at: "2026-08-13T09:00:00Z",
  total_rows: 2,
  valid_rows: 2,
  invalid_rows: 0,
  warning_count: 0,
  processed_rows: 0,
  succeeded_rows: 0,
  failed_rows: 0,
  progress_percent: 0,
  idempotency_key: "preflight-key",
};

function renderPath(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  return render(<QueryClientProvider client={queryClient}><RouterProvider router={router} /></QueryClientProvider>);
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/health/ready")) return response({ ready: true });
    if (url.includes("/api/v1/imports/preflight")) return response(preflight);
    if (url.endsWith("/api/v1/imports/job-001")) return response(job);
    if (url.includes("/api/v1/imports?") || url.endsWith("/api/v1/imports")) return response({ items: [job], total: 1, page: 1, page_size: 25 });
    if (url.endsWith("/confirm")) return response({ ...job, status: "queued" });
    return response({ detail: "not found" }, 404);
  }));
});

describe("import browser journey", () => {
  it("selects a file, runs preflight, and reaches explicit confirmation", async () => {
    const user = userEvent.setup();
    renderPath("/imports/new");
    expect(await screen.findByRole("heading", { name: "New import" })).toBeVisible();
    const file = new File(["customerID,gender\nA-1,Female\nA-2,Male\n"], "customers.csv", { type: "text/csv" });
    await user.upload(screen.getByLabelText("CSV file"), file);
    await user.click(screen.getByRole("button", { name: "Run preflight" }));
    expect(await screen.findByRole("heading", { name: "Review preflight" })).toBeVisible();
    expect(screen.getAllByText("2", { exact: true }).length).toBeGreaterThanOrEqual(2);
    await user.click(screen.getByRole("button", { name: "Continue to confirmation" }));
    expect(await screen.findByRole("heading", { name: "Import details" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Confirm and process import" })).toBeVisible();
  });

  it("shows import history and polls a ready job", async () => {
    renderPath("/imports");
    expect(await screen.findByRole("heading", { name: "Imports" })).toBeVisible();
    expect(await screen.findByRole("link", { name: "customers.csv" })).toBeVisible();
    await userEvent.click(screen.getByRole("link", { name: "customers.csv" }));
    expect(await screen.findByRole("heading", { name: "Import details" })).toBeVisible();
    await waitFor(() => expect(screen.getByText("Ready")).toBeVisible());
  });
});
