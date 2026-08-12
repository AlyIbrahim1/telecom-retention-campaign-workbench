"""Load the exported churn model and use it for application predictions."""

from pathlib import Path

import joblib
import pandas as pd


DEFAULT_MODEL_PATH = (
    Path(__file__).resolve().parents[1]
    / "models"
    / "random_forest_churn_bundle.joblib"
)


def load_model_bundle(model_path=DEFAULT_MODEL_PATH):
    """Load a trusted model bundle exported by teleco_churn_eda.ipynb."""
    bundle = joblib.load(model_path)
    required_keys = {
        "pipeline",
        "threshold",
        "feature_columns",
        "categorical_features",
    }
    missing_keys = required_keys.difference(bundle)
    if missing_keys:
        raise ValueError(f"Model bundle is missing keys: {sorted(missing_keys)}")
    return bundle


def prepare_customer_data(customers, bundle):
    """Apply the notebook's basic cleaning and enforce the model input schema."""
    if isinstance(customers, dict):
        customer_data = pd.DataFrame([customers])
    elif isinstance(customers, list):
        customer_data = pd.DataFrame(customers)
    elif isinstance(customers, pd.DataFrame):
        customer_data = customers.copy()
    else:
        raise TypeError(
            "customers must be a dictionary, list of dictionaries, "
            "or pandas DataFrame"
        )

    if customer_data.empty:
        raise ValueError("At least one customer is required")

    customer_data = customer_data.drop(columns=["customerID"], errors="ignore")

    missing_columns = set(bundle["feature_columns"]).difference(customer_data.columns)
    if missing_columns:
        raise ValueError(f"Missing input columns: {sorted(missing_columns)}")

    customer_data["SeniorCitizen"] = customer_data["SeniorCitizen"].replace(
        {1: "Yes", 0: "No"}
    )

    for column in bundle["categorical_features"]:
        customer_data[column] = customer_data[column].astype("string").str.strip()

    customer_data["TotalCharges"] = pd.to_numeric(
        customer_data["TotalCharges"],
        errors="coerce",
    )
    new_customer = (
        customer_data["TotalCharges"].isna()
        & customer_data["tenure"].eq(0)
    )
    customer_data.loc[new_customer, "TotalCharges"] = 0

    customer_data = customer_data[bundle["feature_columns"]]
    columns_with_missing_values = customer_data.columns[
        customer_data.isna().any()
    ].tolist()
    if columns_with_missing_values:
        raise ValueError(
            "Missing or invalid values in columns: "
            f"{columns_with_missing_values}"
        )

    return customer_data


def predict_churn(customers, bundle=None):
    """Return the churn score and threshold-based retention decision."""
    if bundle is None:
        bundle = load_model_bundle()

    customer_data = prepare_customer_data(customers, bundle)
    churn_scores = bundle["pipeline"].predict_proba(customer_data)[:, 1]

    return pd.DataFrame(
        {
            "churn_score": churn_scores,
            "contact_for_retention": churn_scores >= bundle["threshold"],
        },
        index=customer_data.index,
    )
