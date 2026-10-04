"""account locked payee

Revision ID: a2b7d9e41c36
Revises: f1a6c2e84d97
Create Date: 2026-10-04 10:00:00.000000

Adds the nullable, indexed `account.locked_payee_id` FK to `payee` (#30, DESIGN.md § Payee-locked
accounts). Additive: every existing account comes out unlocked (null). Idempotent: Alembic runs it once.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'a2b7d9e41c36'
down_revision: Union[str, None] = 'f1a6c2e84d97'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('account', sa.Column('locked_payee_id', sa.BigInteger(), nullable=True))
    op.create_index(op.f('ix_account_locked_payee_id'), 'account', ['locked_payee_id'], unique=False)
    op.create_foreign_key('fk_account_locked_payee_id_payee', 'account', 'payee', ['locked_payee_id'], ['id'])


def downgrade() -> None:
    op.drop_constraint('fk_account_locked_payee_id_payee', 'account', type_='foreignkey')
    op.drop_index(op.f('ix_account_locked_payee_id'), table_name='account')
    op.drop_column('account', 'locked_payee_id')
