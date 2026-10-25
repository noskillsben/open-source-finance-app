"""app.pre_migrate: the pre-migrate dump happens only when a migration is pending, and the
`pre-migrate-` files are pruned to the newest five without touching any other prefix (issue #402).

Uses a raw connection on `test_engine` like test_startup_check, restoring the revision row afterwards.
"""
from sqlalchemy import text

from app.pre_migrate import KEEP, main, migration_pending, prune_pre_migrate
from conftest import override_database_url


def _set_revision(test_engine, value):
    with test_engine.begin() as conn:
        original = conn.execute(text("SELECT version_num FROM alembic_version")).scalar_one()
        conn.execute(text("UPDATE alembic_version SET version_num = :v"), {"v": value})
    return original


def test_nothing_pending_at_head(test_database_url, capsys):
    with override_database_url(test_database_url):
        assert migration_pending() is False
        assert main(["pending"]) == 0
    assert capsys.readouterr().out.strip() == "current"


def test_pending_when_database_is_behind_head(test_engine, test_database_url, capsys):
    original = _set_revision(test_engine, "an_older_revision")
    try:
        with override_database_url(test_database_url):
            assert migration_pending() is True
            main(["pending"])
        assert capsys.readouterr().out.strip() == "pending"
    finally:
        _set_revision(test_engine, original)


def test_pending_on_a_fresh_database(test_engine, test_database_url):
    with test_engine.begin() as conn:
        conn.execute(text("ALTER TABLE alembic_version RENAME TO alembic_version_backup"))
    try:
        with override_database_url(test_database_url):
            assert migration_pending() is True
    finally:
        with test_engine.begin() as conn:
            conn.execute(text("ALTER TABLE alembic_version_backup RENAME TO alembic_version"))


def test_prune_keeps_newest_five_pre_migrate_and_leaves_other_prefixes(tmp_path):
    pre = [f"pre-migrate-2026100{d}T000000Z.sql" for d in range(1, 8)]
    others = ["nightly-20260101T030000Z.sql", "pre-restore-20260101T000000Z.sql",
              "uploaded-20260101T000000Z.sql", "pre-migrate-notes.txt"]
    for name in pre + others:
        (tmp_path / name).write_text("-- dump")
    deleted = prune_pre_migrate(tmp_path)
    assert sorted(deleted) == pre[:2]
    assert sorted(p.name for p in tmp_path.iterdir() if p.name.startswith("pre-migrate-2")) == pre[2:]
    assert all((tmp_path / n).exists() for n in others)
    assert KEEP == 5


def test_prune_with_five_or_fewer_deletes_nothing(tmp_path):
    for d in range(1, 6):
        (tmp_path / f"pre-migrate-2026100{d}T000000Z.sql").write_text("x")
    assert prune_pre_migrate(tmp_path) == []
    assert prune_pre_migrate(tmp_path / "missing") == []
