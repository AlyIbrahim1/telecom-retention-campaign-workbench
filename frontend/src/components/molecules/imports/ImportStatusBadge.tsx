import type { ImportStatus } from "../../../api/imports";
import { Badge } from "../../atoms/Badge";
import type { Tone } from "../Notice";

export const ACTIVE_IMPORT_STATUSES: ImportStatus[] = ["uploaded", "validating", "queued", "running"];

export function isImportActive(status: ImportStatus): boolean {
  return ACTIVE_IMPORT_STATUSES.includes(status);
}

export function isImportTerminal(status: ImportStatus): boolean {
  return ["completed", "partially_completed", "failed", "cancelled"].includes(status);
}

export function importStatusLabel(status: ImportStatus): string {
  return status.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

const STATUS_TONE: Record<ImportStatus, { tone: Tone; glyph: string }> = {
  uploaded: { tone: "neutral", glyph: "○" },
  validating: { tone: "info", glyph: "◌" },
  ready: { tone: "info", glyph: "◆" },
  queued: { tone: "info", glyph: "◌" },
  running: { tone: "info", glyph: "◌" },
  completed: { tone: "success", glyph: "✓" },
  partially_completed: { tone: "warning", glyph: "!" },
  failed: { tone: "danger", glyph: "!" },
  cancelled: { tone: "neutral", glyph: "×" },
};

export function ImportStatusBadge({ status }: { status: ImportStatus }) {
  const style = STATUS_TONE[status] ?? { tone: "neutral" as Tone, glyph: "○" };
  return <Badge tone={style.tone} icon={style.glyph}>{importStatusLabel(status)}</Badge>;
}
