"""one target pace

Revision ID: e9c3a7d15b84
Revises: d8b4f2a65c19
Create Date: 2026-10-02 10:00:00.000000

A Target is paced by its named pay or by its own cadence, never both (#198, DESIGN.md § Goals).
A live Target that has both keeps the pay and loses the cadence; the pay is what fills in on Pay,
so nothing there moves. Data only, no schema change. Idempotent: after one run no row matches.
"""
from typing import Sequence, Union

from alembic import op


revision: str = 'e9c3a7d15b84'
down_revision: Union[str, None] = 'd8b4f2a65c19'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        "UPDATE goal SET cadence = NULL, cadence_weeks = NULL "
        "WHERE kind = 'target' AND archived_on IS NULL AND income_stream_id IS NOT NULL AND cadence IS NOT NULL"
    )


def downgrade() -> None:
    pass  # the cleared cadence is not recoverable; restore from the pre-migrate pg_dump
