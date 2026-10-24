"""POST /api/backups/upload adds a file to the list and nothing else (DESIGN.md § Backups are one mechanism).
Tests use a tmp backups folder; the restore test uses a throwaway database.
"""
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services.backups import latest_backup, list_backups
from conftest import override_database_url
from test_backup_nightly import COMPLETE, _run
from test_restore import _head_dump, _listing, _scalar, _sql

client = TestClient(app)
BODY = f"CREATE TABLE t();\n{COMPLETE}\n\\unrestrict abc\n".encode()


@pytest.fixture()
def folder(tmp_path, monkeypatch):
    directory = tmp_path / "backups"
    directory.mkdir()
    monkeypatch.setenv("BACKUP_DIR", str(directory))
    return directory


def _upload(data):
    return client.post("/api/backups/upload", content=data, headers={"Content-Type": "application/octet-stream"})


def test_complete_file_is_added_and_listed(folder):
    res = _upload(BODY)
    assert res.status_code == 200
    name = res.json()["name"]
    assert name.startswith("uploaded-") and name.endswith(".sql")
    assert (folder / name).read_bytes() == BODY
    assert [f["name"] for f in client.get("/api/backups").json()] == [name]
    assert _listing(folder) == [name]  # no temp file left


def test_file_without_the_marker_is_refused_and_leaves_nothing(folder):
    (folder / "nightly-20261019T030000Z.sql").write_text(COMPLETE)
    before = _listing(folder)
    for data in (b"CREATE TABLE t();\n", b""):
        res = _upload(data)
        assert 400 <= res.status_code < 500
        assert "cut short" in res.json()["detail"]
        assert _listing(folder) == before


def test_never_overwrites_a_file_with_the_same_name(folder):
    # Two uploads in the same second would pick the same name; the second is refused, the first kept.
    first = _upload(BODY).json()["name"]
    second = _upload(BODY + b"-- different\n")
    assert (folder / first).read_bytes() == BODY
    if second.status_code == 200:  # the clock ticked over between the two
        assert second.json()["name"] != first
    else:
        assert 400 <= second.status_code < 500
        assert _listing(folder) == [first]


def test_uploaded_file_restores_through_the_existing_endpoint(throwaway_database, folder):
    _head_dump(throwaway_database, folder, name="source.sql")
    data = (folder / "source.sql").read_bytes()
    (folder / "source.sql").unlink()
    name = _upload(data).json()["name"]
    _sql(throwaway_database, "DROP SCHEMA public CASCADE; CREATE SCHEMA public;")
    with override_database_url(throwaway_database):
        res = client.post(f"/api/backups/{name}/restore")
    assert res.status_code == 200, res.text
    assert _scalar(throwaway_database, "SELECT count(*) FROM payee WHERE name = 'Corner Shop'") == 1


def test_uploaded_files_are_not_nightly_to_latest_backup_or_the_empty_rule(tmp_path):
    backups = tmp_path / "backups"
    backups.mkdir()
    (backups / "uploaded-20260101T000000Z.sql").write_text(COMPLETE)
    assert latest_backup(backups) is None
    assert [b.name for b in list_backups(backups)] == ["uploaded-20260101T000000Z.sql"]
    # An empty database with only an uploaded file: not "backups exist", so the nightly backup is taken.
    r, _ = _run(tmp_path, db="empty")
    assert r.returncode == 0, r.stderr
    assert len(list(backups.glob("nightly-*.sql"))) == 1


def test_uploaded_file_is_not_pruned(tmp_path):
    backups = tmp_path / "backups"
    backups.mkdir()
    (backups / "uploaded-20200101T000000Z.sql").write_text(COMPLETE)
    for d in range(1, 16):
        (backups / f"nightly-202001{d:02d}T030000Z.sql").write_text(COMPLETE)
    r, _ = _run(tmp_path)
    assert r.returncode == 0, r.stderr
    assert (backups / "uploaded-20200101T000000Z.sql").exists()
    assert len(list(backups.glob("nightly-*.sql"))) == 14
