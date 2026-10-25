"""The pre-migrate dump's two decisions, kept out of the entrypoint shell so tests reach them.

`python -m app.pre_migrate pending` prints `pending` when the database is not at the code's head
revision (a fresh database counts) and `current` when there is nothing to migrate; the entrypoint
dumps only on `pending`. `python -m app.pre_migrate prune` keeps the newest five `pre-migrate-`
files in BACKUP_DIR. Other prefixes are never touched (DESIGN.md § Backups, decision log 2026-10-25).
"""
import re
import sys
from pathlib import Path

from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine, inspect, text

from app.config import settings
from app.services.backups import backup_dir

KEEP = 5
_PRE_MIGRATE = re.compile(r"^pre-migrate-\d{8}T\d{6}Z\.sql$")


def migration_pending() -> bool:
    heads = set(ScriptDirectory.from_config(Config("alembic.ini")).get_heads())
    engine = create_engine(settings.database_url)
    try:
        with engine.connect() as conn:
            if "alembic_version" not in inspect(conn).get_table_names():
                return True
            current = {row[0] for row in conn.execute(text("SELECT version_num FROM alembic_version"))}
        return current != heads
    finally:
        engine.dispose()


def prune_pre_migrate(directory: Path | None = None, keep: int = KEEP) -> list[str]:
    """Delete all but the newest `keep` `pre-migrate-` files (newest by the stamp in the name); returns deleted names."""
    directory = directory if directory is not None else backup_dir()
    try:
        names = sorted((e.name for e in directory.iterdir() if _PRE_MIGRATE.match(e.name) and e.is_file()), reverse=True)
    except OSError:
        return []
    deleted = []
    for name in names[keep:]:
        (directory / name).unlink(missing_ok=True)
        deleted.append(name)
    return deleted


def main(argv: list[str]) -> int:
    if argv == ["pending"]:
        print("pending" if migration_pending() else "current")
        return 0
    if argv == ["prune"]:
        for name in prune_pre_migrate():
            print(f"pruned old pre-migrate backup {name}")
        return 0
    print("usage: python -m app.pre_migrate pending|prune", file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
