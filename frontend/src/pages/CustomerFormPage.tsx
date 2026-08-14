import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import {
  ApiError,
  createCustomer,
  getCustomer,
  previewCustomer,
  previewCustomerUpdate,
  updateCustomer,
  type CustomerInput,
  type CustomerPreview,
} from "../api/customers";
import { ErrorState, ModelScore, WarningList } from "../features/customers/CustomerBits";
import {
  DEFAULT_CUSTOMER,
  FIELD_LABELS,
  GROUPS,
  OPTIONS,
  payloadFromValues,
  valuesFromCustomer,
  type FormField,
  type FormValues,
} from "../features/customers/constants";

type FormMode = "create" | "update";

const INTERNET_ADD_ON_FIELDS: FormField[] = [
  "online_security",
  "online_backup",
  "device_protection",
  "tech_support",
  "streaming_tv",
  "streaming_movies",
];

function clientValidation(values: FormValues): Record<string, string> {
  const errors: Record<string, string> = {};
  const required: FormField[] = [
    "customer_id", "gender", "senior_citizen", "partner", "dependents", "tenure", "phone_service",
    "multiple_lines", "internet_service", "online_security", "online_backup", "device_protection",
    "tech_support", "streaming_tv", "streaming_movies", "contract", "paperless_billing", "payment_method",
    "monthly_charges", "total_charges",
  ];
  required.forEach((field) => {
    if (!values[field].trim()) errors[field] = "This field is required.";
  });
  if (values.customer_id && !/^[A-Za-z0-9_-]{1,64}$/.test(values.customer_id.trim())) {
    errors.customer_id = "Use 1–64 letters, numbers, underscores, or hyphens.";
  }
  if (values.tenure && (!/^\d+$/.test(values.tenure) || Number(values.tenure) < 0)) {
    errors.tenure = "Enter a whole number of months.";
  }
  ["monthly_charges", "total_charges"].forEach((field) => {
    const value = values[field as "monthly_charges" | "total_charges"];
    if (value && (!Number.isFinite(Number(value)) || Number(value) < 0)) errors[field] = "Enter a non-negative number.";
  });
  if (Number(values.tenure) > 0 && Number(values.total_charges) <= 0) {
    errors.total_charges = "Total charges must be greater than zero when tenure is positive.";
  }
  if (values.phone_service === "No" && values.multiple_lines !== "No phone service") {
    errors.multiple_lines = "Choose No phone service when phone service is No.";
  }
  if (values.phone_service === "Yes" && values.multiple_lines === "No phone service") {
    errors.multiple_lines = "Choose Yes or No when phone service is available.";
  }
  if (values.internet_service === "No" && INTERNET_ADD_ON_FIELDS.some((field) => values[field] !== "No internet service")) {
    errors.internet_service = "Internet add-ons must be No internet service when internet service is No.";
  }
  if (values.internet_service !== "No" && INTERNET_ADD_ON_FIELDS.some((field) => values[field] === "No internet service")) {
    errors.internet_service = "Choose Yes or No for add-ons when internet service is present.";
  }
  return errors;
}

function userMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return "Customer services could not be reached. Check the application services and try again.";
  if (error.status === 0) return "Customer services could not be reached. Check the application services and try again.";
  if (error.status === 503 && error.problem.code === "service_unavailable") {
    return "The API or database is not ready. No customer changes were saved; try again shortly.";
  }
  if (error.problem.code === "prediction_failed" || error.problem.code === "model_unavailable") {
    return "The model could not score this record. No customer changes were saved.";
  }
  if (error.problem.code === "customer_version_conflict") {
    return "This customer changed in another tab. Reload the latest record, review your edits, and try again.";
  }
  if (error.problem.code === "duplicate_customer_id") {
    return "That customer ID already exists. Create does not switch to update automatically; open the explicit update page instead.";
  }
  return error.message || "The request could not be completed. Your entered values are still here.";
}

function idempotencyKey(): string {
  return typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `customer-write-${Date.now()}`;
}

