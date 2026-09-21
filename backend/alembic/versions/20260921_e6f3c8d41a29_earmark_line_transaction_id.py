"""earmark_line.transaction_id

Revision ID: e6f3c8d41a29
Revises: d5e2b7c30f18
Create Date: 2026-09-21 16:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'e6f3c8d41a29'
down_revision: Union[str, None] = 'd5e2b7c30f18'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('earmark_line', sa.Column('transaction_id', sa.BigInteger(), nullable=True))
    op.create_index(op.f('ix_earmark_line_transaction_id'), 'earmark_line', ['transaction_id'], unique=False)
    op.create_foreign_key(None, 'earmark_line', 'transaction', ['transaction_id'], ['id'])


def downgrade() -> None:
    op.drop_constraint('earmark_line_transaction_id_fkey', 'earmark_line', type_='foreignkey')
    op.drop_index(op.f('ix_earmark_line_transaction_id'), table_name='earmark_line')
    op.drop_column('earmark_line', 'transaction_id')
