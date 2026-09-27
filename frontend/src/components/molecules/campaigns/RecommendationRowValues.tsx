import type { CampaignRecommendation } from "../../../api/campaigns";
import { ScoreMeter } from "../customers/ScoreMeter";
import { formatAmount } from "../../../utils/customerFormat";
import { formatPercent, formatPriority } from "../../../utils/campaignFormat";
import { RecommendationState } from "./RecommendationState";

export function RecommendationRowValues({ recommendation }: { recommendation: CampaignRecommendation }) {
  return (
    <>
      <td data-label="Risk score"><ScoreMeter score={recommendation.risk_score} label="Risk score" /></td>
      <td data-label="Monthly spend" className="num">{formatAmount(recommendation.monthly_charges)}<span className="cell-note">{ordinal(recommendation.monthly_spend_percentile)} percentile</span></td>
      <td data-label="Historical spend" className="num">{formatAmount(recommendation.total_charges)}<span className="cell-note">{ordinal(recommendation.historical_spend_percentile)} percentile</span></td>
      <td data-label="Value index" className="num"><span className="cell-primary">{formatPercent(recommendation.value_index)}</span><span className="cell-note">Spend proxy</span></td>
      <td data-label="Priority" className="num"><strong className="priority-value">{formatPriority(recommendation.priority_score)}</strong></td>
      <td data-label="Recommendation"><RecommendationState recommendation={recommendation} /></td>
    </>
  );
}

function ordinal(fraction: number): string {
  const n = Math.round(fraction * 100);
  const mod100 = n % 100;
  const suffix = mod100 >= 11 && mod100 <= 13 ? "th" : n % 10 === 1 ? "st" : n % 10 === 2 ? "nd" : n % 10 === 3 ? "rd" : "th";
  return `${n}${suffix}`;
}
