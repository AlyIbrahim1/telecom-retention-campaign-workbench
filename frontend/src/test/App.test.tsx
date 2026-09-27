import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { run as runAxe } from "axe-core";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { routes } from "../app/router";

function readyResponse(input?: RequestInfo | URL) {
  const body = String(input).endsWith("/api/v1/overview")
    ? { customers_scored: 0, campaigns_awaiting_review: 0, confirmed_selections: 0, contacts_recorded: 0, accepted_offers: 0 }
    : { ready: true };
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

function renderPath(path: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  return render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(readyResponse));
});

describe("route placeholders", () => {
  const cases = [
    ["/", "Overview"],
    ["/customers", "Customers"],
    ["/customers/new", "New customer"],
    ["/customers/DEMO-001", "Customer details"],
    ["/customers/DEMO-001/edit", "Update customer"],
    ["/imports", "Imports"],
    ["/imports/new", "New import"],
    ["/imports/import-1", "Import details"],
    ["/campaigns", "Campaigns"],
    ["/campaigns/new", "New campaign"],
    ["/campaigns/campaign-1", "Campaign details"],
  ];

  it.each(cases)("renders %s", async (path, heading) => {
    renderPath(path);
    expect(await screen.findByRole("heading", { name: heading })).toBeVisible();
  });
});

it("renders the accessible persistent shell and active navigation", async () => {
  renderPath("/customers");

  await screen.findByRole("heading", { name: "Customers" });
  expect(screen.getByRole("link", { name: "Retention Campaign Workbench overview" })).toBeVisible();
  expect(screen.queryByText(/pilot|sample or approved test data/i)).not.toBeInTheDocument();
  expect(screen.getByRole("navigation", { name: "Primary navigation" })).toBeVisible();
  expect(screen.getByRole("main")).toHaveAttribute("id", "main-content");
  expect(screen.getByRole("link", { name: "Skip to main content" })).toHaveAttribute(
    "href",
    "#main-content",
  );
  expect(screen.getByRole("link", { name: "Customers" })).toHaveAttribute(
    "aria-current",
    "page",
  );
});

it("opens the assistant panel from the legacy /chat link", async () => {
  renderPath("/chat");
  expect(await screen.findByRole("heading", { name: "Overview" })).toBeVisible();
  expect(screen.getByRole("heading", { name: "Assistant" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Assistant" })).toHaveAttribute("aria-expanded", "true");
  expect(screen.queryByRole("link", { name: "Assistant" })).not.toBeInTheDocument();
});

it("keeps the shell visible during loading", () => {
  vi.stubGlobal("fetch", vi.fn(() => new Promise(() => undefined)));
  renderPath("/");

  expect(screen.getByRole("status")).toHaveTextContent("Connecting to customer and campaign services");
  expect(screen.getByRole("link", { name: "Retention Campaign Workbench overview" })).toBeVisible();
});

it("shows a safe unavailable state and retries", async () => {
  const fetchMock = vi
    .fn()
    .mockRejectedValueOnce(new Error("raw private failure"))
    .mockImplementation(readyResponse);
  vi.stubGlobal("fetch", fetchMock);
  renderPath("/");

  expect(await screen.findByRole("alert")).toHaveTextContent("Customer and campaign services");
  expect(screen.queryByText("raw private failure")).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByRole("heading", { name: "Overview" })).toBeVisible();
  expect(
    fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/health/ready")),
  ).toHaveLength(2);
});

it("renders a shell-preserving not-found page", () => {
  renderPath("/does-not-exist");

  expect(screen.getByRole("heading", { name: "Page not found" })).toBeVisible();
  expect(screen.getByRole("link", { name: "Return to overview" })).toHaveAttribute(
    "href",
    "/",
  );
  expect(screen.getByRole("link", { name: "Retention Campaign Workbench overview" })).toBeVisible();
});

it.each(["/customers", "/does-not-exist"])(
  "has no automated accessibility violations at %s",
  async (path) => {
    const { container } = renderPath(path);
    if (path === "/customers") {
      await screen.findByRole("heading", { name: "Customers" });
    }
    const result = await runAxe(container);
    expect(result.violations).toEqual([]);
  },
);

it("has no automated accessibility violations in loading and error states", async () => {
  vi.stubGlobal("fetch", vi.fn(() => new Promise(() => undefined)));
  const loading = renderPath("/");
  expect((await runAxe(loading.container)).violations).toEqual([]);
  loading.unmount();

  vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("down"))));
  const unavailable = renderPath("/");
  await screen.findByRole("alert");
  await waitFor(async () => {
    expect((await runAxe(unavailable.container)).violations).toEqual([]);
  });
});

it("renders the dataset dashboard with labelled, keyboard-reachable chart marks and no axe violations", async () => {
  const insight = {
    active_customers: 10, inactive_customers: 1, monthly_charges_total: 650.5, monthly_charges_average: 65.05, monthly_charges_median: 70,
    total_charges_average: 2200, tenure_average: 30.5, tenure_median: 29, internet_customers: 8,
    by_contract: [{ label: "Month-to-month", customers: 6 }, { label: "One year", customers: 3 }, { label: "Two year", customers: 1 }],
    by_internet_service: [{ label: "Fiber optic", customers: 5 }, { label: "DSL", customers: 3 }, { label: "No", customers: 2 }],
    by_payment_method: [{ label: "Electronic check", customers: 10 }],
    tenure_distribution: Array.from({ length: 12 }, (_, index) => ({ lower: index * 6, upper: index * 6 + 6, customers: index % 3 })),
    monthly_charges_distribution: Array.from({ length: 12 }, (_, index) => ({ lower: index * 10, upper: index * 10 + 10, customers: index % 2 })),
    add_on_adoption: [{ key: "tech_support", label: "Tech support", customers: 2, base: 8 }],
    account_profile: [{ key: "senior_citizen", label: "Senior citizen", customers: 1, base: 10 }],
  };
  vi.stubGlobal("fetch", vi.fn((input?: RequestInfo | URL) => {
    const url = String(input);
    const body = url.endsWith("/api/v1/overview/customers") ? insight : url.endsWith("/api/v1/overview/predictions")
      ? { active_customers: 10, scored_customers: 10, unscored_customers: 0, predicted_churn: 4, predicted_no_churn: 6, threshold: 0.53, model_version: "rf-v2" }
      : url.endsWith("/api/v1/overview")
      ? { customers_scored: 10, campaigns_awaiting_review: 1, confirmed_selections: 0, contacts_recorded: 0, accepted_offers: 0 }
      : { ready: true };
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } }));
  }));
  const { container } = renderPath("/");
  expect(await screen.findByRole("heading", { name: "Tenure" })).toBeVisible();
  expect(screen.getByText("Active customers")).toBeVisible();
  expect(screen.getByRole("listitem", { name: "Month-to-month: 6 customers, 60%" })).toHaveAttribute("tabindex", "0");
  expect(screen.getByRole("listitem", { name: "Tech support: 25%, 2 of 8 internet customers" })).toBeInTheDocument();
  expect(screen.getByRole("listitem", { name: "6–12 months: 1 customers (8%)" })).toBeInTheDocument();
  expect(await screen.findByRole("img", { name: /40% predicted to churn, 60% predicted not to churn/ })).toBeInTheDocument();
  expect(screen.getByRole("listitem", { name: "Predicted to churn: 40%, 4 customers" })).toBeInTheDocument();
  expect(screen.getByText(/Predictions, not observed outcomes/)).toBeVisible();
  expect((await runAxe(container)).violations).toEqual([]);
});
