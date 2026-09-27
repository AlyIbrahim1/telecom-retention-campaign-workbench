import type { ReactNode } from "react";

export function OverviewCard({ title, subtitle, id, span = 4, children }: { title: string; subtitle?: string; id: string; span?: 4 | 6 | 8 | 12; children: ReactNode }) {
  return (
    <section className={`dash-card dash-span-${span}`} aria-labelledby={id}>
      <header className="dash-card-header">
        <h2 id={id}>{title}</h2>
        {subtitle && <p>{subtitle}</p>}
      </header>
      {children}
    </section>
  );
}
