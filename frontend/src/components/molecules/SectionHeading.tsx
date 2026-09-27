import type { ReactNode } from "react";

export function SectionHeading({
  eyebrow,
  title,
  id,
  children,
  actions,
  level = 2,
}: {
  eyebrow?: string;
  title: ReactNode;
  id?: string;
  children?: ReactNode;
  actions?: ReactNode;
  level?: 2 | 3;
}) {
  const Heading = level === 2 ? "h2" : "h3";
  return (
    <div className="section-heading">
      <div className="section-heading-copy">
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <Heading id={id}>{title}</Heading>
        {children && <div className="section-heading-text">{children}</div>}
      </div>
      {actions && <div className="section-heading-actions">{actions}</div>}
    </div>
  );
}
