import { useEffect } from "react";
import { Navigate, useSearchParams } from "react-router-dom";

import { useAssistant } from "../features/chat/AssistantContext";

/**
 * The assistant now lives in a side panel. `/chat` stays as a deep link:
 * it opens the panel with any customer or campaign context and moves to the
 * matching record page (or the overview).
 */
export function ChatPage() {
  const [searchParams] = useSearchParams();
  const { openAssistant } = useAssistant();
  const customerId = searchParams.get("customerId") ?? searchParams.get("customer_id") ?? undefined;
  const campaignId = searchParams.get("campaignId") ?? searchParams.get("campaign_id") ?? undefined;

  useEffect(() => {
    openAssistant({
      ...(customerId ? { customer_id: customerId } : {}),
      ...(campaignId ? { campaign_id: campaignId } : {}),
    });
  }, [openAssistant, customerId, campaignId]);

  const target = customerId
    ? `/customers/${encodeURIComponent(customerId)}`
    : campaignId
      ? `/campaigns/${encodeURIComponent(campaignId)}`
      : "/";
  return <Navigate to={target} replace />;
}
