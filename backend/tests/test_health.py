"""Smoke test: the app imports and the health route answers. Uses a stub session so no database is needed."""
from fastapi.testclient import TestClient

from app.db import get_session
from app.main import app


class _StubSession:
    def execute(self, *_args, **_kwargs):
        return None


def _stub_session():
    yield _StubSession()


def test_health_reports_ok():
    app.dependency_overrides[get_session] = _stub_session
    try:
        response = TestClient(app).get("/api/health")
    finally:
        app.dependency_overrides.clear()
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["database"] == "ok"
    assert body["app_mode"] in ("single_user", "multi_user")
