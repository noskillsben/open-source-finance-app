"""drop category_line.need_level

Revision ID: a6c3e9d27f51
Revises: f2b7d4c91e85
Create Date: 2026-10-14 10:00:00.000000

A line has no need level of its own; every line takes its category's (#298, DESIGN.md § Need
levels). Nothing read the dropped values, so there is no backfill. Idempotent: the column is
dropped only if it is still there.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'a6c3e9d27f51'
down_revision: Union[str, None] = 'f2b7d4c91e85'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE category_line DROP COLUMN IF EXISTS need_level")


def downgrade() -> None:
    op.add_column('category_line', sa.Column('need_level', sa.String(), nullable=True))
