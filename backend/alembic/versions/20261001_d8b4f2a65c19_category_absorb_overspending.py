"""category absorb overspending

Revision ID: d8b4f2a65c19
Revises: c5a1e8d37b42
Create Date: 2026-10-01 10:00:00.000000

A pool can absorb the overspending of the categories drawing on it (#196, DESIGN.md § Pools).
One boolean on category, false for every existing row, so no past draw changes meaning.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'd8b4f2a65c19'
down_revision: Union[str, None] = 'c5a1e8d37b42'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('category', sa.Column('absorb_overspending', sa.Boolean(), server_default=sa.text('false'), nullable=False))


def downgrade() -> None:
    op.drop_column('category', 'absorb_overspending')
