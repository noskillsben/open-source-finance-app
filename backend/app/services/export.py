"""The one-way export (DESIGN.md § Architecture Overview -> The export is one zip of CSVs).

One CSV per stored table, discovered from the SQLAlchemy metadata so a new table is exported with
no code change. Every row goes out: archived rows and future-dated rows included; the picker date
filters nothing. `owner_id` is left out; each foreign key gets the referenced row's name beside its
id; `*_cents` columns are written as exact dollars without the suffix.
"""
import csv
import io
import zipfile
from datetime import date, datetime, timezone

from sqlalchemy import MetaData, Table
from sqlalchemy.orm import Session

from app.db import Base

SKIPPED_TABLES = {"alembic_version"}
SKIPPED_COLUMNS = {"owner_id"}
BOM = "\ufeff"


def dollars(cents: int) -> str:
    """Integer cents -> plain dollars, exact (integer arithmetic only): -5 -> '-0.05'."""
    sign = "-" if cents < 0 else ""
    whole, rem = divmod(abs(cents), 100)
    return f"{sign}{whole}.{rem:02d}"


def _cell(value, is_cents: bool) -> str:
    if value is None:
        return ""
    if is_cents:
        return dollars(int(value))
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, datetime):
        if value.tzinfo is not None:
            value = value.astimezone(timezone.utc)
        return value.isoformat()
    if isinstance(value, date):
        return value.isoformat()
    return str(value)


def _is_cents(name: str) -> bool:
    # A bare `cents` column (the line amounts) is money too; it is written as `amount`.
    return name == "cents" or name.endswith("_cents")


def _dollar_header(name: str) -> str:
    return "amount" if name == "cents" else name[: -len("_cents")]


def _name_column(table: Table):
    return table.c.get("name")


def _table_csv(session: Session, table: Table) -> str:
    # (column, is_cents) for plain columns; FK columns get a name lookup beside them.
    columns = [c for c in table.columns if c.name not in SKIPPED_COLUMNS]
    lookups: dict[str, dict] = {}  # fk column name -> {referenced id: name}
    header: list[str] = []
    for col in columns:
        header.append(_dollar_header(col.name) if _is_cents(col.name) else col.name)
        fks = list(col.foreign_keys)
        if fks:
            target = fks[0].column
            name_col = _name_column(target.table)
            if name_col is not None:
                base = col.name[:-3] if col.name.endswith("_id") else col.name
                header.append(f"{base}_name")
                rows = session.execute(target.table.select().with_only_columns(target, name_col)).all()
                lookups[col.name] = {r[0]: r[1] for r in rows}

    out = io.StringIO(newline="")
    writer = csv.writer(out, lineterminator="\r\n")
    writer.writerow(header)
    order = list(table.primary_key.columns)
    for row in session.execute(table.select().order_by(*order)).mappings():
        cells: list[str] = []
        for col in columns:
            value = row[col.name]
            cells.append(_cell(value, _is_cents(col.name)))
            if col.name in lookups:
                cells.append(_cell(lookups[col.name].get(value), False))
        writer.writerow(cells)
    return out.getvalue()


def build_export(session: Session, metadata: MetaData | None = None) -> bytes:
    """The zip, in memory: one `<table>.csv` per table in the metadata, UTF-8 with a BOM."""
    metadata = metadata if metadata is not None else Base.metadata
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        for table in metadata.sorted_tables:
            if table.name in SKIPPED_TABLES:
                continue
            archive.writestr(f"{table.name}.csv", (BOM + _table_csv(session, table)).encode("utf-8"))
    return buffer.getvalue()
