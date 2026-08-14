import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { run as runAxe } from "axe-core";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { routes } from "../app/router";

function readyResponse() {
  return Promise.resolve(
    new Response(JSON.stringify({ ready: true }), {
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
    ["/", "Campaign overview"],
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
    ["/chat", "Assistant chat"],
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
  expect(await screen.findByRole("heading", { name: "Campaign overview" })).toBeVisible();
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