export function CustomerFormPage({ mode }: { mode: FormMode }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { customerId } = useParams<{ customerId: string }>();
  const updateQuery = useQuery({
    queryKey: ["customer", customerId],
    queryFn: () => getCustomer(customerId ?? ""),
    enabled: mode === "update" && Boolean(customerId),
  });
  const [values, setValues] = useState<FormValues>(DEFAULT_CUSTOMER);
  const [initialCustomer, setInitialCustomer] = useState<CustomerInput | null>(null);
  const [preview, setPreview] = useState<CustomerPreview | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState("");
  const [duplicateId, setDuplicateId] = useState<string | null>(null);
  const [busy, setBusy] = useState<"preview" | "persist" | null>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
  const didLoad = useRef(false);

  useEffect(() => {
    if (mode === "update" && updateQuery.data?.customer && !didLoad.current) {
      setValues(valuesFromCustomer(updateQuery.data.customer));
      setInitialCustomer(updateQuery.data.customer);
      didLoad.current = true;
    }
  }, [mode, updateQuery.data]);

  function focusErrors(nextErrors: Record<string, string>) {
    setErrors(nextErrors);
    window.setTimeout(() => summaryRef.current?.focus(), 0);
  }

  function handleChange(field: FormField, value: string) {
    setValues((current) => {
      const next = { ...current, [field]: value };
      if (field === "phone_service") {
        if (value === "No") next.multiple_lines = "No phone service";
        else if (current.multiple_lines === "No phone service") next.multiple_lines = "No";
      }
      if (field === "internet_service") {
        INTERNET_ADD_ON_FIELDS.forEach((addOn) => {
          if (value === "No") next[addOn] = "No internet service";
          else if (current[addOn] === "No internet service") next[addOn] = "No";
        });
      }
      return next;
    });
    setPreview(null);
    setSubmitError("");
    setDuplicateId(null);
    setErrors((current) => {
      const next = { ...current, [field]: "" };
      if (field === "phone_service") next.multiple_lines = "";
      if (field === "internet_service") INTERNET_ADD_ON_FIELDS.forEach((addOn) => { next[addOn] = ""; });
      return next;
    });
  }

  function applyConsistentValues() {
    setValues((current) => {
      const next = { ...current };
      if (next.phone_service === "No") {
        next.multiple_lines = "No phone service";
      } else if (next.multiple_lines === "No phone service") {
        next.multiple_lines = "No";
      }
      INTERNET_ADD_ON_FIELDS.forEach((addOn) => {
        if (next.internet_service === "No") {
          next[addOn] = "No internet service";
        } else if (next[addOn] === "No internet service") {
          next[addOn] = "No";
        }
      });
      return next;
    });
    setErrors({});
    setSubmitError("");
    setPreview(null);
  }

  async function handlePreview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors = clientValidation(values);
    if (Object.values(nextErrors).some(Boolean)) {
      focusErrors(nextErrors);
      return;
    }
    setErrors({});
    setSubmitError("");
    setDuplicateId(null);
    setBusy("preview");
    try {
      const payload = payloadFromValues(values);
      const result = mode === "create"
        ? await previewCustomer(payload)
        : await previewCustomerUpdate(customerId ?? "", payload);
      setPreview(result);
    } catch (error) {
      if (error instanceof ApiError && error.problem.errors?.length) {
        const next = Object.fromEntries(error.problem.errors.map((item) => [item.field ?? "customer", item.message]));
        focusErrors(next);
      } else {
        setSubmitError(userMessage(error));
      }
    } finally {
      setBusy(null);
    }
  }

  async function handlePersist() {
    if (!preview) {
      setSubmitError("Preview this record before saving it.");
      return;
    }
    setBusy("persist");
    setSubmitError("");
    setDuplicateId(null);
    try {
      const payload = preview.normalized_customer;
      const result = mode === "create"
        ? await createCustomer(payload, idempotencyKey())
        : await updateCustomer(customerId ?? payload.customer_id, payload, updateQuery.data?.version ?? 0, idempotencyKey());
      const normalizedId = result.customer.customer.customer_id;
      await queryClient.invalidateQueries({ queryKey: ["customer", normalizedId] });
      await queryClient.invalidateQueries({ queryKey: ["customers"] });
      navigate(`/customers/${encodeURIComponent(normalizedId)}`, {
        state: { message: mode === "create" ? "Customer created and scored." : "Customer updated and re-scored." },
      });
    } catch (error) {
      if (error instanceof ApiError && error.problem.errors?.length) {
        const next = Object.fromEntries(error.problem.errors.map((item) => [item.field ?? "customer", item.message]));
        focusErrors(next);
      } else {
        if (error instanceof ApiError && error.problem.code === "duplicate_customer_id") {
          setDuplicateId(preview.normalized_customer.customer_id);
        }
        setSubmitError(userMessage(error));
      }
    } finally {
      setBusy(null);
    }
  }

  if (mode === "update" && updateQuery.isPending) {
    return <section className="page-stack" aria-labelledby="update-title"><PageHeader mode={mode} /><div className="loading-panel" role="status">Loading the current customer values…</div></section>;
  }
  if (mode === "update" && (updateQuery.isError || !updateQuery.data?.customer)) {
    return <ErrorState title="Update customer" message={updateQuery.isError && updateQuery.error instanceof ApiError && updateQuery.error.status === 404 ? "That customer could not be found." : "The current customer could not be loaded."} onRetry={() => updateQuery.refetch()} />;
  }

  const changedFields = initialCustomer
    ? (Object.keys(DEFAULT_CUSTOMER) as FormField[]).filter((field) => String(initialCustomer[field]) !== values[field])
    : [];
  const dependencyConflict =
    (values.phone_service === "No" && values.multiple_lines !== "No phone service") ||
    (values.phone_service === "Yes" && values.multiple_lines === "No phone service") ||
    (values.internet_service === "No" && INTERNET_ADD_ON_FIELDS.some((field) => values[field] !== "No internet service")) ||
    (values.internet_service !== "No" && INTERNET_ADD_ON_FIELDS.some((field) => values[field] === "No internet service"));
  const showConsistencyAction = dependencyConflict &&
    (Object.values(errors).some(Boolean) || Boolean(submitError));

  return (
    <section
      className="page-stack form-page"
      aria-labelledby={mode === "create" ? "new-title" : "update-title"}
    >
      <PageHeader mode={mode} customerId={customerId} />
      {mode === "update" && <div className="info-panel"><strong>Explicit update</strong><span>This action re-scores the customer and appends a new immutable prediction. Current version: {updateQuery.data?.version}.</span></div>}
      <div ref={summaryRef} className={`form-summary ${Object.values(errors).some(Boolean) || submitError ? "form-summary-visible" : ""}`} tabIndex={-1} role="alert" aria-live="assertive">
        {Object.values(errors).some(Boolean) && <><strong>Review these fields</strong><ul>{Object.entries(errors).filter(([, message]) => message).map(([field, message]) => <li key={field}><a href={`#${field}`}>{FIELD_LABELS[field as FormField] ?? field}: {message}</a></li>)}</ul></>}
        {showConsistencyAction && <button type="button" className="button-secondary" onClick={applyConsistentValues}>Apply consistent values</button>}
        {submitError && <p>{submitError}{duplicateId && mode === "create" && <> <Link to={`/customers/${encodeURIComponent(duplicateId)}/edit`}>Open the explicit update page.</Link></>}</p>}
      </div>
      <form onSubmit={handlePreview} noValidate aria-busy={busy !== null}>
        <div className="form-groups">
          {GROUPS.map((group) => (
            <fieldset className="form-group" key={group.title}>
              <legend>{group.title}</legend>
              <p>{group.description}</p>
              <div className="field-grid">
                {group.fields.map((field) => {
                  const options = OPTIONS[field];
                  const isNumber = field === "tenure" || field === "monthly_charges" || field === "total_charges";
                  const isDependencyDisabled =
                    (field === "multiple_lines" && values.phone_service === "No") ||
                    (INTERNET_ADD_ON_FIELDS.includes(field) && values.internet_service === "No");
                  const dependencyHint = field === "multiple_lines"
                    ? "Unavailable without phone service."
                    : "Unavailable without internet service.";
                  const describedBy = [
                    errors[field] ? `${field}-error` : "",
                    isDependencyDisabled ? `${field}-disabled-hint` : "",
                  ].filter(Boolean).join(" ") || undefined;
                  return (
                    <label className={`form-field${isDependencyDisabled ? " form-field-disabled" : ""}`} key={field} htmlFor={field}>
                      <span>{FIELD_LABELS[field]} <span aria-hidden="true">*</span></span>
                      {options ? (
                        <select id={field} aria-label={FIELD_LABELS[field]} value={values[field]} disabled={isDependencyDisabled} aria-invalid={Boolean(errors[field])} aria-describedby={describedBy} onChange={(event) => handleChange(field, event.target.value)}>
                          {options.map((option) => <option key={option} value={option}>{option}</option>)}
                        </select>
                      ) : (
                        <input id={field} aria-label={FIELD_LABELS[field]} type={isNumber ? "number" : "text"} inputMode={field === "tenure" ? "numeric" : isNumber ? "decimal" : undefined} min={isNumber ? 0 : undefined} step={field === "tenure" ? 1 : "any"} value={values[field]} readOnly={mode === "update" && field === "customer_id"} aria-invalid={Boolean(errors[field])} aria-describedby={errors[field] ? `${field}-error` : undefined} onChange={(event) => handleChange(field, event.target.value)} />
                      )}
                      {isDependencyDisabled && <small id={`${field}-disabled-hint`} className="field-hint">{dependencyHint}</small>}
                      {errors[field] && <small id={`${field}-error`} className="field-error">{errors[field]}</small>}
                    </label>
                  );
                })}
              </div>
            </fieldset>
          ))}
        </div>
        <div className="form-actions">
          <button type="submit" disabled={busy !== null}>{busy === "preview" ? "Preparing preview…" : "Preview model score"}</button>
          <Link className="button-link button-secondary" to={mode === "update" ? `/customers/${encodeURIComponent(customerId ?? "")}` : "/customers"}>Cancel</Link>
        </div>
      </form>

      {preview && (
        <section className="preview-panel" aria-labelledby="preview-title">
          <div className="preview-heading">
            <div><p className="eyebrow">No data saved yet</p><h2 id="preview-title">Review prediction before {mode === "create" ? "creating" : "saving"}</h2></div>
            <ModelScore prediction={preview.prediction} />
          </div>
          <p className="model-explanation"><strong>About this score.</strong> It is a ranking signal, not a guaranteed probability. The current review threshold is {Math.round(preview.prediction.threshold * 100)}%.</p>
          <RecommendationStatusLine recommended={preview.prediction.recommended_for_review} />
          <WarningList warnings={preview.warnings} />
          <details className="normalized-details">
            <summary>View normalized account values</summary>
            <dl>{(Object.keys(DEFAULT_CUSTOMER) as FormField[]).map((field) => <div key={field}><dt>{FIELD_LABELS[field]}</dt><dd>{String(preview.normalized_customer[field])}</dd></div>)}</dl>
          </details>
          {mode === "update" && <div className="change-summary"><strong>{changedFields.length ? `${changedFields.length} changed field${changedFields.length === 1 ? "" : "s"}` : "No field values changed"}</strong>{changedFields.length > 0 && <ul aria-label="Changed fields">{changedFields.map((field) => <li key={field}>{FIELD_LABELS[field]}</li>)}</ul>}</div>}
          <div className="preview-actions"><button type="button" disabled={busy !== null} onClick={handlePersist}>{busy === "persist" ? "Saving…" : mode === "create" ? "Create customer" : "Save update"}</button><button type="button" className="button-secondary" onClick={() => setPreview(null)} disabled={busy !== null}>Keep editing</button></div>
        </section>
      )}
    </section>
  );
}

function PageHeader({ mode, customerId }: { mode: FormMode; customerId?: string }) {
  return (
    <div className="page-heading">
      <p className="eyebrow">Customer records</p>
      <h1 id={mode === "create" ? "new-title" : "update-title"}>{mode === "create" ? "New customer" : "Update customer"}</h1>
      <p className="page-description">{mode === "create" ? "Enter the account facts, preview the score, then explicitly save the new record." : `Review and re-score ${customerId ?? "this customer"} with the latest account facts.`}</p>
    </div>
  );
}

function RecommendationStatusLine({ recommended }: { recommended: boolean }) {
  return recommended
    ? <p className="recommendation-line"><span aria-hidden="true">●</span> Recommended for review at the current threshold.</p>
    : <p className="recommendation-line recommendation-line-muted"><span aria-hidden="true">○</span> Below the current review threshold.</p>;
}
