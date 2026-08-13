def test_liveness_does_not_depend_on_database(client_factory):
    with client_factory(lambda: False) as client:
        response = client.get("/health/live")

    assert response.status_code == 200
    assert response.json() == {"status": "live"}


def test_readiness_reports_database_up(client_factory):
    with client_factory(lambda: True) as client:
        response = client.get("/health/ready")

    assert response.status_code == 200
    assert response.json() == {
        "status": "ready",
        "ready": True,
        "checks": {"database": "ready", "model": "not_configured"},
    }


def test_readiness_safely_reports_database_down(client_factory):
    def unavailable():
        raise RuntimeError("postgresql+psycopg://user:secret@database/private")

    with client_factory(unavailable) as client:
        response = client.get("/health/ready")

    assert response.status_code == 503
    assert response.headers["content-type"].startswith("application/problem+json")
    assert response.json()["code"] == "service_unavailable"
    assert "secret" not in response.text
