#!/usr/bin/env python3
"""Load the tracked IBM Telco CSV into the local pilot database.

The script talks to the bulk-import API instead of writing the database
directly. That keeps CSV normalization, validation, prediction, audit, and
idempotency on the same path as an operator import. The source CSV's Churn
target column is deliberately omitted because it is a training label, not an
application customer field.

Only missing customer IDs are submitted, so repeating the command is safe and
does not overwrite existing records. This file uses only the Python standard
library and can run from a clean checkout before the backend virtual
environment is installed.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CSV = ROOT / "WA_Fn-UseC_-Telco-Customer-Churn.csv"
DEFAULT_API_URL = "http://127.0.0.1:8000"

SOURCE_FIELDS = (
    "customerID",
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
    "Churn",
)
IMPORT_FIELDS = SOURCE_FIELDS[:-1]


class ApiError(RuntimeError):
    """A safe, compact representation of a non-success API response."""

    def __init__(self, status: int, body: Any) -> None:
        self.status = status
        self.body = body
        if isinstance(body, dict):
            detail = body.get("detail") or body.get("title") or body.get("code")
        else:
            detail = None
        super().__init__(f"API returned HTTP {status}: {detail or 'request failed'}")


@dataclass(frozen=True)
class SeedSummary:
    """Counts returned by :func:`seed` for shell scripts and tests."""

    created: int
    skipped: int
    customer_ids: tuple[str, ...]


def _decode_body(raw: bytes) -> Any:
    if not raw:
        return None
    try:
        return json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return None


def _request(
    base_url: str,
    method: str,
    path: str,
    *,
    body: bytes | None = None,
    content_type: str | None = None,
    headers: dict[str, str] | None = None,
    timeout: float = 10.0,
) -> tuple[int, Any]:
    request_headers = {"Accept": "application/json"}
    if content_type:
        request_headers["Content-Type"] = content_type
    if headers:
        request_headers.update(headers)
    request = Request(
        f"{base_url.rstrip('/')}{path}",
        data=body,
        headers=request_headers,
        method=method,
    )
    try:
        with urlopen(request, timeout=timeout) as response:  # noqa: S310 - operator-configured local API
            return int(response.status), _decode_body(response.read())
    except HTTPError as exc:
        raise ApiError(exc.code, _decode_body(exc.read())) from exc
    except URLError as exc:
        raise RuntimeError(f"Could not reach the local API at {base_url}: {exc.reason}") from exc


def request_json(
    base_url: str,
    method: str,
    path: str,
    *,
    payload: dict[str, Any] | None = None,
    headers: dict[str, str] | None = None,
    timeout: float = 10.0,
) -> tuple[int, Any]:
    body = json.dumps(payload, separators=(",", ":")).encode("utf-8") if payload is not None else None
    return _request(
        base_url,
        method,
        path,
        body=body,
        content_type="application/json" if payload is not None else None,
        headers=headers,
        timeout=timeout,
    )


def request_csv_upload(
    base_url: str,
    path: str,
    content: bytes,
    *,
    filename: str,
    headers: dict[str, str],
    timeout: float = 30.0,
) -> tuple[int, Any]:
    boundary = "----retention-workbench-seed-" + hashlib.sha256(content).hexdigest()[:16]
    prefix = (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="file"; filename="{filename}"\r\n'
        "Content-Type: text/csv\r\n\r\n"
    ).encode("ascii")
    body = prefix + content + f"\r\n--{boundary}--\r\n".encode("ascii")
    return _request(
        base_url,
        "POST",
        path,
        body=body,
        content_type=f"multipart/form-data; boundary={boundary}",
        headers=headers,
        timeout=timeout,
    )


def load_rows(csv_path: Path = DEFAULT_CSV) -> list[dict[str, str]]:
    """Read the tracked IBM CSV and remove its supervised-learning target."""

    try:
        with csv_path.open("r", encoding="utf-8-sig", newline="") as handle:
            reader = csv.DictReader(handle)
            if tuple(reader.fieldnames or ()) != SOURCE_FIELDS:
                raise ValueError(
                    f"{csv_path} must use the tracked IBM CSV header, including Churn"
                )
            rows: list[dict[str, str]] = []
            seen: set[str] = set()
            for line_number, raw in enumerate(reader, start=2):
                if None in raw:
                    raise ValueError(f"{csv_path}:{line_number} has too many columns")
                row = {field: (raw.get(field) or "").strip() for field in IMPORT_FIELDS}
                customer_id = row["customerID"].upper()
                if not customer_id:
                    raise ValueError(f"{csv_path}:{line_number} has an empty customerID")
                if customer_id in seen:
                    raise ValueError(f"{csv_path}:{line_number} repeats {customer_id}")
                seen.add(customer_id)
                row["customerID"] = customer_id
                rows.append(row)
    except FileNotFoundError as exc:
        raise RuntimeError(f"Training CSV was not found: {csv_path}") from exc
    if not rows:
        raise ValueError(f"{csv_path} must contain at least one customer")
    return rows


def csv_bytes(rows: list[dict[str, str]]) -> bytes:
    output = io.StringIO(newline="")
    writer = csv.DictWriter(output, fieldnames=IMPORT_FIELDS, lineterminator="\n")
    writer.writeheader()
    writer.writerows(rows)
    return output.getvalue().encode("utf-8")


def wait_for_ready(base_url: str, *, wait_seconds: float = 30.0, request_timeout: float = 5.0) -> None:
    """Wait for the API's dependency and model readiness check."""

    deadline = time.monotonic() + wait_seconds
    last_error: Exception | None = None
    while time.monotonic() < deadline:
        try:
            status, body = request_json(base_url, "GET", "/health/ready", timeout=request_timeout)
            if status == 200 and isinstance(body, dict) and body.get("ready") is True:
                return
            last_error = ApiError(status, body)
        except (ApiError, RuntimeError) as exc:
            last_error = exc
        time.sleep(0.5)
    detail = f" ({last_error})" if last_error else ""
    raise RuntimeError(f"API did not become ready within {wait_seconds:g} seconds{detail}")


