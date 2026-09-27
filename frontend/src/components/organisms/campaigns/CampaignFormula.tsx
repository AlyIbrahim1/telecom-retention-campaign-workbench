import type { Campaign } from "../../../api/campaigns";
import { Icon } from "../../atoms/Icon";
import { formatDate } from "../../../utils/customerFormat";

export function CampaignFormula({ campaign }: { campaign: Campaign }) {
  const optimization = campaign.optimization;
  const monthlyWeight = optimization?.monthly_weight ?? 0.6;
  const historicalWeight = optimization?.historical_weight ?? 0.4;
  const formulaVersion = optimization?.formula_version ?? "risk-spend-v1";
  return (
    <section className="panel campaign-formula" aria-labelledby="campaign-formula-title">
      <div className="panel-heading"><div><p className="eyebrow">Explainable ranking</p><h2 id="campaign-formula-title">How priority is calculated</h2></div></div>
      <div className="formula-line" aria-label={`Priority equals 100 times risk score times value index. Value index uses ${monthlyWeight * 100}% monthly spend and ${historicalWeight * 100}% historical spend.`}>
        <span className="formula-term formula-term-result">Priority</span>
        <span className="formula-op">=</span>
        <span className="formula-term">100</span>
        <span className="formula-op">×</span>
        <span className="formula-term">risk score</span>
        <span className="formula-op">×</span>
        <span className="formula-term">value index</span>
      </div>
      <dl className="meta-list">
        <div><dt>Value index</dt><dd>{(monthlyWeight * 100).toFixed(0)}% monthly spend percentile + {(historicalWeight * 100).toFixed(0)}% historical spend percentile</dd></div>
        <div><dt>Formula version</dt><dd>{formulaVersion}</dd></div>
        <div><dt>Population snapshot</dt><dd>{optimization?.reference_population_timestamp ? formatDate(optimization.reference_population_timestamp) : "Created when optimization runs"}</dd></div>
      </dl>
      <p className="decision-note"><Icon name="info" size={16} /><span>Priority is a review aid, not a probability, profit forecast, or automatic outreach decision. Percentiles use all active, valid customer records from one snapshot; equal values receive their average rank.</span></p>
    </section>
  );
}
