"""pay batch source

Revision ID: 06817c6fe779
Revises: b85e039f86ae
Create Date: 2026-09-24 10:00:00.000000

Data only (#126): the pay screen's earmark batch used to be written as ordinary "move" lines
carrying the paycheque's `transaction_id`. It now has its own source, "pay_batch", so the batch
can be replaced whole and the general move path can refuse it. Relabels exactly those lines;
pool draws and deposits (which also carry a transaction id) and plain moves are untouched.
Idempotent: a second run finds nothing left to relabel.
"""
from typing import Sequence, Union

from alembic import op


revision: str = '06817c6fe779'
down_revision: Union[str, None] = 'b85e039f86ae'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        "UPDATE earmark_line SET source = 'pay_batch' WHERE source = 'move' AND transaction_id IS NOT NULL"
    )


def downgrade() -> None:
    op.execute("UPDATE earmark_line SET source = 'move' WHERE source = 'pay_batch'")
