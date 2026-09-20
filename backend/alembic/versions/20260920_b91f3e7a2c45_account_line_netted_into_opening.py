"""account_line netted_into_opening

Revision ID: b91f3e7a2c45
Revises: a82c4d9e1b70
Create Date: 2026-09-20 15:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'b91f3e7a2c45'
down_revision: Union[str, None] = 'a82c4d9e1b70'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Every existing line is marked not netted: whether an old line was netted when it was
    # written isn't recorded anywhere, so it can't be reconstructed. A line written before this
    # revision that had backfilled an opening therefore won't unwind on edit or delete.
    op.add_column('account_line', sa.Column('netted_into_opening', sa.Boolean(), server_default=sa.text('false'), nullable=False))


def downgrade() -> None:
    op.drop_column('account_line', 'netted_into_opening')