def existing_customer_ids(base_url: str, *, request_timeout: float = 10.0) -> set[str]:
    """Read all bounded customer-list pages without fetching IDs one by one."""

    existing: set[str] = set()
    page = 1
    while True:
        _status, body = request_json(
            base_url,
            "GET",
            f"/api/v1/customers?page={page}&page_size=100&sort=customer_id&order=asc",
            timeout=request_timeout,
        )
        if not isinstance(body, dict):
            raise RuntimeError("The customer list response was invalid")
        items = body.get("items") or []
        existing.update(
            item["customer_id"] for item in items if isinstance(item, dict) and item.get("customer_id")
        )
        total = int(body.get("total") or 0)
        if not items or len(existing) >= total:
            return existing
        page += 1


def seed(
    *,
    base_url: str = DEFAULT_API_URL,
    csv_path: Path = DEFAULT_CSV,
    wait_seconds: float = 30.0,
    request_timeout: float = 300.0,
) -> SeedSummary:
    """Import missing rows from the tracked IBM CSV and never overwrite rows."""

    rows = load_rows(csv_path)
    wait_for_ready(base_url, wait_seconds=wait_seconds, request_timeout=min(request_timeout, 5.0))
    existing = existing_customer_ids(base_url, request_timeout=request_timeout)
    missing = [row for row in rows if row["customerID"] not in existing]
    if not missing:
        return SeedSummary(created=0, skipped=len(rows), customer_ids=tuple(row["customerID"] for row in rows))

    content = csv_bytes(missing)
    digest = hashlib.sha256(content).hexdigest()
    status, body = request_csv_upload(
        base_url,
        "/api/v1/imports?mode=create",
        content,
        filename=csv_path.name,
        headers={"Idempotency-Key": f"demo-training-create-{digest}"},
        timeout=request_timeout,
    )
    if status != 202 or not isinstance(body, dict):
        raise ApiError(status, body)
    job_id = body.get("job_id")
    if not isinstance(job_id, str) or not job_id:
        raise RuntimeError("Training CSV import did not return a job ID")
    deadline = time.monotonic() + request_timeout
    while body.get("status") in {"ready", "queued", "running"} and time.monotonic() < deadline:
        time.sleep(0.5)
        status, body = request_json(
            base_url,
            "GET",
            f"/api/v1/imports/{job_id}",
            timeout=min(request_timeout, 10.0),
        )
        if status != 200 or not isinstance(body, dict):
            raise ApiError(status, body)
    if body.get("status") != "completed":
        raise RuntimeError(
            "Training CSV import did not complete: "
            f"status={body.get('status')}, invalid_rows={body.get('invalid_rows', 0)}, "
            f"failed_rows={body.get('failed_rows', 0)}"
        )
    created = int(body.get("succeeded_rows") or 0)
    if created != len(missing):
        raise RuntimeError(f"Training CSV import created {created} of {len(missing)} rows")
    return SeedSummary(
        created=created,
        skipped=len(rows) - len(missing),
        customer_ids=tuple(row["customerID"] for row in rows),
    )


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--api-url", default=DEFAULT_API_URL, help="Local API base URL (default: %(default)s)")
    parser.add_argument("--csv", type=Path, default=DEFAULT_CSV, help="IBM Telco CSV path")
    parser.add_argument("--wait-seconds", type=float, default=30.0, help="Readiness wait budget (default: %(default)s)")
    parser.add_argument("--request-timeout", type=float, default=300.0, help="Per-request timeout (default: %(default)s)")
    return parser


def main() -> int:
    args = _parser().parse_args()
    try:
        summary = seed(
            base_url=args.api_url,
            csv_path=args.csv,
            wait_seconds=args.wait_seconds,
            request_timeout=args.request_timeout,
        )
    except (RuntimeError, ValueError, ApiError) as exc:
        print(f"Training CSV seed failed: {exc}")
        return 1
    print(f"Training CSV ready: {summary.created} created, {summary.skipped} already present.")
    print(f"Source: {args.csv}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
