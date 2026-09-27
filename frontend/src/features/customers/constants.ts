import type { CustomerInput } from "../../api/customers";

export type FormField = keyof CustomerInput;
export type FormValues = Record<FormField, string>;

export const INTERNET_ADD_ON_FIELDS: FormField[] = [
  "online_security",
  "online_backup",
  "device_protection",
  "tech_support",
  "streaming_tv",
  "streaming_movies",
];

export const DEFAULT_CUSTOMER: FormValues = {
  customer_id: "",
  gender: "Female",
  senior_citizen: "No",
  partner: "No",
  dependents: "No",
  tenure: "",
  phone_service: "Yes",
  multiple_lines: "No",
  internet_service: "DSL",
  online_security: "No",
  online_backup: "No",
  device_protection: "No",
  tech_support: "No",
  streaming_tv: "No",
  streaming_movies: "No",
  contract: "Month-to-month",
  paperless_billing: "No",
  payment_method: "Mailed check",
  monthly_charges: "",
  total_charges: "",
};

export const FIELD_LABELS: Record<FormField, string> = {
  customer_id: "Customer ID",
  gender: "Gender",
  senior_citizen: "Senior citizen",
  partner: "Partner",
  dependents: "Dependents",
  tenure: "Tenure (months)",
  phone_service: "Phone service",
  multiple_lines: "Multiple lines",
  internet_service: "Internet service",
  online_security: "Online security",
  online_backup: "Online backup",
  device_protection: "Device protection",
  tech_support: "Tech support",
  streaming_tv: "Streaming TV",
  streaming_movies: "Streaming movies",
  contract: "Contract",
  paperless_billing: "Paperless billing",
  payment_method: "Payment method",
  monthly_charges: "Monthly charges",
  total_charges: "Total charges",
};

export const OPTIONS: Partial<Record<FormField, string[]>> = {
  gender: ["Female", "Male"],
  senior_citizen: ["Yes", "No"],
  partner: ["Yes", "No"],
  dependents: ["Yes", "No"],
  phone_service: ["Yes", "No"],
  multiple_lines: ["Yes", "No", "No phone service"],
  internet_service: ["DSL", "Fiber optic", "No"],
  online_security: ["Yes", "No", "No internet service"],
  online_backup: ["Yes", "No", "No internet service"],
  device_protection: ["Yes", "No", "No internet service"],
  tech_support: ["Yes", "No", "No internet service"],
  streaming_tv: ["Yes", "No", "No internet service"],
  streaming_movies: ["Yes", "No", "No internet service"],
  contract: ["Month-to-month", "One year", "Two year"],
  paperless_billing: ["Yes", "No"],
  payment_method: [
    "Bank transfer (automatic)",
    "Credit card (automatic)",
    "Electronic check",
    "Mailed check",
  ],
};

export const GROUPS: Array<{ title: string; description: string; fields: FormField[] }> = [
  {
    title: "Profile",
    description: "Basic account context used by the model.",
    fields: ["customer_id", "gender", "senior_citizen", "partner", "dependents"],
  },
  {
    title: "Phone",
    description: "Choose whether this account has phone service first.",
    fields: ["phone_service", "multiple_lines"],
  },
  {
    title: "Internet and add-ons",
    description: "Add-on choices follow the selected internet service.",
    fields: [
      "internet_service",
      "online_security",
      "online_backup",
      "device_protection",
      "tech_support",
      "streaming_tv",
      "streaming_movies",
    ],
  },
  {
    title: "Contract and billing",
    description: "Current plan and payment preferences.",
    fields: ["contract", "paperless_billing", "payment_method"],
  },
  {
    title: "Charges",
    description: "Use the account's current numeric values. Values outside the training range are warned before saving.",
    fields: ["tenure", "monthly_charges", "total_charges"],
  },
];

export function valuesFromCustomer(customer: CustomerInput): FormValues {
  return Object.fromEntries(
    Object.keys(DEFAULT_CUSTOMER).map((field) => [field, String(customer[field as keyof CustomerInput])]),
  ) as FormValues;
}
export function payloadFromValues(values: FormValues): CustomerInput {
  return {
    ...values,
    tenure: Number(values.tenure),
    monthly_charges: Number(values.monthly_charges),
    total_charges: Number(values.total_charges),
  } as CustomerInput;
}
