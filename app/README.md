# Telecom churn application

This folder is the starting point for applications that use the exported
Random Forest churn model. It keeps application inference separate from the
training notebook.

## Structure

- `inference.py` loads the trusted model bundle, cleans incoming customer
  data, validates its schema, and generates predictions.
- `__main__.py` provides a small command-line application for JSON input.
- `example_customer.json` is a complete example request.
- `../models/random_forest_churn_bundle.joblib` contains the fitted
  preprocessing pipeline, Random Forest, decision threshold, and metadata.

## Run the example

From the repository root, use the existing virtual environment:

```bash
python -m app app/example_customer.json
```

On Windows, the project interpreter can be called directly:

```powershell
.venv\Scripts\python.exe -m app app\example_customer.json
```

The command prints JSON similar to:

```json
[
  {
    "churn_score": 0.83,
    "contact_for_retention": true
  }
]
```

`churn_score` is the Random Forest score for the churn class.
`contact_for_retention` uses the exported constrained threshold rather than
the default probability cutoff of 0.5.

## Use it from Python

```python
from app import load_model_bundle, predict_churn

bundle = load_model_bundle()
prediction = predict_churn(customer_dictionary, bundle)
```

`predict_churn` accepts one customer dictionary, a list of customer
dictionaries, or a pandas DataFrame. It returns a DataFrame so applications
can easily serialize the results or add them to an existing customer table.

## Input rules

- All 19 model features must be supplied.
- `customerID` is optional and is ignored by the model.
- `SeniorCitizen` may be `0`/`1` or `"No"`/`"Yes"`.
- `TotalCharges` must be numeric. A missing value is converted to zero only
  when `tenure` is zero.
- Unknown categorical values do not crash the encoder, but they should still
  be monitored because they can indicate data drift or invalid application
  input.

Only load a model artifact that you trust. Joblib uses pickle internally and
can execute code during loading. The application environment should use the
same scikit-learn version stored in the exported bundle.
