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
import { Icon, LoadingState, Notice, PageHeader, ErrorState, ModelScore, RecommendationStatus, WarningList } from "../components/index";
import { CustomerField } from "../components/molecules/customers/CustomerField";

import {
  DEFAULT_CUSTOMER,
  FIELD_LABELS,
  GROUPS,
  INTERNET_ADD_ON_FIELDS,
  payloadFromValues,
  valuesFromCustomer,
  type FormField,
  type FormValues,
} from "../features/customers/constants";

type FormMode = "create" | "update";

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
  const previewRef = useRef<HTMLElement>(null);
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
      window.setTimeout(() => previewRef.current?.focus(), 0);
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
    return <section className="page-stack" aria-labelledby="update-title"><FormHeader mode={mode} customerId={customerId} /><div className="panel"><LoadingState label="Loading the current customer values…" rows={5} /></div></section>;
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
  const hasErrors = Object.values(errors).some(Boolean);
  const step = preview ? 2 : 1;
  const cancelTo = mode === "update" ? `/customers/${encodeURIComponent(customerId ?? "")}` : "/customers";

  return (
    <section
      className="page-stack form-page"
      aria-labelledby={mode === "create" ? "new-title" : "update-title"}
    >
      <FormHeader mode={mode} customerId={customerId} />

      <ol className="stepper" aria-label="Save steps">
        <li className={step === 1 ? "is-current" : "is-done"} aria-current={step === 1 ? "step" : undefined}><span className="stepper-index">1</span><span>Enter account facts</span></li>
        <li className={step === 2 ? "is-current" : undefined} aria-current={step === 2 ? "step" : undefined}><span className="stepper-index">2</span><span>Preview model score</span></li>
        <li><span className="stepper-index">3</span><span>Confirm {mode === "create" ? "create" : "update"}</span></li>
      </ol>

      {mode === "update" && (
        <Notice tone="info" title="Explicit update">
          Saving re-scores this customer and appends a new prediction snapshot; earlier snapshots are kept. Current record version: {updateQuery.data?.version}.
        </Notice>
      )}

      <div ref={summaryRef} className={`form-summary${hasErrors || submitError ? " form-summary-visible" : ""}`} tabIndex={-1} role="alert" aria-live="assertive">
        {hasErrors && <><strong className="form-summary-title"><Icon name="alert" size={18} />Review these fields</strong><ul>{Object.entries(errors).filter(([, message]) => message).map(([field, message]) => <li key={field}><a href={`#${field}`}>{FIELD_LABELS[field as FormField] ?? field}: {message}</a></li>)}</ul></>}
        {showConsistencyAction && <button type="button" className="button-secondary button-small" onClick={applyConsistentValues}>Apply consistent values</button>}
        {submitError && <p>{submitError}{duplicateId && mode === "create" && <> <Link to={`/customers/${encodeURIComponent(duplicateId)}/edit`}>Open the explicit update page.</Link></>}</p>}
      </div>

      <form className="customer-form" onSubmit={handlePreview} noValidate aria-busy={busy !== null}>
        <div className="form-groups">
          {GROUPS.map((group, groupIndex) => (
            <fieldset className="form-group" key={group.title}>
              <legend><span className="form-group-index" aria-hidden="true">{String(groupIndex + 1).padStart(2, "0")}</span>{group.title}</legend>
              <p className="form-group-description">{group.description}</p>
              <div className="field-grid">
                {group.fields.map((field) => <CustomerField key={field} field={field} values={values} error={errors[field]} changed={mode === "update" && changedFields.includes(field)} mode={mode} onChange={handleChange} />)}
              </div>
            </fieldset>
          ))}
        </div>
        <div className="sticky-actions">
          <p className="sticky-actions-note">{preview ? "Preview ready below — nothing is saved until you confirm." : "Previewing scores the values without saving anything."}</p>
          <div className="button-row">
            <Link className="button-link button-secondary" to={cancelTo}>Cancel</Link>
            <button type="submit" disabled={busy !== null}>{busy === "preview" ? <><span className="spinner" aria-hidden="true" />Preparing preview…</> : preview ? "Refresh preview" : "Preview model score"}</button>
          </div>
        </div>
      </form>

      {preview && (
        <section className="panel preview-panel" aria-labelledby="preview-title" ref={previewRef} tabIndex={-1}>
          <div className="preview-grid">
            <div className="preview-score">
              <p className="eyebrow">No data saved yet</p>
              <h2 id="preview-title">Review prediction before {mode === "create" ? "creating" : "saving"}</h2>
              <ModelScore prediction={preview.prediction} size="lg" />
              <RecommendationStatus recommended={preview.prediction.recommended_for_review} />
              <p className="model-explanation">
                <strong>About this score.</strong> It is a ranking signal, not a guaranteed probability. Customers at or above the {Math.round(preview.prediction.threshold * 100)}% review threshold are recommended for review; the threshold marker on the bar shows where that line sits.
              </p>
              <dl className="meta-list">
                <div><dt>Model version</dt><dd>{preview.prediction.model_version}</dd></div>
                <div><dt>Threshold policy</dt><dd>{preview.prediction.threshold_policy_version}</dd></div>
              </dl>
            </div>
            <div className="preview-details">
              <WarningList warnings={preview.warnings} />
              {mode === "update" && (
                <div className="change-summary">
                  <strong>{changedFields.length ? `${changedFields.length} changed field${changedFields.length === 1 ? "" : "s"}` : "No field values changed"}</strong>
                  {changedFields.length > 0 && (
                    <ul aria-label="Changed fields">
                      {changedFields.map((field) => <li key={field}><span>{FIELD_LABELS[field]}</span><span className="change-values">{String(initialCustomer?.[field])} <Icon name="arrowRight" size={14} /> {String(preview.normalized_customer[field])}</span></li>)}
                    </ul>
                  )}
                </div>
              )}
              <details className="disclosure">
                <summary>View normalized account values</summary>
                <dl className="kv-grid">{(Object.keys(DEFAULT_CUSTOMER) as FormField[]).map((field) => <div key={field}><dt>{FIELD_LABELS[field]}</dt><dd>{String(preview.normalized_customer[field])}</dd></div>)}</dl>
              </details>
            </div>
          </div>
          <div className="confirm-bar">
            <p>{mode === "create" ? "Creating saves this customer and its first prediction snapshot." : "Saving replaces the current values and appends a new prediction snapshot."}</p>
            <div className="button-row">
              <button type="button" className="button-secondary" onClick={() => setPreview(null)} disabled={busy !== null}>Keep editing</button>
              <button type="button" disabled={busy !== null} onClick={handlePersist}>{busy === "persist" ? <><span className="spinner" aria-hidden="true" />Saving…</> : mode === "create" ? "Create customer" : "Save update"}</button>
            </div>
          </div>
        </section>
      )}
    </section>
  );
}

function FormHeader({ mode, customerId }: { mode: FormMode; customerId?: string }) {
  const crumbs = mode === "create"
    ? [{ label: "Overview", to: "/" }, { label: "Customers", to: "/customers" }, { label: "New customer" }]
    : [{ label: "Overview", to: "/" }, { label: "Customers", to: "/customers" }, { label: customerId ?? "Customer", to: `/customers/${encodeURIComponent(customerId ?? "")}` }, { label: "Update" }];
  return (
    <PageHeader
      titleId={mode === "create" ? "new-title" : "update-title"}
      crumbs={crumbs}
      eyebrow="Customer records"
      title={mode === "create" ? "New customer" : "Update customer"}
      description={mode === "create" ? "Enter the account facts, preview the model score, then explicitly save the new record." : <>Review and re-score <strong className="record-id">{customerId ?? "this customer"}</strong> with the latest account facts.</>}
    />
  );
}
