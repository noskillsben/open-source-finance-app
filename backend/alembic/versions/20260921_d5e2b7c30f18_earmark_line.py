"""earmark_line table

Revision ID: d5e2b7c30f18
Revises: c4d8a1f65e92
Create Date: 2026-09-21 14:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'd5e2b7c30f18'
down_revision: Union[str, None] = 'c4d8a1f65e92'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('earmark_line',
    sa.Column('id', sa.BigInteger(), nullable=False),
    sa.Column('date', sa.Date(), nullable=False),
    sa.Column('category_id', sa.BigInteger(), nullable=False),
    sa.Column('cents', sa.BigInteger(), nullable=False),
    sa.Column('source', sa.String(), nullable=False),
    sa.Column('owner_id', sa.BigInteger(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['category_id'], ['category.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_earmark_line_category_id'), 'earmark_line', ['category_id'], unique=False)
    op.create_index(op.f('ix_earmark_line_date'), 'earmark_line', ['date'], unique=False)
    op.create_index(op.f('ix_earmark_line_owner_id'), 'earmark_line', ['owner_id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_earmark_line_owner_id'), table_name='earmark_line')
    op.drop_index(op.f('ix_earmark_line_date'), table_name='earmark_line')
    op.drop_index(op.f('ix_earmark_line_category_id'), table_name='earmark_line')
    op.drop_table('earmark_line')
