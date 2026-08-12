"""Command-line entry point for trying the exported churn model."""

import argparse
import json
from pathlib import Path

from .inference import predict_churn


def main():
    parser = argparse.ArgumentParser(
        description="Predict telecom customer churn from a JSON file."
    )
    parser.add_argument(
        "customer_file",
        type=Path,
        help="JSON object or list of customer objects",
    )
    args = parser.parse_args()

    with args.customer_file.open(encoding="utf-8") as file:
        customers = json.load(file)

    predictions = predict_churn(customers)
    print(predictions.to_json(orient="records", indent=2))


if __name__ == "__main__":
    main()
