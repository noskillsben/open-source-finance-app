"""The steps that bring a database to the current code: migrations, seed, data steps.

Run by the container entrypoint after its pre-migrate dump, and by `app.restore` after it loads
a backup, so the list lives in one place. The database is whichever `settings.database_url` says
when the function is called.
"""
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.config import settings
from app.data_steps import backfill_opening_adjustments
from app.seed import seed_defaults


def run() -> None:
    command.upgrade(Config("alembic.ini"), "head")
    engine = create_engine(settings.database_url)
    try:
        with Session(engine) as session:
            try:
                inserted = seed_defaults(session)
                session.commit()
                print(f"seed: inserted {inserted} default(s)")
                written = backfill_opening_adjustments(session)
                session.commit()
                print(f"data_steps: wrote {written} opening adjustment(s)")
            except Exception:
                session.rollback()
                raise
    finally:
        engine.dispose()


if __name__ == "__main__":
    run()
