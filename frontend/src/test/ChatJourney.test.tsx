import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { routes } from "../app/router";

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
    if (url.endsWith("/api/v1/chat/sessions") && init?.method === "POST") return response({ session_id: "session-1", status: "ready", messages: [] });
    if (url.endsWith("/api/v1/chat/sessions/session-1/messages")) {
      return response({ message: { message_id: "assistant-1", role: "assistant", content: "The record is at elevated risk.", evidence: [{ kind: "customer_record", content: "Contract is month-to-month." }, { kind: "model_output", content: "Risk score is 83%." }, { kind: "calculated_priority", content: "Priority uses the campaign formula." }, { kind: "ai_suggestion", content: "Consider a contract review." }] } });
    }
    return response({ code: "not_found", detail: "not found" }, 404);
  }));
});

describe("chat browser journey", () => {
  it("keeps explicit customer context and labels grounded answer sections", async () => {
    const user = userEvent.setup();
    renderPath("/chat?customerId=CTX-001");

    expect(await screen.findByRole("heading", { name: "Assistant chat" })).toBeVisible();
    expect(screen.getByText("Customer CTX-001")).toBeVisible();
    await user.type(screen.getByLabelText("Message the assistant"), "What should I review?");
    await user.click(screen.getByRole("button", { name: "Send message" }));

    expect(await screen.findByText("The record is at elevated risk.")).toBeVisible();
    const sources = screen.getByLabelText("Answer sources");
    expect(within(sources).getByText("Customer record")).toBeVisible();
    expect(within(sources).getByText("Model output")).toBeVisible();
    expect(within(sources).getByText("Calculated priority")).toBeVisible();
    expect(within(sources).getByText("AI suggestion")).toBeVisible();
    expect(fetch).toHaveBeenCalledWith(expect.stringMatching(/\/api\/v1\/chat\/sessions$/), expect.objectContaining({ body: JSON.stringify({ customer_id: "CTX-001" }) }));
  });

  it("requires a one-time token and sends explicit confirmation headers", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/health/ready")) return response({ ready: true });
      if (url.endsWith("/api/v1/chat/sessions") && init?.method === "POST") return response({ session_id: "session-1", status: "ready", messages: [] });
      if (url.endsWith("/messages")) return response({ message: { message_id: "assistant-2", role: "assistant", content: "I prepared a customer preview.", staged_action: { action_id: "action-1", action: "create", confirmation_token: "token-1", preview: { normalized_customer: { customer_id: "NEW-1", contract: "One year" } }, prediction: { risk_score: 0.55 } } } });
      if (url.endsWith("/confirm")) return response({ status: "confirmed", message: "Customer saved." });
      return response({ code: "not_found" }, 404);
    });
    vi.stubGlobal("fetch", fetchMock);
    renderPath("/chat");
    await screen.findByRole("heading", { name: "Assistant chat" });
    await user.type(screen.getByLabelText("Message the assistant"), "Create this customer");
    await user.click(screen.getByRole("button", { name: "Send message" }));
    expect(await screen.findByRole("heading", { name: "Review new customer" })).toBeVisible();
    expect(screen.getByText("Customer ID")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Confirm once" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringMatching(/\/staged-actions\/action-1\/confirm$/), expect.objectContaining({ headers: expect.objectContaining({ "Idempotency-Key": expect.any(String) }), body: JSON.stringify({ confirmation_token: "token-1" }) })));
    const confirmation = await screen.findByRole("article", { name: "System message" });
    expect(within(confirmation).getByText("Customer saved.")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Confirm once" })).not.toBeInTheDocument();
  });

  it("shows a safe unavailable state without leaking provider details", async () => {
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/health/ready")) return response({ ready: true });
      if (url.endsWith("/api/v1/chat/sessions")) return response({ code: "ai_unavailable", detail: "secret provider stack trace" }, 503);
      return response({}, 404);
    }));
    renderPath("/chat");
    expect(await screen.findByRole("alert")).toHaveTextContent("Assistant unavailable");
    expect(screen.queryByText("secret provider stack trace")).not.toBeInTheDocument();
  });

  it("cancels a staged preview with its one-time token", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/health/ready")) return response({ ready: true });
      if (url.endsWith("/api/v1/chat/sessions") && init?.method === "POST") return response({ session_id: "session-1", status: "ready", messages: [] });
      if (url.endsWith("/messages")) return response({ message: { message_id: "assistant-3", role: "assistant", content: "Preview ready." }, staged_actions: [{ action_id: "action-2", action: "update", customer_id: "CUST-1", confirmation_token: "token-2", normalized_customer: { customer_id: "CUST-1", contract: "One year" }, prediction: { risk_score: 0.4 } }] });
      if (url.endsWith("/cancel")) return response({ action_id: "action-2", status: "cancelled" });
      return response({ code: "not_found" }, 404);
    });
    vi.stubGlobal("fetch", fetchMock);
    renderPath("/chat");
    await screen.findByRole("heading", { name: "Assistant chat" });
    await user.type(screen.getByLabelText("Message the assistant"), "Prepare an update");
    await user.click(screen.getByRole("button", { name: "Send message" }));
    expect(await screen.findByRole("heading", { name: "Review customer update" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Cancel preview" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringMatching(/\/staged-actions\/action-2\/cancel$/), expect.objectContaining({ body: JSON.stringify({ confirmation_token: "token-2" }) })));
    const cancellation = await screen.findByRole("article", { name: "System message" });
    expect(within(cancellation).getByText("Preview cancelled. No customer record was changed.")).toBeVisible();
  });
});
