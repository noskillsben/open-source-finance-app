"""domain table; category domain, pool and need level; seeded_key on every non-ledger table

Revision ID: c4d8a1f65e92
Revises: b91f3e7a2c45
Create Date: 2026-09-21 10:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'c4d8a1f65e92'
down_revision: Union[str, None] = 'b91f3e7a2c45'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_SEEDED_KEY_TABLES = ('account', 'category', 'payee', 'domain')


def _seeded_key_index(table: str) -> None:
    op.create_index(
        f'ix_{table}_owner_seeded_key', table, ['owner_id', 'seeded_key'],
        unique=True, postgresql_where=sa.text('seeded_key IS NOT NULL'),
    )


def upgrade() -> None:
    # `category` is altered in place: category_line.category_id and category.parent_id both
    # point at it, so dropping and recreating it would orphan every line and lose the tree.
    op.create_table('domain',
    sa.Column('id', sa.BigInteger(), nullable=False),
    sa.Column('name', sa.String(), nullable=False),
    sa.Column('description', sa.String(), nullable=True),
    sa.Column('owner_id', sa.BigInteger(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('created_on', sa.Date(), nullable=False),
    sa.Column('archived_on', sa.Date(), nullable=True),
    sa.Column('seeded_key', sa.String(), nullable=True),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_domain_owner_id'), 'domain', ['owner_id'], unique=False)
    op.create_index('ix_domain_owner_lower_name', 'domain', ['owner_id', sa.text('lower(name)')], unique=True, postgresql_where=sa.text('archived_on IS NULL'))

    for table in ('account', 'category', 'payee'):
        op.add_column(table, sa.Column('seeded_key', sa.String(), nullable=True))
    for table in _SEEDED_KEY_TABLES:
        _seeded_key_index(table)

    op.add_column('category', sa.Column('pool_id', sa.BigInteger(), nullable=True))
    op.add_column('category', sa.Column('domain_id', sa.BigInteger(), nullable=True))
    op.add_column('category', sa.Column('need_level', sa.String(), nullable=True))
    op.create_index(op.f('ix_category_pool_id'), 'category', ['pool_id'], unique=False)
    op.create_index(op.f('ix_category_domain_id'), 'category', ['domain_id'], unique=False)
    op.create_foreign_key('fk_category_pool_id_category', 'category', 'category', ['pool_id'], ['id'])
    op.create_foreign_key('fk_category_domain_id_domain', 'category', 'domain', ['domain_id'], ['id'])

    # Until now the seeded payee Me was identified by created_on == date.min. Carry that
    # identity over to seeded_key, once, so the seed step (which now reads only seeded_key)
    # finds the existing Me instead of inserting a second one. This tags a row; it inserts
    # no default.
    op.execute(
        "UPDATE payee SET seeded_key = 'payee:me' "
        "WHERE id IN (SELECT min(id) FROM payee WHERE created_on = DATE '0001-01-01' GROUP BY owner_id)"
    )


def downgrade() -> None:
    op.drop_constraint('fk_category_domain_id_domain', 'category', type_='foreignkey')
    op.drop_constraint('fk_category_pool_id_category', 'category', type_='foreignkey')
    op.drop_index(op.f('ix_category_domain_id'), table_name='category')
    op.drop_index(op.f('ix_category_pool_id'), table_name='category')
    op.drop_column('category', 'need_level')
    op.drop_column('category', 'domain_id')
    op.drop_column('category', 'pool_id')
    for table in _SEEDED_KEY_TABLES:
        op.drop_index(f'ix_{table}_owner_seeded_key', table_name=table, postgresql_where=sa.text('seeded_key IS NOT NULL'))
    for table in ('account', 'category', 'payee'):
        op.drop_column(table, 'seeded_key')
    op.drop_index('ix_domain_owner_lower_name', table_name='domain', postgresql_where=sa.text('archived_on IS NULL'))
    op.drop_index(op.f('ix_domain_owner_id'), table_name='domain')
    op.drop_table('domain')
