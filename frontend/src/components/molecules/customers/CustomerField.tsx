import { Icon } from "../../atoms/Icon";
import { FIELD_LABELS, INTERNET_ADD_ON_FIELDS, OPTIONS, type FormField, type FormValues } from "../../../features/customers/constants";

export function CustomerField({ field, values, error, changed, mode, onChange }: {
  field: FormField;
  values: FormValues;
  error?: string;
  changed: boolean;
  mode: "create" | "update";
  onChange: (field: FormField, value: string) => void;
}) {
  const options = OPTIONS[field];
  const isNumber = field === "tenure" || field === "monthly_charges" || field === "total_charges";
  const isDependencyDisabled =
    (field === "multiple_lines" && values.phone_service === "No") ||
    (INTERNET_ADD_ON_FIELDS.includes(field) && values.internet_service === "No");
  const dependencyHint = field === "multiple_lines"
    ? "Unavailable without phone service."
    : "Unavailable without internet service.";
  const describedBy = [
    error ? `${field}-error` : "",
    isDependencyDisabled ? `${field}-disabled-hint` : "",
  ].filter(Boolean).join(" ") || undefined;
  return (
    <label className={`field${isDependencyDisabled ? " form-field-disabled" : ""}${error ? " field-invalid" : ""}${changed ? " field-changed" : ""}`} htmlFor={field}>
      <span className="field-label">{FIELD_LABELS[field]} <span className="field-required" aria-hidden="true">*</span>{changed && <span className="field-flag">Changed</span>}</span>
      {options ? (
        <select id={field} aria-label={FIELD_LABELS[field]} value={values[field]} disabled={isDependencyDisabled} aria-invalid={Boolean(error)} aria-describedby={describedBy} onChange={(event) => onChange(field, event.target.value)}>
          {options.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      ) : (
        <input id={field} aria-label={FIELD_LABELS[field]} type={isNumber ? "number" : "text"} inputMode={field === "tenure" ? "numeric" : isNumber ? "decimal" : undefined} min={isNumber ? 0 : undefined} step={field === "tenure" ? 1 : "any"} value={values[field]} readOnly={mode === "update" && field === "customer_id"} autoComplete="off" spellCheck={false} aria-invalid={Boolean(error)} aria-describedby={error ? `${field}-error` : undefined} onChange={(event) => onChange(field, event.target.value)} />
      )}
      {isDependencyDisabled && <small id={`${field}-disabled-hint`} className="field-hint">{dependencyHint}</small>}
      {error && <small id={`${field}-error`} className="field-error"><Icon name="alert" size={14} />{error}</small>}
    </label>
  );
}
