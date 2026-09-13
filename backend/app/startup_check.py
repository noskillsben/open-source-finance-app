"""Refuse to start if the database is newer than the code.

Run before `alembic upgrade head`. If the database's current revision is not one this code knows,
the code is older than the data — stop, rather than run migrations backwards or guess.
"""
import sys

from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine, inspect, text

from app.config import settings


def main() -> int:
    cfg = Config("alembic.ini")
    known = {rev.revision for rev in ScriptDirectory.from_config(cfg).walk_revisions()}
    engine = create_engine(settings.database_url)
    with engine.connect() as conn:
        if "alembic_version" not in inspect(conn).get_table_names():
            print("startup_check: fresh database")
            return 0
        current = {row[0] for row in conn.execute(text("SELECT version_num FROM alembic_version"))}
    unknown = current - known
    if unknown:
        print(f"startup_check: database is at revision(s) {sorted(unknown)} which this code does not know. "
              "The data is newer than the code — refusing to start.", file=sys.stderr)
        return 1
    print(f"startup_check: database at {sorted(current) or 'base'}, code knows {len(known)} revision(s)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
