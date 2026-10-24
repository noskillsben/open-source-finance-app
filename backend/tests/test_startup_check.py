"""app.startup_check.main() against the throwaway test database (issue #15, moved off the app's
own database by issue #66): a fresh database, a database at the current head, and a database at
an unknown (newer-than-code) revision.

Uses a raw connection on `test_engine` rather than the rollback-wrapped `db_session` fixture --
these tests do DDL and rewrite the alembic_version table itself, and must restore the real
revision row afterwards so later tests in the session still see a consistent database.
`override_database_url` points `main()` (which reads `settings.database_url` directly) at the
throwaway database for the duration of the call.
"""
from contextlib import contextmanager

import pytest
from sqlalchemy import text

from app.startup_check import main
from conftest import override_database_url


@pytest.fixture(autouse=True)
def backup_dir(tmp_path, monkeypatch):
    """Never look at real backups: every test gets its own empty BACKUP_DIR."""
    monkeypatch.setenv("BACKUP_DIR", str(tmp_path))
    return tmp_path


def _touch(directory, *names):
    for name in names:
        (directory / name).write_text("-- dump")


@contextmanager
def _ledger_has_a_row(test_engine):
    """Swap `transaction` for a one-row stand-in (the check only asks whether any row exists)."""
    with test_engine.begin() as conn:
        conn.execute(text('ALTER TABLE "transaction" RENAME TO transaction_real'))
        conn.execute(text('CREATE TABLE "transaction" (id integer)'))
        conn.execute(text('INSERT INTO "transaction" VALUES (1)'))
    try:
        yield
    finally:
        with test_engine.begin() as conn:
            conn.execute(text('DROP TABLE "transaction"'))
            conn.execute(text('ALTER TABLE transaction_real RENAME TO "transaction"'))


def test_fresh_database_returns_0(test_engine, test_database_url):
    with test_engine.begin() as conn:
        conn.execute(text("ALTER TABLE alembic_version RENAME TO alembic_version_backup"))
    try:
        with override_database_url(test_database_url):
            assert main() == 0
    finally:
        with test_engine.begin() as conn:
            conn.execute(text("ALTER TABLE alembic_version_backup RENAME TO alembic_version"))


def test_database_at_head_returns_0(test_engine, test_database_url):
    with override_database_url(test_database_url):
        assert main() == 0


def test_unknown_revision_returns_1(test_engine, test_database_url):
    with test_engine.begin() as conn:
        original = conn.execute(text("SELECT version_num FROM alembic_version")).scalar_one()
        conn.execute(
            text("UPDATE alembic_version SET version_num = :v"),
            {"v": "fabricated_unknown_revision"},
        )
    try:
        with override_database_url(test_database_url):
            assert main() == 1
    finally:
        with test_engine.begin() as conn:
            conn.execute(
                text("UPDATE alembic_version SET version_num = :v"),
                {"v": original},
            )


def test_populated_database_with_nightly_backup_returns_0(test_engine, test_database_url, backup_dir):
    _touch(backup_dir, "nightly-20261019T030000Z.sql")
    with _ledger_has_a_row(test_engine), override_database_url(test_database_url):
        assert main() == 0


def test_empty_database_without_nightly_backup_returns_0(test_engine, test_database_url, backup_dir):
    _touch(backup_dir, "pre-migrate-20261019T030000Z.sql", "test-20261019T030000Z.sql",
           "manual-x.sql", ".nightly-20261019T030000Z.tmp")
    with override_database_url(test_database_url):
        assert main() == 0


def test_empty_database_with_nightly_backup_returns_1_naming_newest(
        test_engine, test_database_url, backup_dir, capsys):
    _touch(backup_dir, "nightly-20261018T030000Z.sql", "nightly-20261019T030000Z.sql")
    with override_database_url(test_database_url):
        assert main() == 1
    err = capsys.readouterr().err
    assert "nightly-20261019T030000Z.sql" in err
    assert "nightly-20261018T030000Z.sql" not in err
    assert "Backups" in err


def test_never_seeded_database_with_nightly_backup_returns_1(test_engine, test_database_url, backup_dir):
    """No alembic_version at all (a wiped volume) is empty too."""
    _touch(backup_dir, "nightly-20261019T030000Z.sql")
    with test_engine.begin() as conn:
        conn.execute(text("ALTER TABLE alembic_version RENAME TO alembic_version_backup"))
    try:
        with override_database_url(test_database_url):
            assert main() == 1
    finally:
        with test_engine.begin() as conn:
            conn.execute(text("ALTER TABLE alembic_version_backup RENAME TO alembic_version"))


def test_refusal_prints_the_restore_command_with_the_newest_name(test_engine, test_database_url, backup_dir, capsys):
    _touch(backup_dir, "nightly-20261018T030000Z.sql", "nightly-20261019T030000Z.sql",
           "pre-restore-20261020T030000Z.sql")
    with override_database_url(test_database_url):
        assert main() == 1
    err = capsys.readouterr().err
    assert "-m app.restore nightly-20261019T030000Z.sql" in err
    assert "pre-restore" not in err
