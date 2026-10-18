"""DESIGN.md § Architecture Overview -> Backups are one mechanism. The Settings button serves the
newest `nightly-<stamp>.sql`; these tests use a tmp dir, never the app's backups.
"""
import datetime
import os

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services.backups import latest_backup

client = TestClient(app)


def touch(directory, name, text="-- dump\n"):
    path = directory / name
    path.write_text(text)
    return path


def test_picks_newest_by_stamp_not_mtime(tmp_path):
    newer = touch(tmp_path, "nightly-20261019T030000Z.sql")
    older = touch(tmp_path, "nightly-20261018T030000Z.sql")
    os.utime(newer, (1, 1))  # oldest mtime, newest stamp
    os.utime(older, (2_000_000_000, 2_000_000_000))
    backup = latest_backup(tmp_path)
    assert backup.name == "nightly-20261019T030000Z.sql"
    assert backup.taken_at == datetime.datetime(2026, 10, 19, 3, 0, 0, tzinfo=datetime.timezone.utc)


def test_ignores_files_that_are_not_nightly_backups(tmp_path):
    touch(tmp_path, ".nightly-20261020T030000Z.tmp")
    touch(tmp_path, "pre-migrate-20261020T030000Z.sql")
    touch(tmp_path, "manual-before-change.sql")
    touch(tmp_path, "nightly-20261017T030000Z.sql")
    assert latest_backup(tmp_path).name == "nightly-20261017T030000Z.sql"


def test_empty_or_missing_directory(tmp_path):
    assert latest_backup(tmp_path) is None
    assert latest_backup(tmp_path / "nope") is None


@pytest.fixture()
def backup_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("BACKUP_DIR", str(tmp_path))
    return tmp_path


def test_info_and_download(backup_dir):
    touch(backup_dir, "nightly-20261019T030000Z.sql", "hello dump")
    info = client.get("/api/backups/latest")
    assert info.status_code == 200
    assert info.json() == {"name": "nightly-20261019T030000Z.sql", "taken_at": "2026-10-19T03:00:00Z"}
    assert str(backup_dir) not in info.text

    res = client.get("/api/backups/latest/download")
    assert res.status_code == 200
    assert res.content == b"hello dump"
    disposition = res.headers["content-disposition"]
    assert "attachment" in disposition and "nightly-20261019T030000Z.sql" in disposition


def test_none_yet(backup_dir):
    assert client.get("/api/backups/latest").json() == {"name": None, "taken_at": None}
    res = client.get("/api/backups/latest/download")
    assert res.status_code == 404
    assert "03:00 UTC" in res.json()["detail"]
