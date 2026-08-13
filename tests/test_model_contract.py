"""Executable evidence for the frozen  model contract."""

import hashlib
import json
import unittest
from pathlib import Path

import joblib
from jsonschema import Draft202012Validator, ValidationError

from app.inference import predict_churn


ROOT = Path(__file__).resolve().parents[1]
MODEL_PATH = ROOT / "models" / "random_forest_churn_bundle.joblib"
FIXTURE_PATH = ROOT / "docs" / "baseline" / "model-fixtures.json"
CUSTOMER_SCHEMA_PATH = ROOT / "docs" / "contracts" / "customer.schema.json"
PREDICTION_SCHEMA_PATH = ROOT / "docs" / "contracts" / "prediction.schema.json"
EXPECTED_SHA256 = "e96bc451db7fd313cd34e549816afbedded45ff34665a2aafd70c63bf767b180"
EXPECTED_THRESHOLD = 0.5268190582639384
SCORE_TOLERANCE = 1e-10

EXPECTED_FEATURES = [
    "gender",
    "SeniorCitizen",
    "Partner",
    "Dependents",
    "tenure",
    "PhoneService",
    "MultipleLines",
    "InternetService",
    "OnlineSecurity",
    "OnlineBackup",
    "DeviceProtection",
    "TechSupport",
    "StreamingTV",
    "StreamingMovies",
    "Contract",
    "PaperlessBilling",
    "PaymentMethod",
    "MonthlyCharges",
    "TotalCharges",
]

EXPECTED_CATEGORIES = {
    "gender": ["Female", "Male"],
    "SeniorCitizen": ["No", "Yes"],
    "Partner": ["No", "Yes"],
    "Dependents": ["No", "Yes"],
    "PhoneService": ["No", "Yes"],
    "MultipleLines": ["No", "No phone service", "Yes"],
    "InternetService": ["DSL", "Fiber optic", "No"],
    "OnlineSecurity": ["No", "No internet service", "Yes"],
    "OnlineBackup": ["No", "No internet service", "Yes"],
    "DeviceProtection": ["No", "No internet service", "Yes"],
    "TechSupport": ["No", "No internet service", "Yes"],
    "StreamingTV": ["No", "No internet service", "Yes"],
    "StreamingMovies": ["No", "No internet service", "Yes"],
    "Contract": ["Month-to-month", "One year", "Two year"],
    "PaperlessBilling": ["No", "Yes"],
    "PaymentMethod": [
        "Bank transfer (automatic)",
        "Credit card (automatic)",
        "Electronic check",
        "Mailed check",
    ],
}


class ModelContractTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Check executable Joblib content before deserializing it.
        digest = hashlib.sha256(MODEL_PATH.read_bytes()).hexdigest()
        if digest != EXPECTED_SHA256:
            raise AssertionError("Model checksum differs; refusing to deserialize it")

        cls.bundle = joblib.load(MODEL_PATH)
        cls.fixtures = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))
        cls.customer_schema = json.loads(
            CUSTOMER_SCHEMA_PATH.read_text(encoding="utf-8")
        )
        cls.prediction_schema = json.loads(
            PREDICTION_SCHEMA_PATH.read_text(encoding="utf-8")
        )

    def test_bundle_metadata_and_feature_order(self):
        self.assertEqual(self.bundle["bundle_version"], 1)
        self.assertEqual(self.bundle["sklearn_version"], "1.9.0")
        self.assertEqual(self.bundle["feature_columns"], EXPECTED_FEATURES)
        self.assertEqual(
            self.bundle["numeric_features"],
            ["tenure", "MonthlyCharges", "TotalCharges"],
        )
        self.assertEqual(self.bundle["positive_class"], 1)
        self.assertEqual(self.bundle["pipeline"].classes_.tolist(), [0, 1])
        self.assertEqual(self.bundle["threshold"], EXPECTED_THRESHOLD)

    def test_trained_categories_match_the_canonical_contract(self):
        encoder = (
            self.bundle["pipeline"]
            .named_steps["preprocess"]
            .named_transformers_["categorical"]
        )
        actual = {
            name: categories.tolist()
            for name, categories in zip(
                self.bundle["categorical_features"], encoder.categories_
            )
        }
        self.assertEqual(actual, EXPECTED_CATEGORIES)

        properties = self.customer_schema["properties"]
        model_fields = [
            field["x-model-field"]
            for field in properties.values()
            if field["x-model-field"] is not None
        ]
        self.assertEqual(model_fields, EXPECTED_FEATURES)

        api_categories = {}
        for api_name, field in properties.items():
            model_name = field["x-model-field"]
            if model_name not in EXPECTED_CATEGORIES:
                continue
            if "$ref" in field:
                definition_name = field["$ref"].rsplit("/", 1)[-1]
                values = self.customer_schema["$defs"][definition_name]["enum"]
            else:
                values = field["enum"]
            api_categories[model_name] = values

        self.assertEqual(
            {name: set(values) for name, values in api_categories.items()},
            {name: set(values) for name, values in EXPECTED_CATEGORIES.items()},
        )

    def test_prediction_response_vocabulary_is_frozen(self):
        self.assertEqual(
            set(self.prediction_schema["required"]),
            {
                "customer_id",
                "risk_score",
                "recommended_for_review",
                "model_version",
                "threshold",
                "threshold_policy_version",
                "scored_at",
                "warnings",
            },
        )
        properties = self.prediction_schema["properties"]
        self.assertEqual(
            properties["model_version"]["const"], "random-forest-bundle-v1"
        )
        self.assertEqual(properties["threshold"]["const"], EXPECTED_THRESHOLD)
        self.assertEqual(
            properties["threshold_policy_version"]["const"],
            "fpr-cap-0.31-v1",
        )

    def test_canonical_schema_examples_and_cross_field_rules(self):
        Draft202012Validator.check_schema(self.customer_schema)
        Draft202012Validator.check_schema(self.prediction_schema)

        customer_validator = Draft202012Validator(self.customer_schema)
        prediction_validator = Draft202012Validator(self.prediction_schema)
        customer = self.customer_schema["examples"][0]
        customer_validator.validate(customer)
        prediction_validator.validate(self.prediction_schema["examples"][0])

        invalid_internet = {**customer, "internet_service": "No"}
        with self.assertRaises(ValidationError):
            customer_validator.validate(invalid_internet)

        invalid_total = {**customer, "tenure": 1, "total_charges": 0}
        with self.assertRaises(ValidationError):
            customer_validator.validate(invalid_total)

        with self.assertRaises(ValidationError):
            customer_validator.validate({**customer, "Churn": "Yes"})

    def test_synthetic_fixture_scores_are_reproducible(self):
        predictions = predict_churn(
            [fixture["input"] for fixture in self.fixtures], self.bundle
        )

        for fixture, (_, prediction) in zip(
            self.fixtures, predictions.iterrows(), strict=True
        ):
            with self.subTest(fixture=fixture["name"]):
                expected = fixture["expected"]
                self.assertAlmostEqual(
                    prediction["churn_score"],
                    expected["risk_score"],
                    delta=SCORE_TOLERANCE,
                )
                self.assertEqual(
                    bool(prediction["contact_for_retention"]),
                    expected["recommended_for_review"],
                )
                self.assertEqual(
                    expected["recommended_for_review"],
                    expected["risk_score"] >= EXPECTED_THRESHOLD,
                )


if __name__ == "__main__":
    unittest.main()
