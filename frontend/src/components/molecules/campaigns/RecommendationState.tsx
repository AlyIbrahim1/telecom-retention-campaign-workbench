import type { CampaignRecommendation } from "../../../api/campaigns";
import { Badge } from "../../atoms/Badge";

export function RecommendationState({ recommendation }: { recommendation: CampaignRecommendation }) {
  if (recommendation.selection_state === "excluded") return <Badge tone="warning" icon="×">Excluded by user</Badge>;
  if (recommendation.selection_state === "override" || recommendation.override) return <Badge tone="brand" icon="◆">Override</Badge>;
  if (recommendation.selected) return <Badge tone="success" icon="✓">Selected for outreach</Badge>;
  if (recommendation.recommended) return <Badge tone="info" icon="◆">Recommended</Badge>;
  return <Badge tone="neutral" icon="○">Not recommended</Badge>;
}
