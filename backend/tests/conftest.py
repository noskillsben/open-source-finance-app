"""Shared fixtures. Tests that need the database run against the real Postgres service
(`docker compose exec backend pytest`), each wrapped in a transaction that is rolled back
afterwards so tests never leave rows behind.
"""
import pytest

from app.db import engine
from sqlalchemy.orm import Session


@pytest.fixture()
def db_session():
    connection = engine.connect()
    transaction = connection.begin()
    session = Session(bind=connection)
    try:
        yield session
    finally:
        session.close()
        if transaction.is_active:
            transaction.rollback()
        connection.close()
