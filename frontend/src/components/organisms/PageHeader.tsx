import type { ReactNode } from "react";
import { Breadcrumbs, type Crumb } from "../molecules/Breadcrumbs";

export function PageHeader({
  crumbs = [],
  eyebrow,
  title,
  titleId,
  description,
  actions,
  meta,
}: {
  crumbs?: Crumb[];
  eyebrow?: ReactNode;
  title: ReactNode;
  titleId: string;
  description?: ReactNode;
  actions?: ReactNode;
  meta?: ReactNode;
}) {
  return (
    <header className="page-header">
      <Breadcrumbs items={crumbs} />
      <div className="page-header-main">
        <div className="page-header-copy">
          {eyebrow && <p className="eyebrow">{eyebrow}</p>}
          <h1 id={titleId}>{title}</h1>
          {description && <p className="page-description">{description}</p>}
          {meta && <div className="page-header-meta">{meta}</div>}
        </div>
        {actions && <div className="page-header-actions">{actions}</div>}
      </div>
    </header>
  );
}
