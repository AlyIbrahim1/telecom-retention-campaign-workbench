import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";

import type { ChatContext } from "../../api/chat";

type OpenRequest = { context: ChatContext; nonce: number } | null;

type AssistantState = {
  open: boolean;
  /** Last explicit "ask about this record" request; the panel adopts it once. */
  request: OpenRequest;
  openAssistant: (context?: ChatContext) => void;
  closeAssistant: () => void;
  toggleAssistant: () => void;
  toggleRef: React.RefObject<HTMLButtonElement | null>;
};

const AssistantStateContext = createContext<AssistantState | null>(null);

export function AssistantProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [request, setRequest] = useState<OpenRequest>(null);
  const toggleRef = useRef<HTMLButtonElement | null>(null);

  const openAssistant = useCallback((context?: ChatContext) => {
    if (context) setRequest((current) => ({ context, nonce: (current?.nonce ?? 0) + 1 }));
    setOpen(true);
  }, []);

  const closeAssistant = useCallback(() => {
    setOpen(false);
    // Return focus to the control that opened the panel.
    window.setTimeout(() => toggleRef.current?.focus(), 0);
  }, []);

  const toggleAssistant = useCallback(() => {
    setOpen((current) => !current);
  }, []);

  const value = useMemo(
    () => ({ open, request, openAssistant, closeAssistant, toggleAssistant, toggleRef }),
    [open, request, openAssistant, closeAssistant, toggleAssistant],
  );
  return <AssistantStateContext.Provider value={value}>{children}</AssistantStateContext.Provider>;
}

export function useAssistant(): AssistantState {
  const value = useContext(AssistantStateContext);
  if (!value) throw new Error("useAssistant must be used inside AssistantProvider");
  return value;
}

export function contextKey(context: ChatContext): string {
  return `${context.customer_id ?? ""}:${context.campaign_id ?? ""}`;
}
