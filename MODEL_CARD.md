# Churn model card

## Intended use

The bundled Random Forest ranks telecom customer churn risk for a local retention-team review. Its score and threshold help create a review list; they do not decide who must be contacted or predict the effect of an offer. The application requires human confirmation before a campaign selection is recorded.

## Data and preparation

The tracked IBM Telco Customer Churn sample at `data/raw/WA_Fn-UseC_-Telco-Customer-Churn.csv` has 7,043 customer rows. `customerID` is excluded from modeling. `SeniorCitizen` is represented as Yes/No, text is stripped, and the 11 blank `TotalCharges` values for zero-tenure, non-churning customers are set to zero. The target is `Churn` (Yes/No). The split uses stratification and reserves 20% for holdout evaluation. All encoders and scalers are fitted inside each model pipeline.

This is a historical, observational sample. Churn associations are not causal evidence. The file has no contact outcomes, offer costs, or evidence that a retention intervention worked.

## Bundled artifact

- File: `models/random_forest_churn_bundle.joblib`
- SHA-256: `cc153c09709418482dded4b05de5dccbe5f990ccac908b53c1e91828c2fcd73a`
- Application model version: `random-forest-bundle-v2`; scikit-learn version: `1.9.0`
- Decision threshold: `0.5268190582639384`; provisional training false-positive-rate cap: `0.31`
- Training cross-validation recall under the cap: `0.8495` for Random Forest and LightGBM. The documented tie rule selected Random Forest.
- Training out-of-fold recall/FPR at the frozen threshold: `0.846` / `0.307`.
- Untouched holdout recall/precision/FPR/F2: `0.8396` / `0.4945` / `0.3101` / `0.7367`.
- Holdout counts: 321 false positives, 60 false negatives, 635 customers flagged.

The revised notebook selected the model and threshold using training data only, then evaluated the holdout once. This candidate was promoted after its checksum, feature contract, model loader, and holdout counts were verified. Its prediction scores matched the previous bundle exactly across all 7,043 tracked customer rows; the improvement is the valid selection procedure and provenance, rather than different scores. Historical predictions keep their original model version and checksum in the database.

## Reproducibility and promotion

`notebooks/eda.ipynb` explores the data. `notebooks/model_selection.ipynb` selects a deployable model using training cross-validation, freezes its threshold using out-of-fold training scores, and then evaluates the holdout once. It writes a candidate under `models/candidates/` so notebook reruns cannot silently replace the trusted application bundle.

The API checks the artifact checksum, feature order, scikit-learn version, model family contract, and threshold at startup. A future promotion requires reviewing the candidate metrics, updating the application model version and checksum, and running model-contract, API, and browser checks. Changing only the checksum is insufficient.

## Limits

Scores are rankings, not calibrated probabilities. The 31% FPR cap is a demonstration choice, not a business-approved cost limit. The IBM sample does not establish current population performance, drift, fairness, or intervention effectiveness. The single-operator local application has no authentication and must not be exposed publicly.
