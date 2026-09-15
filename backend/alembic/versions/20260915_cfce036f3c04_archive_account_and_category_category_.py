"""archive account and category, category parent and dates

Revision ID: cfce036f3c04
Revises: ffe95c16a43c
Create Date: 2026-09-15 23:40:54.757426
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'cfce036f3c04'
down_revision: Union[str, None] = 'ffe95c16a43c'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('account', sa.Column('archived_on', sa.Date(), nullable=True))
    op.drop_index('ix_account_owner_lower_name', table_name='account')
    op.create_index(
        'ix_account_owner_lower_name', 'account', ['owner_id', sa.text('lower(name)')],
        unique=True, postgresql_where=sa.text('archived_on IS NULL'),
    )

    op.add_column('category', sa.Column('parent_id', sa.BigInteger(), nullable=True))
    op.create_index(op.f('ix_category_parent_id'), 'category', ['parent_id'], unique=False)
    op.create_foreign_key('fk_category_parent_id_category', 'category', 'category', ['parent_id'], ['id'])

    # created_on is backfilled before it becomes NOT NULL (DESIGN.md: backfill from the
    # earliest category_line pointing at it, else created_at) — the column can't be added
    # not-null directly on a populated table.
    op.add_column('category', sa.Column('created_on', sa.Date(), nullable=True))
    op.execute(
        """
        UPDATE category
        SET created_on = COALESCE(
            (SELECT MIN(t.date) FROM category_line cl JOIN "transaction" t ON t.id = cl.transaction_id
             WHERE cl.category_id = category.id),
            category.created_at::date
        )
        """
    )
    op.alter_column('category', 'created_on', nullable=False)

    op.add_column('category', sa.Column('archived_on', sa.Date(), nullable=True))
    op.drop_index('ix_category_owner_lower_name', table_name='category')
    op.create_index(
        'ix_category_owner_lower_name', 'category', ['owner_id', sa.text('lower(name)')],
        unique=True, postgresql_where=sa.text('archived_on IS NULL'),
    )


def downgrade() -> None:
    op.drop_index('ix_category_owner_lower_name', table_name='category', postgresql_where=sa.text('archived_on IS NULL'))
    op.create_index('ix_category_owner_lower_name', 'category', ['owner_id', sa.text('lower(name)')], unique=True)
    op.drop_column('category', 'archived_on')
    op.drop_column('category', 'created_on')
    op.drop_constraint('fk_category_parent_id_category', 'category', type_='foreignkey')
    op.drop_index(op.f('ix_category_parent_id'), table_name='category')
    op.drop_column('category', 'parent_id')

    op.drop_index('ix_account_owner_lower_name', table_name='account', postgresql_where=sa.text('archived_on IS NULL'))
    op.create_index('ix_account_owner_lower_name', 'account', ['owner_id', sa.text('lower(name)')], unique=True)
    op.drop_column('account', 'archived_on')
