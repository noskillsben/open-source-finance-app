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


# --- Back up now: runs backup-nightly.sh once with a stub pg_dump and a temp BACKUP_DIR ---

COMPLETE = "-- PostgreSQL database dump complete"


@pytest.fixture()
def stub_dump(tmp_path_factory, backup_dir, monkeypatch):
    bin_dir = tmp_path_factory.mktemp("bin")

    def make(ok=True):
        stub = bin_dir / "pg_dump"
        stub.write_text("#!/bin/sh\necho 'CREATE TABLE t();'\n" + (f"echo '{COMPLETE}'\n" if ok else ""))
        stub.chmod(0o755)

    monkeypatch.setenv("PATH", f"{bin_dir}:{os.environ['PATH']}")
    for key in ("POSTGRES_USER", "POSTGRES_PASSWORD", "POSTGRES_DB"):
        monkeypatch.setenv(key, "x")
    return make


def test_back_up_now_writes_a_file_the_latest_endpoint_returns(backup_dir, stub_dump):
    stub_dump()
    res = client.post("/api/backups")
    assert res.status_code == 200
    files = list(backup_dir.glob("nightly-*.sql"))
    assert len(files) == 1
    assert res.json()["name"] == files[0].name
    assert client.get("/api/backups/latest").json() == res.json()


def test_back_up_now_failed_dump_leaves_earlier_files(backup_dir, stub_dump):
    old = touch(backup_dir, "nightly-20200101T030000Z.sql", COMPLETE)
    stub_dump(ok=False)
    res = client.post("/api/backups")
    assert res.status_code == 500
    assert "Backup failed" in res.json()["detail"] and "Earlier backups were left alone" in res.json()["detail"]
    assert old.read_text() == COMPLETE
    assert [p.name for p in backup_dir.glob("nightly-*.sql")] == [old.name]


def test_back_up_now_while_one_is_running_is_409_and_runs_nothing(backup_dir, stub_dump):
    import fcntl

    stub_dump()
    with open(backup_dir / ".backup-now.lock", "a") as held:
        fcntl.flock(held, fcntl.LOCK_EX | fcntl.LOCK_NB)
        res = client.post("/api/backups")
    assert res.status_code == 409
    assert res.json()["detail"] == "A backup is already being taken"
    assert not list(backup_dir.glob("nightly-*.sql"))
