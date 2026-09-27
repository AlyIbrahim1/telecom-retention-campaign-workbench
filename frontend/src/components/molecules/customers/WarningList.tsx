import type { ValidationWarning } from "../../../api/customers";
import { Notice } from "../Notice";

export function WarningList({ warnings, title = "Review before saving" }: { warnings: ValidationWarning[]; title?: string }) {
  if (!warnings.length) return null;
  return (
    <Notice tone="warning" role="status" title={title}>
      <ul>
        {warnings.map((warning) => <li key={`${warning.field}-${warning.message}`}>{warning.message}</li>)}
      </ul>
    </Notice>
  );
}
