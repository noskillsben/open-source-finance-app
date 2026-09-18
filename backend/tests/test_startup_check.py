"""app.startup_check.main() against the throwaway test database (issue #15, moved off the app's
own database by issue #66): a fresh database, a database at the current head, and a database at
an unknown (newer-than-code) revision.

Uses a raw connection on `test_engine` rather than the rollback-wrapped `db_session` fixture --
these tests do DDL and rewrite the alembic_version table itself, and must restore the real
revision row afterwards so later tests in the session still see a consistent database.
`override_database_url` points `main()` (which reads `settings.database_url` directly) at the
throwaway database for the duration of the call.
"""
from sqlalchemy import text

from app.startup_check import main
from conftest import override_database_url


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
