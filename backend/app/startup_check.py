"""Refuse to start if the database is newer than the code.

Run before `alembic upgrade head`. If the database's current revision is not one this code knows,
the code is older than the data — stop, rather than run migrations backwards or guess.
"""
import sys

from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine, inspect, text

from app.config import settings
from app.services.backups import latest_backup, restore_command


def known_revisions() -> set[str]:
    return {rev.revision for rev in ScriptDirectory.from_config(Config("alembic.ini")).walk_revisions()}


def _has_ledger_data(conn) -> bool:
    """Seed rows are not ledger data: only a row in `transaction` counts."""
    tables = set(inspect(conn).get_table_names())
    if "alembic_version" not in tables or "transaction" not in tables:
        return False
    return conn.execute(text('SELECT EXISTS (SELECT 1 FROM "transaction")')).scalar_one()


def _refuse_if_empty_with_backups(conn) -> bool:
    if _has_ledger_data(conn):
        return False
    backup = latest_backup()
    if backup is None:
        return False
    print(f"startup_check: the database holds no transactions, but a backup exists: {backup.name}. "
          "Refusing to start as a fresh install. Restore that backup by running this command "
          f"(see the Backups section of docs/user/README.md): {restore_command(backup.name)}  "
          "To start over on purpose, move the nightly backup files out of the backups folder.", file=sys.stderr)
    return True


def main() -> int:
    known = known_revisions()
    engine = create_engine(settings.database_url)
    with engine.connect() as conn:
        if "alembic_version" not in inspect(conn).get_table_names():
            if _refuse_if_empty_with_backups(conn):
                return 1
            print("startup_check: fresh database")
            return 0
        current = {row[0] for row in conn.execute(text("SELECT version_num FROM alembic_version"))}
    unknown = current - known
    if unknown:
        print(f"startup_check: database is at revision(s) {sorted(unknown)} which this code does not know. "
              "The data is newer than the code — refusing to start.", file=sys.stderr)
        return 1
    with engine.connect() as conn:
        if _refuse_if_empty_with_backups(conn):
            return 1
    print(f"startup_check: database at {sorted(current) or 'base'}, code knows {len(known)} revision(s)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
