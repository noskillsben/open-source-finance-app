"""goal income stream binding

Revision ID: 6c1b8e93f5a7
Revises: 3850604f8ded
Create Date: 2026-09-23 12:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '6c1b8e93f5a7'
down_revision: Union[str, None] = '3850604f8ded'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('goal', sa.Column('income_stream_id', sa.BigInteger(), nullable=True))
    op.add_column('goal', sa.Column('percent_of_net', sa.Numeric(9, 4), nullable=True))
    op.create_index(op.f('ix_goal_income_stream_id'), 'goal', ['income_stream_id'], unique=False)
    op.create_foreign_key('goal_income_stream_id_fkey', 'goal', 'income_stream', ['income_stream_id'], ['id'])


def downgrade() -> None:
    op.drop_constraint('goal_income_stream_id_fkey', 'goal', type_='foreignkey')
    op.drop_index(op.f('ix_goal_income_stream_id'), table_name='goal')
    op.drop_column('goal', 'percent_of_net')
    op.drop_column('goal', 'income_stream_id')
