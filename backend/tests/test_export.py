"""DESIGN.md § Architecture Overview -> The export is one zip of CSVs, one way only."""
import csv
import datetime
import io
import zipfile

from fastapi.testclient import TestClient
from sqlalchemy import BigInteger, Column, MetaData, String, Table

from app.db import Base
from app.main import app
from app.models import Category, Payee
from app.services.accounts import create_account_with_opening_valuation
from app.services.export import build_export, dollars
from app.services.transactions import write_transaction

TODAY = datetime.date(2026, 3, 1)


def read_zip(data: bytes) -> dict[str, list[dict]]:
    out = {}
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        for name in z.namelist():
            raw = z.read(name)
            assert raw.startswith(b"\xef\xbb\xbf"), f"{name} has no BOM"
            out[name[: -len(".csv")]] = list(csv.DictReader(io.StringIO(raw.decode("utf-8-sig"))))
    return out


def test_dollars_exact_incl_negatives():
    assert dollars(-1234) == "-12.34"
    assert dollars(-5) == "-0.05"
    assert dollars(0) == "0.00"
    assert dollars(100) == "1.00"
    assert dollars(123456789012345678) == "1234567890123456.78"


def test_every_table_appears_without_alembic_version(db_session):
    files = read_zip(build_export(db_session))
    expected = {t.name for t in Base.metadata.sorted_tables} - {"alembic_version"}
    assert set(files) == expected
    assert "alembic_version" not in files


def test_a_table_added_to_metadata_appears_with_no_code_change(db_session):
    metadata = MetaData()
    for t in Base.metadata.tables.values():
        t.to_metadata(metadata)
    extra = Table("export_probe", metadata, Column("id", BigInteger, primary_key=True), Column("label", String))
    extra.create(db_session.connection())
    db_session.connection().execute(extra.insert().values(id=1, label="x"))
    files = read_zip(build_export(db_session, metadata))
    assert files["export_probe"] == [{"id": "1", "label": "x"}]


def test_rows_values_names_and_filters(db_session):
    account = create_account_with_opening_valuation(
        db_session, name="Chequing", created_on=TODAY, type="Chequing",
        on_budget=True, on_budget_floor_cents=0, opening_balance_cents=500_00,
    )
    groceries = Category(name="Groceries", created_on=TODAY, archived_on=datetime.date(2026, 4, 1))
    payee = Payee(name="Corner Store", created_on=TODAY)
    db_session.add_all([groceries, payee])
    db_session.flush()
    write_transaction(
        db_session, transaction=None, txn_date=datetime.date(2099, 1, 1), memo=None, payee_id=payee.id,
        account_lines=[{"account_id": account.id, "cents": -5}],
        category_lines=[{"category_id": groceries.id, "cents": -5}],
    )
    files = read_zip(build_export(db_session))

    cat = next(r for r in files["category"] if r["name"] == "Groceries")
    assert cat["archived_on"] == "2026-04-01"  # archived rows are present
    assert "owner_id" not in cat
    assert cat["seeded_key"] == ""  # null is an empty cell

    txn = next(r for r in files["transaction"] if r["date"] == "2099-01-01")  # future-dated present
    assert txn["payee_id"] == str(payee.id)
    assert txn["payee_name"] == "Corner Store"
    assert txn["paid_by_payee_id"] == "" and txn["paid_by_payee_name"] == ""
    assert txn["shared_total"] == ""
    assert all("owner_id" not in rows[0] for rows in files.values() if rows)

    line = next(r for r in files["category_line"] if r["category_name"] == "Groceries")
    assert line["category_id"] == str(groceries.id)
    assert line["amount"] == "-0.05"
    acct_line = next(r for r in files["account_line"] if r["account_id"] == str(account.id) and r["amount"] == "-0.05")
    assert acct_line["account_name"] == "Chequing"
    assert acct_line["budget"] == "-0.05"
    opening = next(r for r in files["account"] if r["name"] == "Chequing")
    assert opening["on_budget_floor"] == "0.00"


def test_endpoint_streams_a_dated_zip():
    res = TestClient(app).get("/api/export")
    assert res.status_code == 200
    assert res.headers["content-type"] == "application/zip"
    assert res.headers["content-disposition"].startswith('attachment; filename="export-')
    assert zipfile.is_zipfile(io.BytesIO(res.content))
