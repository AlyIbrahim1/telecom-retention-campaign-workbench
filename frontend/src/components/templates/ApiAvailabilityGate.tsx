import { useQuery } from "@tanstack/react-query";
import { Outlet } from "react-router-dom";

import { fetchReadiness } from "../../api/health";
import { Icon, StateScreen } from "../index";

export function ApiAvailabilityGate() {
  const readiness = useQuery({
    queryKey: ["api-readiness"],
    queryFn: fetchReadiness,
    retry: false,
  });

  if (readiness.isPending) {
    return (
      <StateScreen icon="refresh" eyebrow="Connecting" title="Preparing the workspace" titleId="loading-title">
        <p className="state-screen-message loading-label" role="status" aria-live="polite">
          <span className="spinner" aria-hidden="true" />
          Connecting to customer and campaign services…
        </p>
      </StateScreen>
    );
  }

  if (readiness.isError) {
    return (
      <StateScreen
        icon="wifiOff"
        alert
        eyebrow="Connection needed"
        title="Workspace unavailable"
        titleId="unavailable-title"
        message={<p>Customer and campaign services are not responding. Check that the API and database are running, then try again.</p>}
        actions={
          <button type="button" onClick={() => readiness.refetch()} disabled={readiness.isFetching}>
            <Icon name="refresh" size={18} />
            {readiness.isFetching ? "Checking…" : "Try again"}
          </button>
        }
      >
        <ul className="state-checklist" aria-label="Things to check">
          <li><code>make start</code> is running the API and PostgreSQL</li>
          <li><code>make migrate</code> has applied the database migrations</li>
          <li>The API health check at <code>/health/ready</code> reports ready</li>
        </ul>
      </StateScreen>
    );
  }

  return <Outlet />;
}
