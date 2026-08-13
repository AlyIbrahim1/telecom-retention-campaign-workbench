""" evidence for the synthetic local demo seed."""

from __future__ import annotations

import csv
from pathlib import Path

from scripts import seed_demo


ROOT = Path(__file__).resolve().parents[1]


def test_seed_file_is_canonical_synthetic_data() -> None:
    rows = seed_demo.load_rows()
    assert len(rows) >= 5
    assert all(row["customer_id"].startswith("DEMO-") for row in rows)
    assert len({row["customer_id"] for row in rows}) == len(rows)
    assert all(isinstance(row["tenure"], int) for row in rows)
    assert all(isinstance(row["monthly_charges"], float) for row in rows)
    assert all(isinstance(row["total_charges"], float) for row in rows)

    with (ROOT / "WA_Fn-UseC_-Telco-Customer-Churn.csv").open(
        encoding="utf-8-sig", newline=""
    ) as handle:
        training_ids = {row["customerID"] for row in csv.DictReader(handle)}
    assert not training_ids.intersection(row["customer_id"] for row in rows)


def test_seed_is_idempotent_and_skips_rows_created_by_another_run(monkeypatch) -> None:
    existing = {"DEMO-001"}

    def fake_request_json(base_url, method, path, **kwargs):
        del base_url
        if path == "/health/ready":
            return 200, {"ready": True}
        customer_id = path.rsplit("/", 1)[-1]
        if method == "GET":
            if customer_id in existing:
                return 200, {"customer": {"customer": {"customer_id": customer_id}}}
            raise seed_demo.ApiError(404, {"code": "customer_not_found"})
        assert method == "POST"
        # The POST path does not include the ID; inspect the payload as the API
        # would, then retain it for the next idempotent invocation.
        customer_id = kwargs["payload"]["customer_id"]
        existing.add(customer_id)
        return 201, {"customer": {"customer": {"customer_id": customer_id}}}

    monkeypatch.setattr(seed_demo, "request_json", fake_request_json)
    first = seed_demo.seed(wait_seconds=1)
    assert first.created == 7
    assert first.skipped == 1
    second = seed_demo.seed(wait_seconds=1)
    assert second.created == 0
    assert second.skipped == 8
