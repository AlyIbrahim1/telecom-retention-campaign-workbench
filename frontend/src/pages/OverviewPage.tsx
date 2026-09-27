import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";

import { getCustomerOverview, getOverview, getPredictionOverview, type Overview } from "../api/overview";
import { EmptyState, Icon, LoadingState, Notice, PageHeader } from "../components/index";
import { OverviewCard } from "../components/organisms/overview/OverviewCard";
import { OverviewKpis } from "../components/organisms/overview/OverviewKpis";
import { ChurnDonut } from "../components/organisms/ChurnDonut";
import { Histogram, InsightTables, MixBars, ShareMeters } from "../components/organisms/CustomerCharts";

const ACTIVITY: Array<{ key: keyof Overview; label: string; to: string }> = [
  { key: "customers_scored", label: "Customers scored", to: "/customers" },
  { key: "campaigns_awaiting_review", label: "Campaigns awaiting review", to: "/campaigns" },
  { key: "confirmed_selections", label: "Confirmed selections", to: "/campaigns" },
  { key: "contacts_recorded", label: "Contacts recorded", to: "/campaigns" },
  { key: "accepted_offers", label: "Accepted offers", to: "/campaigns" },
];

export function OverviewPage() {
  const activity = useQuery({ queryKey: ["workspace-overview"], queryFn: getOverview });
  const insight = useQuery({ queryKey: ["customer-overview"], queryFn: getCustomerOverview });
  const predictions = useQuery({ queryKey: ["prediction-overview"], queryFn: getPredictionOverview });
  const data = insight.data;
  const refreshing = insight.isFetching || activity.isFetching || predictions.isFetching;

  return (
    <section className="page-stack overview-page" aria-labelledby="overview-title">
      <PageHeader
        titleId="overview-title"
        eyebrow="Retention operations"
        title="Overview"
        actions={
          <>
            <button type="button" className="button-ghost" onClick={() => { void insight.refetch(); void activity.refetch(); void predictions.refetch(); }} disabled={refreshing}>
              <Icon name="refresh" size={18} />{refreshing ? "Refreshing…" : "Refresh"}
            </button>
            <Link className="button-link button-secondary" to="/imports/new"><Icon name="upload" size={18} />Import customers</Link>
            <Link className="button-link" to="/campaigns/new"><Icon name="plus" size={18} />New campaign</Link>
          </>
        }
      />

      {insight.isPending ? (
        <div className="panel"><LoadingState label="Loading customer statistics…" rows={4} /></div>
      ) : insight.isError || !data ? (
        <Notice tone="danger" role="alert" title="Customer statistics are unavailable" actions={<button type="button" className="button-small" onClick={() => insight.refetch()}><Icon name="refresh" size={16} />Try again</button>}>
          The rest of the workspace is still available.
        </Notice>
      ) : data.active_customers === 0 ? (
        <div className="panel">
          <EmptyState icon="users" eyebrow="No customers yet" title="Import customers to populate the dashboard" actions={<Link className="button-link" to="/imports/new"><Icon name="upload" size={18} />Import customers</Link>}>
            <p>Charts summarise the active customer records once they exist.</p>
          </EmptyState>
        </div>
      ) : (
        <OverviewKpis data={data} />
      )}

      <section className="activity-strip" aria-labelledby="activity-title">
        <h2 id="activity-title" className="activity-title">Campaign activity</h2>
        {activity.isPending ? (
          <LoadingState label="Loading campaign activity…" rows={1} />
        ) : activity.isError || !activity.data ? (
          <Notice tone="danger" role="alert" title="Campaign activity is unavailable" actions={<button type="button" className="button-small" onClick={() => activity.refetch()}><Icon name="refresh" size={16} />Try again</button>} />
        ) : (
          <ul className="activity-list" aria-label="Workspace record counts">
            {ACTIVITY.map((item) => (
              <li key={item.key}>
                <Link to={item.to}>
                  <span className="activity-label">{item.label}</span>
                  <strong>{activity.data[item.key].toLocaleString("en")}</strong>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {data && data.active_customers > 0 && (
        <div className="dash-grid">
          <OverviewCard title="Churn prediction" subtitle={`Latest model prediction for ${(predictions.data?.scored_customers ?? 0).toLocaleString("en")} scored customers`} id="chart-churn">
            {predictions.isPending ? (
              <LoadingState label="Loading predictions…" rows={3} />
            ) : predictions.isError || !predictions.data ? (
              <Notice tone="danger" role="alert" title="Predictions are unavailable" actions={<button type="button" className="button-small" onClick={() => predictions.refetch()}><Icon name="refresh" size={16} />Try again</button>} />
            ) : predictions.data.scored_customers === 0 ? (
              <EmptyState compact icon="info" title="No scored customers yet"><p>Predictions appear once customers are scored.</p></EmptyState>
            ) : (
              <ChurnDonut data={predictions.data} />
            )}
          </OverviewCard>
          <OverviewCard title="Contract" subtitle="Share of active customers" id="chart-contract">
            <MixBars items={data.by_contract} />
          </OverviewCard>
          <OverviewCard title="Internet service" subtitle="Share of active customers" id="chart-internet">
            <MixBars items={data.by_internet_service} labels={{ No: "No internet" }} />
          </OverviewCard>
          <OverviewCard title="Tenure" subtitle="Customers by months with the company" id="chart-tenure" span={6}>
            <Histogram
              bins={data.tenure_distribution}
              describe={(bin) => `${bin.lower}–${bin.upper} months`}
              xLabel="Tenure (months)"
              xTicks={[0, 12, 24, 36, 48, 60, 72].map((value) => ({ value, label: String(value) }))}
              caption="Number of active customers in each six-month tenure band."
            />
          </OverviewCard>
          <OverviewCard title="Monthly charges" subtitle="Customers by monthly charge, dataset currency units" id="chart-charges" span={6}>
            <Histogram
              bins={data.monthly_charges_distribution}
              describe={(bin) => `${bin.lower}–${bin.upper} per month`}
              xLabel="Monthly charges"
              xTicks={[0, 20, 40, 60, 80, 100, 120].map((value) => ({ value, label: String(value) }))}
              caption="Number of active customers in each band of 10 monthly charge units."
            />
          </OverviewCard>
          <OverviewCard title="Payment method" subtitle="Share of active customers" id="chart-payment">
            <MixBars items={data.by_payment_method} labels={{ "Bank transfer (automatic)": "Bank transfer (auto)", "Credit card (automatic)": "Credit card (auto)" }} />
          </OverviewCard>
          <OverviewCard title="Add-on adoption" subtitle={`Share of ${data.internet_customers.toLocaleString("en")} internet customers`} id="chart-addons">
            <ShareMeters items={data.add_on_adoption} baseLabel="internet customers" />
          </OverviewCard>
          <OverviewCard title="Account profile" subtitle="Share of active customers; multiple lines among phone customers" id="chart-profile">
            <ShareMeters items={data.account_profile} />
          </OverviewCard>
          <div className="dash-span-12">
            <InsightTables data={data} />
          </div>
        </div>
      )}
    </section>
  );
}
