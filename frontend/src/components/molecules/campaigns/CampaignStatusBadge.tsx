import type { CampaignStatus } from "../../../api/campaigns";
import { Badge } from "../../atoms/Badge";
import type { Tone } from "../Notice";

export function campaignStatusTone(status: CampaignStatus): Tone {
  if (status === "confirmed") return "success";
  if (status === "optimized") return "info";
  return "neutral";
}

const STATUS_GLYPH: Record<CampaignStatus, string> = { draft: "○", optimized: "◆", confirmed: "✓", archived: "▪" };

export function CampaignStatusBadge({ status }: { status: CampaignStatus }) {
  const label = status[0].toUpperCase() + status.slice(1);
  return <Badge tone={campaignStatusTone(status)} icon={STATUS_GLYPH[status]}>{label}</Badge>;
}
