import type { ReactNode } from "react";
import { Icon, type IconName } from "../atoms/Icon";
import { Breadcrumbs, type Crumb } from "../molecules/Breadcrumbs";

export function StateScreen({
  icon = "info",
  eyebrow,
  title,
  titleId,
  message,
  alert = false,
  actions,
  children,
  crumbs,
}: {
  icon?: IconName;
  eyebrow?: string;
  title: string;
  titleId: string;
  message?: ReactNode;
  alert?: boolean;
  actions?: ReactNode;
  children?: ReactNode;
  crumbs?: Crumb[];
}) {
  return (
    <section className="state-screen" aria-labelledby={titleId}>
      {crumbs && <Breadcrumbs items={crumbs} />}
      <div className="state-screen-card">
        <span className={`state-screen-icon${alert ? " state-screen-icon-alert" : ""}`}><Icon name={icon} size={28} /></span>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1 id={titleId}>{title}</h1>
        {message && (alert ? <div role="alert" className="state-screen-message">{message}</div> : <div className="state-screen-message">{message}</div>)}
        {children}
        {actions && <div className="button-row button-row-center">{actions}</div>}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Pagination                                                          */
/* ------------------------------------------------------------------ */
