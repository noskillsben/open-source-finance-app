"""SQLAlchemy models — the stored shape. Pydantic schemas (app/schemas.py) are the API shape; they never cross.

Empty on purpose: tables arrive with the issues that build them, each as an Alembic revision.
Import this module wherever Base.metadata must know every table (alembic/env.py does).
"""
from app.db import Base  # noqa: F401
