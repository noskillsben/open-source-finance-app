"""goal table

Revision ID: f7a4d9e52b30
Revises: e6f3c8d41a29
Create Date: 2026-09-21 18:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'f7a4d9e52b30'
down_revision: Union[str, None] = 'e6f3c8d41a29'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('goal',
    sa.Column('id', sa.BigInteger(), nullable=False),
    sa.Column('category_id', sa.BigInteger(), nullable=False),
    sa.Column('name', sa.String(), nullable=False),
    sa.Column('kind', sa.String(), nullable=False),
    sa.Column('amount_cents', sa.BigInteger(), nullable=True),
    sa.Column('cadence', sa.String(), nullable=True),
    sa.Column('cadence_weeks', sa.Integer(), nullable=True),
    sa.Column('target_date', sa.Date(), nullable=True),
    sa.Column('level_cents', sa.BigInteger(), nullable=True),
    sa.Column('created_on', sa.Date(), nullable=False),
    sa.Column('archived_on', sa.Date(), nullable=True),
    sa.Column('seeded_key', sa.String(), nullable=True),
    sa.Column('owner_id', sa.BigInteger(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['category_id'], ['category.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_goal_category_id'), 'goal', ['category_id'], unique=False)
    op.create_index(op.f('ix_goal_owner_id'), 'goal', ['owner_id'], unique=False)
    op.create_index('ix_goal_category_live', 'goal', ['category_id'], unique=True,
                    postgresql_where=sa.text('archived_on IS NULL'))


def downgrade() -> None:
    op.drop_index('ix_goal_category_live', table_name='goal', postgresql_where=sa.text('archived_on IS NULL'))
    op.drop_index(op.f('ix_goal_owner_id'), table_name='goal')
    op.drop_index(op.f('ix_goal_category_id'), table_name='goal')
    op.drop_table('goal')
