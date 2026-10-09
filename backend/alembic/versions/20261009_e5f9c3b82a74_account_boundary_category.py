"""account boundary category

Revision ID: e5f9c3b82a74
Revises: d4e8b2a71f63
Create Date: 2026-10-09 10:00:00.000000

Adds the nullable, indexed `account.boundary_category_id` FK to `category` (#32, DESIGN.md § Accounts
-> Money crossing the budget boundary). Additive: every existing account comes out null, no backfill.
Idempotent: Alembic runs it once.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'e5f9c3b82a74'
down_revision: Union[str, None] = 'd4e8b2a71f63'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('account', sa.Column('boundary_category_id', sa.BigInteger(), nullable=True))
    op.create_index(op.f('ix_account_boundary_category_id'), 'account', ['boundary_category_id'], unique=False)
    op.create_foreign_key('fk_account_boundary_category_id_category', 'account', 'category', ['boundary_category_id'], ['id'])


def downgrade() -> None:
    op.drop_constraint('fk_account_boundary_category_id_category', 'account', type_='foreignkey')
    op.drop_index(op.f('ix_account_boundary_category_id'), table_name='account')
    op.drop_column('account', 'boundary_category_id')
