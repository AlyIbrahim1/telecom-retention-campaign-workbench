#!/usr/bin/env python3
"""Seed the local pilot with a small, synthetic customer set.

The script intentionally talks to the public API instead of writing the
database directly.  That keeps the demo on the same validation, prediction,
audit, and idempotency path as a real operator.  Existing customer IDs are
left untouched, so running the command again is safe after a partial run.

This file uses only the Python standard library so it can run from a clean
checkout before the backend virtual environment is installed.
"""

from __future__ import annotations

import argparse
import csv
import json
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CSV = ROOT / "demo" / "seed_customers.csv"
DEFAULT_API_URL = "http://127.0.0.1:8000"

CUSTOMER_FIELDS = (
    "customer_id",
    "gender",
    "senior_citizen",
    "partner",
    "dependents",
    "tenure",
    "phone_service",
    "multiple_lines",
    "internet_service",
    "online_security",
    "online_backup",
    "device_protection",
    "tech_support",
    "streaming_tv",
    "streaming_movies",
    "contract",
    "paperless_billing",
    "payment_method",
    "monthly_charges",
    "total_charges",
)


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


def request_json(
    base_url: str,
    method: str,
    path: str,
    *,
    payload: dict[str, Any] | None = None,
    headers: dict[str, str] | None = None,
    timeout: float = 10.0,
) -> tuple[int, Any]:
    """Make one small JSON request and raise a safe :class:`ApiError`."""

    request_headers = {"Accept": "application/json"}
    if payload is not None:
        request_headers["Content-Type"] = "application/json"
    if headers:
        request_headers.update(headers)
    data = json.dumps(payload, separators=(",", ":")).encode("utf-8") if payload is not None else None
    request = Request(
        f"{base_url.rstrip('/')}{path}",
        data=data,
        headers=request_headers,
        method=method,
    )
    try:
        with urlopen(request, timeout=timeout) as response:  # noqa: S310 - URL is operator-configured local API
            return int(response.status), _decode_body(response.read())
    except HTTPError as exc:
        raise ApiError(exc.code, _decode_body(exc.read())) from exc
    except URLError as exc:
        raise RuntimeError(f"Could not reach the local API at {base_url}: {exc.reason}") from exc


def load_rows(csv_path: Path = DEFAULT_CSV) -> list[dict[str, Any]]:
    """Load and minimally type-check the canonical synthetic seed file."""

    try:
        with csv_path.open("r", encoding="utf-8-sig", newline="") as handle:
            reader = csv.DictReader(handle)
            columns = tuple(reader.fieldnames or ())
            if columns != CUSTOMER_FIELDS:
                raise ValueError(
                    f"{csv_path} must use the canonical 20-column customer header"
                )
            rows: list[dict[str, Any]] = []
            seen: set[str] = set()
            for line_number, raw in enumerate(reader, start=2):
                if None in raw:
                    raise ValueError(f"{csv_path}:{line_number} has too many columns")
                row = {field: (raw.get(field) or "").strip() for field in CUSTOMER_FIELDS}
                customer_id = row["customer_id"].upper()
                if not customer_id:
                    raise ValueError(f"{csv_path}:{line_number} has an empty customer_id")
                if customer_id in seen:
                    raise ValueError(f"{csv_path}:{line_number} repeats {customer_id}")
                seen.add(customer_id)
                row["customer_id"] = customer_id
                try:
                    row["tenure"] = int(row["tenure"])
                    row["monthly_charges"] = float(row["monthly_charges"])
                    row["total_charges"] = float(row["total_charges"])
                except ValueError as exc:
                    raise ValueError(f"{csv_path}:{line_number} has an invalid numeric value") from exc
                rows.append(row)
    except FileNotFoundError as exc:
        raise RuntimeError(f"Demo seed file was not found: {csv_path}") from exc
    if not rows:
        raise ValueError(f"{csv_path} must contain at least one customer")
    return rows


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


def seed(
    *,
    base_url: str = DEFAULT_API_URL,
    csv_path: Path = DEFAULT_CSV,
    wait_seconds: float = 30.0,
    request_timeout: float = 10.0,
) -> SeedSummary:
    """Create missing synthetic customers and leave existing rows unchanged."""

    rows = load_rows(csv_path)
    wait_for_ready(base_url, wait_seconds=wait_seconds, request_timeout=min(request_timeout, 5.0))
    created = 0
    skipped = 0
    customer_ids: list[str] = []
    for row in rows:
        customer_id = row["customer_id"]
        encoded_id = quote(customer_id, safe="")
        try:
            status, _ = request_json(
                base_url,
                "GET",
                f"/api/v1/customers/{encoded_id}",
                timeout=request_timeout,
            )
        except ApiError as exc:
            if exc.status != 404:
                raise
        else:
            if status == 200:
                skipped += 1
                customer_ids.append(customer_id)
                continue
            raise ApiError(status, None)

        try:
            status, _ = request_json(
                base_url,
                "POST",
                "/api/v1/customers",
                payload=row,
                headers={"Idempotency-Key": f"demo-seed-create-{customer_id}"},
                timeout=request_timeout,
            )
        except ApiError as exc:
            # A concurrent invocation may create the row between GET and POST.
            # Confirm that case and preserve idempotency instead of overwriting.
            if exc.status == 409:
                try:
                    existing_status, _ = request_json(
                        base_url,
                        "GET",
                        f"/api/v1/customers/{encoded_id}",
                        timeout=request_timeout,
                    )
                except ApiError:
                    raise exc
                if existing_status == 200:
                    skipped += 1
                    customer_ids.append(customer_id)
                    continue
            raise
        if status != 201:
            raise ApiError(status, None)
        created += 1
        customer_ids.append(customer_id)
    return SeedSummary(created=created, skipped=skipped, customer_ids=tuple(customer_ids))


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--api-url", default=DEFAULT_API_URL, help="Local API base URL (default: %(default)s)")
    parser.add_argument("--csv", type=Path, default=DEFAULT_CSV, help="Synthetic seed CSV path")
    parser.add_argument("--wait-seconds", type=float, default=30.0, help="Readiness wait budget (default: %(default)s)")
    parser.add_argument("--request-timeout", type=float, default=10.0, help="Per-request timeout (default: %(default)s)")
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
        print(f"Demo seed failed: {exc}")
        return 1
    print(f"Demo seed ready: {summary.created} created, {summary.skipped} already present.")
    print("Customer IDs: " + ", ".join(summary.customer_ids))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
