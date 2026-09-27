import type { Campaign } from "../../../api/campaigns";
import { Icon } from "../../atoms/Icon";
import { proposedCampaignSelectionCount } from "../../../features/campaigns/selection";

export function CampaignCapacityMeter({ campaign, compact = false }: { campaign: Campaign; compact?: boolean }) {
  const proposed = proposedCampaignSelectionCount(campaign);
  const humanConfirmed = campaign.status === "confirmed" || campaign.status === "archived";
  const raw = Math.max(0, humanConfirmed ? campaign.selected_count : proposed);
  const used = Math.min(campaign.capacity, raw);
  const percent = campaign.capacity ? Math.round((used / campaign.capacity) * 100) : 0;
  const unused = Math.max(0, campaign.capacity - used);
  const over = raw > campaign.capacity;
  if (compact) {
    return (
      <span className="capacity-compact">
        <span className="capacity-compact-top"><strong>{used}</strong> / {campaign.capacity}<span className="cell-note">{humanConfirmed ? "selected" : campaign.status === "draft" ? "not optimized" : "proposed"}</span></span>
        <span className="capacity-track" role="progressbar" aria-label={`Campaign capacity ${used} of ${campaign.capacity} ${humanConfirmed ? "selected" : "proposed"}`} aria-valuemin={0} aria-valuemax={campaign.capacity} aria-valuenow={used}>
          <span className={humanConfirmed ? "capacity-fill capacity-fill-confirmed" : "capacity-fill"} style={{ width: `${percent}%` }} />
        </span>
      </span>
    );
  }
  return (
    <section className="panel capacity-meter" aria-labelledby="capacity-meter-title">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">{humanConfirmed ? "Human selection" : "Proposed list"}</p>
          <h2 id="capacity-meter-title">Capacity</h2>
        </div>
        <strong className="capacity-figure">{used}<span> / {campaign.capacity}</span></strong>
      </div>
      <div className="capacity-track capacity-track-lg" role="progressbar" aria-label={`Campaign capacity ${used} of ${campaign.capacity} ${humanConfirmed ? "selected" : "proposed"}`} aria-valuemin={0} aria-valuemax={campaign.capacity} aria-valuenow={used}>
        <span className={humanConfirmed ? "capacity-fill capacity-fill-confirmed" : "capacity-fill"} style={{ width: `${percent}%` }} />
      </div>
      <dl className="capacity-stats">
        <div><dt>{humanConfirmed ? "Selected" : "Proposed"}</dt><dd>{raw.toLocaleString()}</dd></div>
        <div><dt>Unused</dt><dd>{unused.toLocaleString()}</dd></div>
        <div><dt>Eligible</dt><dd>{campaign.eligible_count.toLocaleString()}</dd></div>
        <div><dt>Recommended</dt><dd>{campaign.recommended_count.toLocaleString()}</dd></div>
      </dl>
      {over && <p className="field-error"><Icon name="alert" size={14} />Selection is above capacity. Exclude or replace a customer before confirming.</p>}
    </section>
  );
}
