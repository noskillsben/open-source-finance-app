"""transaction bill link

Revision ID: a3d7f1c92e58
Revises: 9e2c7a41d3b6
Create Date: 2026-09-25 10:00:00.000000

A transaction can say which recurring bill it paid and which of that bill's due dates (#132).
Both columns are nullable and set together; nothing existing is backfilled — old payments stay
unlinked.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'a3d7f1c92e58'
down_revision: Union[str, None] = '9e2c7a41d3b6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('transaction', sa.Column('goal_id', sa.BigInteger(), nullable=True))
    op.add_column('transaction', sa.Column('goal_due_on', sa.Date(), nullable=True))
    op.create_index(op.f('ix_transaction_goal_id'), 'transaction', ['goal_id'], unique=False)
    op.create_foreign_key('transaction_goal_id_fkey', 'transaction', 'goal', ['goal_id'], ['id'])


def downgrade() -> None:
    op.drop_constraint('transaction_goal_id_fkey', 'transaction', type_='foreignkey')
    op.drop_index(op.f('ix_transaction_goal_id'), table_name='transaction')
    op.drop_column('transaction', 'goal_due_on')
    op.drop_column('transaction', 'goal_id')
