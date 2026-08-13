import { useQuery } from "@tanstack/react-query";
import { Outlet } from "react-router-dom";

import { fetchReadiness } from "../api/health";

export function ApiAvailabilityGate() {
  const readiness = useQuery({
    queryKey: ["api-readiness"],
    queryFn: fetchReadiness,
    retry: false,
  });

  if (readiness.isPending) {
    return (
      <section className="system-state" aria-labelledby="loading-title">
        <p className="eyebrow">Connecting</p>
        <h1 id="loading-title">Preparing the workspace</h1>
        <p role="status" aria-live="polite">
          Connecting to customer and campaign services…
        </p>
      </section>
    );
  }

  if (readiness.isError) {
    return (
      <section className="system-state" aria-labelledby="unavailable-title">
        <p className="eyebrow">Connection needed</p>
        <h1 id="unavailable-title">Workspace unavailable</h1>
        <div role="alert">
          <p>Customer and campaign services are not responding. Check the application services, then try again.</p>
        </div>
        <button type="button" onClick={() => readiness.refetch()}>
          Try again
        </button>
      </section>
    );
  }

  return <Outlet />;
}
