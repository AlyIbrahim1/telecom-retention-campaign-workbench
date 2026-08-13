""" evidence for seeding from the tracked IBM Telco CSV."""

from __future__ import annotations

import csv
import io

from scripts import seed_demo


def test_seed_source_is_the_tracked_csv_and_excludes_training_target() -> None:
    rows = seed_demo.load_rows()

    assert len(rows) == 7043
    assert tuple(rows[0]) == seed_demo.IMPORT_FIELDS
    assert "Churn" not in rows[0]
    assert rows[0]["customerID"] == "7590-VHVEG"
    assert all(row["customerID"] for row in rows)

    reader = csv.DictReader(io.StringIO(seed_demo.csv_bytes(rows).decode("utf-8")))
    assert tuple(reader.fieldnames or ()) == seed_demo.IMPORT_FIELDS
    assert len(list(reader)) == 7043


def test_seed_is_idempotent_and_uploads_only_missing_rows(monkeypatch) -> None:
    rows = seed_demo.load_rows()
    calls: list[tuple[str, str]] = []
    state = {"existing": set()}

    def fake_request_json(base_url, method, path, **kwargs):
        del base_url, kwargs
        calls.append((method, path))
        if path == "/health/ready":
            return 200, {"ready": True}
        assert method == "GET"
        ids = sorted(state["existing"])
        return 200, {"items": [{"customer_id": value} for value in ids], "total": len(ids)}

    def fake_upload(base_url, path, content, **kwargs):
        del base_url, path, kwargs
        imported = list(csv.DictReader(io.StringIO(content.decode("utf-8"))))
        state["existing"].update(row["customerID"] for row in imported)
        return 202, {"status": "completed", "succeeded_rows": len(imported), "invalid_rows": 0, "failed_rows": 0}

    monkeypatch.setattr(seed_demo, "request_json", fake_request_json)
    monkeypatch.setattr(seed_demo, "request_csv_upload", fake_upload)

    first = seed_demo.seed(wait_seconds=1)
    assert first.created == len(rows)
    assert first.skipped == 0
    assert any(path == "/api/v1/customers?page=1&page_size=100&sort=customer_id&order=asc" for _, path in calls)

    calls.clear()
    second = seed_demo.seed(wait_seconds=1)
    assert second.created == 0
    assert second.skipped == len(rows)
    assert not any(path.startswith("/api/v1/imports?") for _, path in calls)
