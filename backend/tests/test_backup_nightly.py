"""backup-nightly.sh in single-run mode, with a stub pg_dump and a temp BACKUP_DIR. No database is touched."""
import os
import subprocess
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "backup-nightly.sh"
COMPLETE = "-- PostgreSQL database dump complete"


def _stub(bin_dir: Path, body: str):
    bin_dir.mkdir(exist_ok=True)
    stub = bin_dir / "pg_dump"
    stub.write_text("#!/bin/sh\n" + body)
    stub.chmod(0o755)


def _psql(bin_dir: Path, mode: str):
    """mode: 'data' (transactions exist), 'empty' (no transaction table or no rows), 'fail' (check cannot run)."""
    bin_dir.mkdir(exist_ok=True)
    stub = bin_dir / "psql"
    body = {"data": "echo t\n", "empty": "echo f\n", "fail": "echo 'connection refused' >&2\nexit 2\n"}[mode]
    stub.write_text("#!/bin/sh\n" + body)
    stub.chmod(0o755)


def _run(tmp_path, dump_ok=True, keep_env=None, db="data"):
    _psql(tmp_path / "bin", db)
    backups = tmp_path / "backups"
    backups.mkdir(exist_ok=True)
    if dump_ok:
        _stub(tmp_path / "bin", f"echo 'CREATE TABLE t();'\necho '{COMPLETE}'\n")
    else:
        _stub(tmp_path / "bin", "echo 'CREATE TABLE t();'\n")
    env = {**os.environ, "PATH": f"{tmp_path / 'bin'}:{os.environ['PATH']}", "BACKUP_DIR": str(backups),
           "POSTGRES_USER": "u", "POSTGRES_PASSWORD": "p", "POSTGRES_DB": "d"}
    if keep_env:
        env["KEEP"] = keep_env
    r = subprocess.run(["sh", str(SCRIPT), "once"], env=env, capture_output=True, text=True)
    return r, backups


def test_writes_a_nightly_file(tmp_path):
    r, backups = _run(tmp_path)
    assert r.returncode == 0, r.stderr
    files = list(backups.glob("nightly-*.sql"))
    assert len(files) == 1
    assert COMPLETE in files[0].read_text()
    assert not list(backups.glob(".nightly-*.tmp"))


def test_incomplete_dump_is_rejected_and_old_files_untouched(tmp_path):
    backups = tmp_path / "backups"
    backups.mkdir()
    old = backups / "nightly-20200101T030000Z.sql"
    old.write_text("old\n" + COMPLETE + "\n")
    r, _ = _run(tmp_path, dump_ok=False)
    assert r.returncode != 0
    assert "FAILED" in r.stderr
    assert [p.name for p in backups.iterdir()] == [old.name]
    assert old.read_text().startswith("old")


def test_keeps_exactly_14_and_leaves_pre_migrate_alone(tmp_path):
    backups = tmp_path / "backups"
    backups.mkdir()
    for d in range(1, 21):
        (backups / f"nightly-202001{d:02d}T030000Z.sql").write_text(COMPLETE)
    pre = backups / "pre-migrate-20190101T000000Z.sql"
    pre.write_text("x")
    r, _ = _run(tmp_path)
    assert r.returncode == 0, r.stderr
    nightly = sorted(p.name for p in backups.glob("nightly-*.sql"))
    assert len(nightly) == 14
    assert "nightly-20200101T030000Z.sql" not in nightly
    assert nightly[-1] > "nightly-20200120T030000Z.sql"  # the new one is kept
    assert pre.exists()


def _snapshot(backups):
    return {p.name: p.read_text() for p in backups.iterdir()}


def _seed_twenty(backups):
    backups.mkdir(exist_ok=True)
    for d in range(1, 16):
        (backups / f"nightly-202001{d:02d}T030000Z.sql").write_text(COMPLETE)


def test_empty_database_with_backups_writes_and_prunes_nothing(tmp_path):
    backups = tmp_path / "backups"
    _seed_twenty(backups)  # 15 files: a normal run would prune the oldest
    before = _snapshot(backups)
    r, _ = _run(tmp_path, db="empty")
    assert r.returncode == 3
    assert "database is empty while backups exist" in r.stderr
    assert "Backups section of the user guide" in r.stderr
    assert _snapshot(backups) == before


def test_empty_database_with_empty_folder_writes_a_backup(tmp_path):
    r, backups = _run(tmp_path, db="empty")
    assert r.returncode == 0, r.stderr
    assert len(list(backups.glob("nightly-*.sql"))) == 1


def test_database_with_transactions_writes_and_prunes(tmp_path):
    backups = tmp_path / "backups"
    _seed_twenty(backups)
    r, _ = _run(tmp_path, db="data")
    assert r.returncode == 0, r.stderr
    nightly = sorted(p.name for p in backups.glob("nightly-*.sql"))
    assert len(nightly) == 14
    assert "nightly-20200101T030000Z.sql" not in nightly


def test_failed_emptiness_check_is_a_failure_and_leaves_the_folder_alone(tmp_path):
    backups = tmp_path / "backups"
    _seed_twenty(backups)
    before = _snapshot(backups)
    r, _ = _run(tmp_path, db="fail")
    assert r.returncode == 1
    assert "FAILED" in r.stderr
    assert _snapshot(backups) == before
