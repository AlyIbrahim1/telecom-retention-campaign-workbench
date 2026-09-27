import type { ReactNode } from "react";
import type { Tone } from "../molecules/Notice";

export function Badge({ tone = "neutral", children, icon }: { tone?: Tone | "brand"; children: ReactNode; icon?: string }) {
  return (
    <span className={`badge badge-${tone}`}>
      {icon && <span className="badge-glyph" aria-hidden="true">{icon}</span>}
      {children}
    </span>
  );
}
