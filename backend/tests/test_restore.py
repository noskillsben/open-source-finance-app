"""app.restore against throwaway databases and a temp BACKUP_DIR (issue #370). Never the app's database."""
import fcntl
import os
import subprocess

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url

from app import restore
from app.services.backups import LOCK_NAME, latest_backup, restore_command
from conftest import migrate, override_database_url

FIXTURES = os.path.join(os.path.dirname(__file__), "fixtures")


@pytest.fixture(autouse=True)
def backups(tmp_path, monkeypatch):
    directory = tmp_path / "backups"
    directory.mkdir()
    monkeypatch.setenv("BACKUP_DIR", str(directory))
    return directory


def _dump_to(url, path):
    u = make_url(url)
    with open(path, "wb") as out:
        subprocess.run(["pg_dump", "-h", u.host, "-p", str(u.port or 5432), "-U", u.username, u.database],
                       env={**os.environ, "PGPASSWORD": u.password}, check=True, stdout=out)


def _sql(url, statement):
    engine = create_engine(url)
    try:
        with engine.begin() as conn:
            conn.execute(text(statement))
    finally:
        engine.dispose()


def _scalar(url, statement):
    engine = create_engine(url)
    try:
        with engine.connect() as conn:
            return conn.execute(text(statement)).scalar()
    finally:
        engine.dispose()


def _head_dump(url, backups, name="nightly-20261019T030000Z.sql"):
    """A populated head-schema dump of a throwaway database, written into the backups folder."""
    migrate(url, "head")
    _sql(url, "INSERT INTO payee (name, created_on, owner_id) VALUES ('Corner Shop', '2026-01-01', 1)")
    _dump_to(url, backups / name)
    return name


def _run(url, name):
    with override_database_url(url):
        return restore.main([name])


def _pre_restore(backups):
    return sorted(p.name for p in backups.glob("pre-restore-*.sql"))


def _listing(backups):
    return sorted(p.name for p in backups.iterdir())


def test_restore_into_an_empty_database(throwaway_database, backups):
    name = _head_dump(throwaway_database, backups)
    _sql(throwaway_database, "DROP SCHEMA public CASCADE; CREATE SCHEMA public;")
    assert _run(throwaway_database, name) == 0
    assert _scalar(throwaway_database, "SELECT count(*) FROM payee WHERE name = 'Corner Shop'") == 1
    assert len(_pre_restore(backups)) == 1


def test_restore_over_a_populated_database_replaces_it_and_keeps_an_undo(throwaway_database, backups):
    name = _head_dump(throwaway_database, backups)
    _sql(throwaway_database, "INSERT INTO payee (name, created_on, owner_id) VALUES ('Later Payee', '2026-02-01', 1)")
    assert _run(throwaway_database, name) == 0
    assert _scalar(throwaway_database, "SELECT count(*) FROM payee WHERE name = 'Later Payee'") == 0
    assert _scalar(throwaway_database, "SELECT count(*) FROM payee WHERE name = 'Corner Shop'") == 1
    (undo,) = _pre_restore(backups)
    assert "Later Payee" in (backups / undo).read_text()
    assert latest_backup().name == name  # pre-restore files are never "the latest backup"


def test_restore_works_while_another_connection_is_open(throwaway_database, backups):
    name = _head_dump(throwaway_database, backups)
    other_engine = create_engine(throwaway_database)
    other = other_engine.connect()
    try:
        other.execute(text("SELECT count(*) FROM payee")).scalar()
        other.commit()
        assert _run(throwaway_database, name) == 0
    finally:
        other.close()
        other_engine.dispose()


