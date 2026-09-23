"""transaction income stream binding

Revision ID: b85e039f86ae
Revises: 6c1b8e93f5a7
Create Date: 2026-09-23 13:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'b85e039f86ae'
down_revision: Union[str, None] = '6c1b8e93f5a7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('transaction', sa.Column('income_stream_id', sa.BigInteger(), nullable=True))
    op.create_index(op.f('ix_transaction_income_stream_id'), 'transaction', ['income_stream_id'], unique=False)
    op.create_foreign_key(
        'transaction_income_stream_id_fkey', 'transaction', 'income_stream', ['income_stream_id'], ['id']
    )


def downgrade() -> None:
    op.drop_constraint('transaction_income_stream_id_fkey', 'transaction', type_='foreignkey')
    op.drop_index(op.f('ix_transaction_income_stream_id'), table_name='transaction')
    op.drop_column('transaction', 'income_stream_id')
