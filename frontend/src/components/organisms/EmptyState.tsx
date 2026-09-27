import type { ReactNode } from "react";
import { Icon, type IconName } from "../atoms/Icon";

export function EmptyState({
  icon = "grid",
  eyebrow,
  title,
  children,
  actions,
  compact = false,
}: {
  icon?: IconName;
  eyebrow?: string;
  title: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={`empty-state${compact ? " empty-state-compact" : ""}`}>
      <span className="empty-state-icon"><Icon name={icon} size={compact ? 20 : 26} /></span>
      <div className="empty-state-copy">
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        {compact ? <strong className="empty-state-title">{title}</strong> : <h2>{title}</h2>}
        {children && <div className="empty-state-text">{children}</div>}
        {actions && <div className="button-row">{actions}</div>}
      </div>
    </div>
  );
}

/** Full-page state (connecting, unavailable, not found, record errors). */