def test_older_revision_dump_comes_up_to_head(throwaway_database, backups):
    migrate(throwaway_database, "769d6a847874")
    with open(os.path.join(FIXTURES, "208c0d25ef38.sql")) as handle:
        _sql(throwaway_database, handle.read())
    # The fixture inserts explicit ids; a real dump carries setval lines, so mirror them.
    _sql(throwaway_database, """
        DO $$ DECLARE t text; BEGIN
          FOR t IN SELECT table_name FROM information_schema.columns
                   WHERE table_schema = 'public' AND column_name = 'id' AND column_default LIKE 'nextval%' LOOP
            EXECUTE format('SELECT setval(pg_get_serial_sequence(%L, ''id''), COALESCE((SELECT max(id) FROM %I), 1))', t, t);
          END LOOP;
        END $$""")
    _dump_to(throwaway_database, backups / "nightly-20260101T030000Z.sql")
    _sql(throwaway_database, "DROP SCHEMA public CASCADE; CREATE SCHEMA public;")
    assert _run(throwaway_database, "nightly-20260101T030000Z.sql") == 0
    assert _scalar(throwaway_database, "SELECT version_num FROM alembic_version") != "769d6a847874"
    assert _scalar(throwaway_database, "SELECT name FROM account WHERE id = 1") == "Chequing"
    assert _scalar(throwaway_database, "SELECT cents FROM account_line WHERE id = 1") == -8000


def _assert_refused(url, backups, name, capsys, fragment):
    before = _scalar(url, "SELECT count(*) FROM payee")
    files = _listing(backups)
    assert _run(url, name) == 1
    assert fragment in capsys.readouterr().err
    assert _scalar(url, "SELECT count(*) FROM payee") == before
    assert _listing(backups) == files  # no pre-restore file, nothing written


def test_incomplete_dump_is_refused(throwaway_database, backups, capsys):
    name = _head_dump(throwaway_database, backups)
    (backups / name).write_text((backups / name).read_text().replace("-- PostgreSQL database dump complete", ""))
    _assert_refused(throwaway_database, backups, name, capsys, "cut short")


def test_shell_escape_is_refused_but_copy_data_starting_with_backslash_is_not(throwaway_database, backups, capsys):
    name = _head_dump(throwaway_database, backups)
    content = (backups / name).read_text()
    assert "\\N" in content  # NULLs in COPY data are lines or fields starting with a backslash
    restore.inspect_dump(backups / name)  # accepted
    bad = "nightly-20261020T030000Z.sql"
    (backups / bad).write_text(content.replace("SET statement_timeout = 0;", "SET statement_timeout = 0;\n\\! echo hi", 1))
    _assert_refused(throwaway_database, backups, bad, capsys, "psql command")


def test_newer_schema_is_refused(throwaway_database, backups, capsys):
    name = _head_dump(throwaway_database, backups)
    head = _scalar(throwaway_database, "SELECT version_num FROM alembic_version")
    (backups / name).write_text((backups / name).read_text().replace(head, "ffffffffffff", 1))
    _assert_refused(throwaway_database, backups, name, capsys, "Update the app first")


def test_missing_file_and_paths_are_refused(throwaway_database, backups, capsys):
    _head_dump(throwaway_database, backups)
    _assert_refused(throwaway_database, backups, "nope.sql", capsys, "no file")
    _assert_refused(throwaway_database, backups, "../etc/passwd", capsys, "no paths")


def test_busy_lock_is_refused(throwaway_database, backups, capsys):
    name = _head_dump(throwaway_database, backups)
    with open(backups / LOCK_NAME, "a") as held:
        fcntl.flock(held, fcntl.LOCK_EX | fcntl.LOCK_NB)
        before = _listing(backups)
        assert _run(throwaway_database, name) == 1
        assert "already running" in capsys.readouterr().err
        assert _listing(backups) == before


def test_failed_load_leaves_the_old_data(throwaway_database, backups, capsys):
    name = _head_dump(throwaway_database, backups)
    (backups / name).write_text((backups / name).read_text().replace(
        "SET statement_timeout = 0;", "SET statement_timeout = 0;\nSELECT * FROM no_such_table;", 1))
    _sql(throwaway_database, "INSERT INTO payee (name, created_on, owner_id) VALUES ('Keep Me', '2026-02-01', 1)")
    assert _run(throwaway_database, name) == 1
    assert "rolled back" in capsys.readouterr().err
    assert _scalar(throwaway_database, "SELECT count(*) FROM payee WHERE name = 'Keep Me'") == 1


def test_restore_command_names_the_file(monkeypatch):
    monkeypatch.delenv("APP_ENV", raising=False)
    assert restore_command("nightly-20261019T030000Z.sql") == (
        "docker compose run --rm --entrypoint python backend -m app.restore nightly-20261019T030000Z.sql")
    monkeypatch.setenv("APP_ENV", "production")
    assert "-f docker-compose.prod.yml run" in restore_command("x.sql")
