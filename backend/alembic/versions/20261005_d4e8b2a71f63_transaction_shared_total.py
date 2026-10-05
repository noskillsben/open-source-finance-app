"""transaction shared total

Revision ID: d4e8b2a71f63
Revises: c7d1f9a28e43
Create Date: 2026-10-05 18:00:00.000000

A bill someone else paid keeps its whole amount on the header, because no line carries it (#233,
DESIGN.md § Splits). One nullable column, no backfill: older bills stay without it.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'd4e8b2a71f63'
down_revision: Union[str, None] = 'c7d1f9a28e43'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('transaction', sa.Column('shared_total_cents', sa.BigInteger(), nullable=True))


def downgrade() -> None:
    op.drop_column('transaction', 'shared_total_cents')
