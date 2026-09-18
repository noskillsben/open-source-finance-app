"""Shared fixtures. The suite runs against a throwaway database it creates and drops itself,
never against the app's own database (CLAUDE.md: tests never touch the app's database).

`test_database_url` creates one throwaway Postgres database for the whole session, migrates it
to head, and drops it at the end. `db_session` binds to it, keeping the per-test
transaction/rollback shape the tests already rely on. `throwaway_database` hands out a fresh,
unmigrated database per call, for the migration harness (test_migrations.py), which needs to
start each revision from its own down_revision rather than from head.
"""
import uuid
from contextlib import contextmanager

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from app.config import settings


def _admin_url() -> str:
    """The `postgres` maintenance database on the same server — the one connection that can
    CREATE/DROP another database (a database can't do that to itself).
    """
    return settings.database_url.rsplit("/", 1)[0] + "/postgres"


def _database_url(db_name: str) -> str:
    url = settings.database_url.rsplit("/", 1)[0] + f"/{db_name}"
    if url == settings.database_url:
        pytest.exit(
            "Refusing to run tests: the resolved test database URL is the app's own "
            "database (CLAUDE.md: tests never touch the app's database).",
            returncode=1,
        )
    return url


def _create_database(db_name: str) -> None:
    # CREATE DATABASE cannot run inside a transaction.
    admin_engine = create_engine(_admin_url(), isolation_level="AUTOCOMMIT")
    try:
        with admin_engine.connect() as connection:
            connection.execute(text(f'CREATE DATABASE "{db_name}"'))
    finally:
        admin_engine.dispose()


def _drop_database(db_name: str) -> None:
    admin_engine = create_engine(_admin_url(), isolation_level="AUTOCOMMIT")
    try:
        with admin_engine.connect() as connection:
            connection.execute(text(f'DROP DATABASE IF EXISTS "{db_name}" WITH (FORCE)'))
    finally:
        admin_engine.dispose()


@contextmanager
def override_database_url(url: str):
    """Point `settings.database_url` — the one authority `alembic/env.py` and
    `app.startup_check.main()` both read — at a throwaway database for the duration of a call.
    """
    original = settings.database_url_override
    settings.database_url_override = url
    try:
        yield
    finally:
        settings.database_url_override = original


def migrate(url: str, target: str) -> None:
    with override_database_url(url):
        command.upgrade(Config("alembic.ini"), target)


@pytest.fixture()
def throwaway_database():
    """A fresh, empty throwaway database. Callers migrate it to whichever revision they need."""
    db_name = f"test_{uuid.uuid4().hex[:16]}"
    url = _database_url(db_name)
    _create_database(db_name)
    try:
        yield url
    finally:
        _drop_database(db_name)


@pytest.fixture(scope="session")
def test_database_url():
    db_name = f"test_{uuid.uuid4().hex[:16]}"
    url = _database_url(db_name)
    _create_database(db_name)
    migrate(url, "head")
    try:
        yield url
    finally:
        _drop_database(db_name)


@pytest.fixture(scope="session")
def test_engine(test_database_url):
    engine = create_engine(test_database_url, pool_pre_ping=True)
    try:
        yield engine
    finally:
        engine.dispose()


@pytest.fixture()
def db_session(test_engine):
    connection = test_engine.connect()
    transaction = connection.begin()
    session = Session(bind=connection)
    try:
        yield session
    finally:
        session.close()
        if transaction.is_active:
            transaction.rollback()
        connection.close()
