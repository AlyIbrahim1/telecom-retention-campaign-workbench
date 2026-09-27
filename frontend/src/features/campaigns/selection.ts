import type { Campaign } from "../../api/campaigns";

export function proposedCampaignCustomerIds(campaign: Campaign): Set<string> {
  const ids = new Set(
    campaign.recommendations
      .filter((item) => (item.recommended || item.selection_state === "override" || item.selected) && item.selection_state !== "excluded")
      .map((item) => item.customer_id),
  );
  const latestOverrides = new Map(campaign.overrides.map((override) => [override.customer_id, override]));
  for (const override of latestOverrides.values()) {
    if (override.action === "exclude") ids.delete(override.customer_id);
    else ids.add(override.customer_id);
  }
  for (const override of latestOverrides.values()) {
    if (override.action === "include" && override.replacement_customer_id) ids.delete(override.replacement_customer_id);
  }
  return ids;
}

export function proposedCampaignSelectionCount(campaign: Campaign): number {
  return campaign.recommendations.length ? proposedCampaignCustomerIds(campaign).size : campaign.recommended_count;
}
