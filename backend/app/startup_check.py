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


HELD_CODE = 10  # exit code of main(): start the server held on the restore screen (DESIGN.md § Backups)


def _is_held_state(conn) -> bool:
    """The one rule: no transactions while at least one nightly backup exists."""
    return not _has_ledger_data(conn) and latest_backup() is not None


def check() -> str:
    """Decide the start once: "fresh", "ok", "held" or "refuse" (database newer than the code)."""
    known = known_revisions()
    engine = create_engine(settings.database_url)
    try:
        with engine.connect() as conn:
            if "alembic_version" not in inspect(conn).get_table_names():
                return "held" if _is_held_state(conn) else "fresh"
            current = {row[0] for row in conn.execute(text("SELECT version_num FROM alembic_version"))}
        if current - known:
            return "refuse"
        with engine.connect() as conn:
            return "held" if _is_held_state(conn) else "ok"
    finally:
        engine.dispose()


def is_held() -> bool:
    """Whether the running app should open held: the same rule main() uses, asked again by the server."""
    try:
        return check() == "held"
    except Exception:  # an unreachable database is not a held start; the health route reports it
        return False


def main() -> int:
    outcome = check()
    if outcome == "refuse":
        print("startup_check: database is at a revision this code does not know. "
              "The data is newer than the code — refusing to start.", file=sys.stderr)
        return 1
    if outcome == "held":
        backup = latest_backup()
        print(f"startup_check: the database holds no transactions, but a backup exists: {backup.name}. "
              "Starting held: the app opens on the restore screen, with no migrations, seed or data steps. "
              "Restore from Settings in the browser, or by running this command "
              f"(see the Backups section of docs/user/README.md): {restore_command(backup.name)}  "
              "To start over on purpose, move the nightly backup files out of the backups folder and restart.",
              file=sys.stderr)
        return HELD_CODE
    print("startup_check: fresh database" if outcome == "fresh" else "startup_check: database is at a known revision")
    return 0


if __name__ == "__main__":
    sys.exit(main())
