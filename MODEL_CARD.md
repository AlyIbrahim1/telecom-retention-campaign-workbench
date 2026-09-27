# Churn model card

## Intended use

The bundled Random Forest ranks telecom customer churn risk for a local retention-team review. Its score and threshold help create a review list; they do not decide who must be contacted or predict the effect of an offer. The application requires human confirmation before a campaign selection is recorded.

## Data and preparation

The tracked IBM Telco Customer Churn sample at `data/raw/WA_Fn-UseC_-Telco-Customer-Churn.csv` has 7,043 customer rows. `customerID` is excluded from modeling. `SeniorCitizen` is represented as Yes/No, text is stripped, and the 11 blank `TotalCharges` values for zero-tenure, non-churning customers are set to zero. The target is `Churn` (Yes/No). The split uses stratification and reserves 20% for holdout evaluation. All encoders and scalers are fitted inside each model pipeline.

This is a historical, observational sample. Churn associations are not causal evidence. The file has no contact outcomes, offer costs, or evidence that a retention intervention worked.

## Bundled artifact

- File: `models/random_forest_churn_bundle.joblib`
- SHA-256: `e96bc451db7fd313cd34e549816afbedded45ff34665a2aafd70c63bf767b180`
- scikit-learn version in bundle: `1.9.0`
- Decision threshold: `0.5268190582639384`; provisional training false-positive-rate cap: `0.31`
- Stored training out-of-fold recall/FPR: `0.8462` / `0.3073`
- Stored holdout recall/precision/FPR/F2: `0.8396` / `0.4945` / `0.3101` / `0.7367`
- Stored holdout counts: 321 false positives, 60 false negatives, 635 customers flagged.

These are values stored in the current trusted bundle. The bundle predates the revised model-selection notebook. Its original comparison considered test-set contact share when choosing Random Forest, so these holdout metrics should **not** be presented as an untouched post-selection estimate. Rerun the revised notebook and review its candidate before making stronger generalization claims.

## Reproducibility and promotion

`notebooks/eda.ipynb` explores the data. `notebooks/model_selection.ipynb` now selects a deployable model using training cross-validation, freezes its threshold using out-of-fold training scores, and then evaluates the holdout once. It writes a candidate under `models/candidates/`, leaving the trusted artifact unchanged.

The API deliberately checks the artifact checksum, feature order, scikit-learn version, model family contract, and threshold at startup. Promoting a new candidate requires reviewing its metrics, updating the application model contract and `MODEL_PATH`/`MODEL_SHA256`, and running migration, model-contract, API, and browser tests. A checksum update alone will not promote a candidate.

## Limits

Scores are rankings, not calibrated probabilities. The 31% FPR cap is a demonstration choice, not a business-approved cost limit. The IBM sample does not establish current population performance, drift, fairness, or intervention effectiveness. The single-operator local application has no authentication and must not be exposed publicly.
