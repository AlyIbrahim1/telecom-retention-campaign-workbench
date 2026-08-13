import json

import pytest


SECURITY_HEADERS = {
    "content-security-policy",
    "x-content-type-options",
    "x-frame-options",
    "referrer-policy",
    "x-correlation-id",
}


@pytest.mark.parametrize(
    ("method", "path", "expected_status"),
    [
        ("GET", "/health/live", 200),
        ("GET", "/missing", 404),
        ("POST", "/health/live", 405),
        ("GET", "/test/error", 500),
    ],
)
def test_safe_problem_responses_and_security_headers(
    client_factory, method, path, expected_status
):
    with client_factory() as client:
        response = client.request(method, path)

    assert response.status_code == expected_status
    assert SECURITY_HEADERS <= set(response.headers)
    assert len(response.headers["x-correlation-id"]) == 32
    if expected_status >= 400:
        assert response.headers["content-type"].startswith("application/problem+json")
        assert response.json()["correlation_id"] == response.headers["x-correlation-id"]
        assert "SENTINEL-SECRET" not in response.text
        assert "Traceback" not in response.text


def test_request_size_boundary_including_streamed_body(client_factory):
    with client_factory() as client:
        exact = client.post("/test/body", content=b"x" * 16)
        too_large = client.post("/test/body", content=b"x" * 17)

        def chunks():
            yield b"x" * 10
            yield b"x" * 7

        streamed = client.post("/test/body", content=chunks())

    assert exact.status_code == 200
    assert exact.json() == {"size": 16}
    for response in (too_large, streamed):
        assert response.status_code == 413
        assert response.json()["code"] == "request_too_large"
        assert SECURITY_HEADERS <= set(response.headers)


def test_cors_allows_only_the_configured_origin(client_factory):
    headers = {
        "Origin": "http://127.0.0.1:5173",
        "Access-Control-Request-Method": "GET",
    }
    with client_factory() as client:
        allowed = client.options("/health/live", headers=headers)
        denied = client.options(
            "/health/live",
            headers={**headers, "Origin": "https://unlisted.example"},
        )

    assert allowed.status_code == 200
    assert allowed.headers["access-control-allow-origin"] == headers["Origin"]
    assert denied.status_code == 400
    assert "access-control-allow-origin" not in denied.headers


def test_request_logs_are_json_and_contain_only_safe_metadata(
    client_factory, caplog
):
    with client_factory() as client:
        client.post(
            "/test/body",
            content=b"private",
            headers={"Authorization": "Bearer hidden", "Cookie": "session=hidden"},
        )

    record = next(record for record in caplog.records if record.msg == "http_request")
    safe_record = json.dumps(record.__dict__, default=str)
    assert record.path == "/test/body"
    assert "private" not in safe_record
    assert "Bearer hidden" not in safe_record
    assert "session=hidden" not in safe_record
