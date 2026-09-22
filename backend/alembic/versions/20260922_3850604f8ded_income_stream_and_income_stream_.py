"""income stream and income stream deduction

Revision ID: 3850604f8ded
Revises: a8b5e0f63c41
Create Date: 2026-09-22 18:11:55.933653
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '3850604f8ded'
down_revision: Union[str, None] = 'a8b5e0f63c41'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('income_stream',
    sa.Column('id', sa.BigInteger(), nullable=False),
    sa.Column('name', sa.String(), nullable=False),
    sa.Column('payee_id', sa.BigInteger(), nullable=True),
    sa.Column('cadence', sa.String(), nullable=False),
    sa.Column('cadence_weeks', sa.Integer(), nullable=True),
    sa.Column('anchor_payday', sa.Date(), nullable=False),
    sa.Column('expected_gross_cents', sa.BigInteger(), nullable=True),
    sa.Column('expected_net_low_cents', sa.BigInteger(), nullable=False),
    sa.Column('expected_net_high_cents', sa.BigInteger(), nullable=False),
    sa.Column('income_category_id', sa.BigInteger(), nullable=False),
    sa.Column('destination_account_id', sa.BigInteger(), nullable=False),
    sa.Column('owner_id', sa.BigInteger(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('created_on', sa.Date(), nullable=False),
    sa.Column('archived_on', sa.Date(), nullable=True),
    sa.Column('seeded_key', sa.String(), nullable=True),
    sa.ForeignKeyConstraint(['destination_account_id'], ['account.id'], ),
    sa.ForeignKeyConstraint(['income_category_id'], ['category.id'], ),
    sa.ForeignKeyConstraint(['payee_id'], ['payee.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_income_stream_destination_account_id'), 'income_stream', ['destination_account_id'], unique=False)
    op.create_index(op.f('ix_income_stream_income_category_id'), 'income_stream', ['income_category_id'], unique=False)
    op.create_index(op.f('ix_income_stream_owner_id'), 'income_stream', ['owner_id'], unique=False)
    op.create_index('ix_income_stream_owner_lower_name', 'income_stream', ['owner_id', sa.text('lower(name)')], unique=True, postgresql_where=sa.text('archived_on IS NULL'))
    op.create_index(op.f('ix_income_stream_payee_id'), 'income_stream', ['payee_id'], unique=False)
    op.create_table('income_stream_deduction',
    sa.Column('id', sa.BigInteger(), nullable=False),
    sa.Column('income_stream_id', sa.BigInteger(), nullable=False),
    sa.Column('category_id', sa.BigInteger(), nullable=False),
    sa.Column('amount_cents', sa.BigInteger(), nullable=False),
    sa.Column('owner_id', sa.BigInteger(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['category_id'], ['category.id'], ),
    sa.ForeignKeyConstraint(['income_stream_id'], ['income_stream.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_income_stream_deduction_category_id'), 'income_stream_deduction', ['category_id'], unique=False)
    op.create_index(op.f('ix_income_stream_deduction_income_stream_id'), 'income_stream_deduction', ['income_stream_id'], unique=False)
    op.create_index(op.f('ix_income_stream_deduction_owner_id'), 'income_stream_deduction', ['owner_id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_income_stream_deduction_owner_id'), table_name='income_stream_deduction')
    op.drop_index(op.f('ix_income_stream_deduction_income_stream_id'), table_name='income_stream_deduction')
    op.drop_index(op.f('ix_income_stream_deduction_category_id'), table_name='income_stream_deduction')
    op.drop_table('income_stream_deduction')
    op.drop_index(op.f('ix_income_stream_payee_id'), table_name='income_stream')
    op.drop_index('ix_income_stream_owner_lower_name', table_name='income_stream', postgresql_where=sa.text('archived_on IS NULL'))
    op.drop_index(op.f('ix_income_stream_owner_id'), table_name='income_stream')
    op.drop_index(op.f('ix_income_stream_income_category_id'), table_name='income_stream')
    op.drop_index(op.f('ix_income_stream_destination_account_id'), table_name='income_stream')
    op.drop_table('income_stream')
