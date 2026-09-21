"""category_account_link table

Revision ID: a8b5e0f63c41
Revises: f7a4d9e52b30
Create Date: 2026-09-21 19:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'a8b5e0f63c41'
down_revision: Union[str, None] = 'f7a4d9e52b30'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('category_account_link',
    sa.Column('id', sa.BigInteger(), nullable=False),
    sa.Column('category_id', sa.BigInteger(), nullable=False),
    sa.Column('account_id', sa.BigInteger(), nullable=False),
    sa.Column('owner_id', sa.BigInteger(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['account_id'], ['account.id'], ),
    sa.ForeignKeyConstraint(['category_id'], ['category.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('category_id', 'account_id', name='uq_category_account_link')
    )
    op.create_index(op.f('ix_category_account_link_account_id'), 'category_account_link', ['account_id'], unique=False)
    op.create_index(op.f('ix_category_account_link_category_id'), 'category_account_link', ['category_id'], unique=False)
    op.create_index(op.f('ix_category_account_link_owner_id'), 'category_account_link', ['owner_id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_category_account_link_owner_id'), table_name='category_account_link')
    op.drop_index(op.f('ix_category_account_link_category_id'), table_name='category_account_link')
    op.drop_index(op.f('ix_category_account_link_account_id'), table_name='category_account_link')
    op.drop_table('category_account_link')
