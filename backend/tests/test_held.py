"""The held state (#377): while the database is empty and nightly backups exist, only the restore
screen's endpoints answer; a successful Restore clears it. Uses a stub session so no database is needed."""
import pytest
from fastapi.testclient import TestClient

from app import held
from app.db import get_session
from app.main import app
from app.routers import backups as backups_router


class _StubSession:
    def execute(self, *_args, **_kwargs):
        return None


def _stub_session():
    yield _StubSession()


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("BACKUP_DIR", str(tmp_path))
    (tmp_path / "nightly-20261019T030000Z.sql").write_text("-- dump")
    app.dependency_overrides[get_session] = _stub_session
    held.set_held(True)
    try:
        yield TestClient(app)
    finally:
        held.set_held(False)
        app.dependency_overrides.clear()


def test_health_reports_held_and_newest_backup(client):
    body = client.get("/api/health").json()
    assert body["held"] is True
    assert body["latest_backup"] == "nightly-20261019T030000Z.sql"


def test_restore_screen_endpoints_answer(client):
    assert client.get("/api/backups").status_code == 200
    assert client.get("/api/backups/latest").status_code == 200
    assert client.get("/api/backups/latest/download").status_code == 200
    upload = client.post("/api/backups/upload", content=b"not finished")
    assert upload.status_code == 422  # the endpoint's own refusal, not the held one


def test_everything_else_is_refused_with_the_message(client):
    for method, path in [("get", "/api/accounts"), ("get", "/api/export"), ("post", "/api/backups")]:
        response = getattr(client, method)(path)
        assert response.status_code == 409, path
        assert response.json()["detail"] == "No data loaded — restore a backup from Settings"


def test_successful_restore_clears_held(client, monkeypatch):
    undone = type("P", (), {"name": "pre-restore-x.sql"})()
    monkeypatch.setattr(backups_router.restore_script, "restore", lambda name: undone)
    response = client.post("/api/backups/nightly-20261019T030000Z.sql/restore")
    assert response.status_code == 200
    assert held.held is False
    assert client.get("/api/health").json()["held"] is False


def test_failed_restore_stays_held(client, monkeypatch):
    def refuse(name):
        raise backups_router.restore_script.RestoreRefused("nope")
    monkeypatch.setattr(backups_router.restore_script, "restore", refuse)
    assert client.post("/api/backups/x.sql/restore").status_code == 409
    assert held.held is True


def test_not_held_leaves_everything_alone(client):
    held.set_held(False)
    assert client.get("/api/health").json()["held"] is False
