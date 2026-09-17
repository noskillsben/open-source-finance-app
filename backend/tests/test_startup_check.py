"""app.startup_check.main() against the real test database (issue #15): a fresh database, a
database at the current head, and a database at an unknown (newer-than-code) revision.

Uses a raw connection rather than the rollback-wrapped `db_session` fixture — these tests do DDL
and rewrite the alembic_version table itself, and must restore the real revision row afterwards
so later tests (and alembic) still see a consistent database.
"""
from sqlalchemy import text

from app.db import engine
from app.startup_check import main


def test_fresh_database_returns_0():
    with engine.begin() as conn:
        conn.execute(text("ALTER TABLE alembic_version RENAME TO alembic_version_backup"))
    try:
        assert main() == 0
    finally:
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE alembic_version_backup RENAME TO alembic_version"))


def test_database_at_head_returns_0():
    assert main() == 0


def test_unknown_revision_returns_1():
    with engine.begin() as conn:
        original = conn.execute(text("SELECT version_num FROM alembic_version")).scalar_one()
        conn.execute(
            text("UPDATE alembic_version SET version_num = :v"),
            {"v": "fabricated_unknown_revision"},
        )
    try:
        assert main() == 1
    finally:
        with engine.begin() as conn:
            conn.execute(
                text("UPDATE alembic_version SET version_num = :v"),
                {"v": original},
            )
