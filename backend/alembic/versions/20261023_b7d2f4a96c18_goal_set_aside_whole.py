"""goal set_aside_whole

Revision ID: b7d2f4a96c18
Revises: a6c3e9d27f51
Create Date: 2026-10-23 10:00:00.000000

A recurring bill bound to a named pay can be set aside whole on the last payday before it is due
(#360, DESIGN.md § Goals). Additive with a default: every existing goal comes out false (split
across paydays, as before). Idempotent: the column is added only if it is not already there.
"""
from typing import Sequence, Union

from alembic import op


revision: str = 'b7d2f4a96c18'
down_revision: Union[str, None] = 'a6c3e9d27f51'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE goal ADD COLUMN IF NOT EXISTS set_aside_whole BOOLEAN NOT NULL DEFAULT false")


def downgrade() -> None:
    op.drop_column('goal', 'set_aside_whole')
