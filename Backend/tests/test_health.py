from datetime import datetime

from fastapi.testclient import TestClient

from Backend.routes import health


def test_liveness_endpoint_reports_live_status(anonymous_client: TestClient) -> None:
    response = anonymous_client.get("/api/health/live")

    assert response.status_code == 200
    assert response.json() == {"status": "live"}


def test_readiness_endpoint_reports_database_dependency(anonymous_client: TestClient) -> None:
    response = anonymous_client.get("/api/health/ready")

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "ready"
    assert payload["dependencies"] == "database"
    assert datetime.fromisoformat(payload["checked_at"])


def test_readiness_endpoint_returns_503_when_database_is_unavailable(
    anonymous_client: TestClient, monkeypatch
) -> None:
    class BrokenSession:
        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb) -> None:
            return None

        def exec(self, *_args, **_kwargs):
            raise RuntimeError("db is down")

    monkeypatch.setattr(health, "SessionLocal", lambda: BrokenSession())

    response = anonymous_client.get("/api/health/ready")

    assert response.status_code == 503
    assert response.json() == {"detail": "database_unavailable"}
