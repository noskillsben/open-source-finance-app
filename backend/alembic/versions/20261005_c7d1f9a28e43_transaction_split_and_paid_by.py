"""transaction split and paid by

Revision ID: c7d1f9a28e43
Revises: b3c8e1f47a52
Create Date: 2026-10-05 14:00:00.000000

A transaction can say which split the form used and who paid (#225, DESIGN.md § Splits). Both
columns are nullable and indexed; nothing existing is backfilled — old transactions stay unshared.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'c7d1f9a28e43'
down_revision: Union[str, None] = 'b3c8e1f47a52'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('transaction', sa.Column('split_id', sa.BigInteger(), nullable=True))
    op.add_column('transaction', sa.Column('paid_by_payee_id', sa.BigInteger(), nullable=True))
    op.create_index(op.f('ix_transaction_split_id'), 'transaction', ['split_id'], unique=False)
    op.create_index(op.f('ix_transaction_paid_by_payee_id'), 'transaction', ['paid_by_payee_id'], unique=False)
    op.create_foreign_key('transaction_split_id_fkey', 'transaction', 'split', ['split_id'], ['id'])
    op.create_foreign_key('transaction_paid_by_payee_id_fkey', 'transaction', 'payee', ['paid_by_payee_id'], ['id'])


def downgrade() -> None:
    op.drop_constraint('transaction_paid_by_payee_id_fkey', 'transaction', type_='foreignkey')
    op.drop_constraint('transaction_split_id_fkey', 'transaction', type_='foreignkey')
    op.drop_index(op.f('ix_transaction_paid_by_payee_id'), table_name='transaction')
    op.drop_index(op.f('ix_transaction_split_id'), table_name='transaction')
    op.drop_column('transaction', 'paid_by_payee_id')
    op.drop_column('transaction', 'split_id')
