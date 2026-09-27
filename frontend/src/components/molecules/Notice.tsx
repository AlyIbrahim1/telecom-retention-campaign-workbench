import type { ReactNode } from "react";
import { Icon, type IconName } from "../atoms/Icon";

export type Tone = "info" | "success" | "warning" | "danger" | "neutral";

const TONE_ICON: Record<Tone, IconName> = {
  info: "info",
  success: "check",
  warning: "alert",
  danger: "alert",
  neutral: "info",
};

export function Notice({
  tone = "info",
  title,
  children,
  actions,
  role,
  className,
  id,
}: {
  tone?: Tone;
  title?: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  role?: "status" | "alert";
  className?: string;
  id?: string;
}) {
  return (
    <div id={id} className={`notice notice-${tone}${className ? ` ${className}` : ""}`} role={role}>
      <Icon name={TONE_ICON[tone]} className="notice-icon" />
      <div className="notice-body">
        {title && <strong className="notice-title">{title}</strong>}
        {children && <div className="notice-text">{children}</div>}
        {actions && <div className="notice-actions">{actions}</div>}
      </div>
    </div>
  );
}
