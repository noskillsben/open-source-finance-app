"""account opening_stated_on

Revision ID: a82c4d9e1b70
Revises: cfce036f3c04
Create Date: 2026-09-20 10:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'a82c4d9e1b70'
down_revision: Union[str, None] = 'cfce036f3c04'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Backfilled from created_on: right for every account that has never been backfilled. An
    # account already backfilled has lost its original stated date, so its stated date is its
    # current created_on and later edits of its earlier lines behave as they did before.
    op.add_column('account', sa.Column('opening_stated_on', sa.Date(), nullable=True))
    op.execute('UPDATE account SET opening_stated_on = created_on')
    op.alter_column('account', 'opening_stated_on', nullable=False)


def downgrade() -> None:
    op.drop_column('account', 'opening_stated_on')
