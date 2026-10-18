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


def _run(tmp_path, dump_ok=True, keep_env=None):
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
