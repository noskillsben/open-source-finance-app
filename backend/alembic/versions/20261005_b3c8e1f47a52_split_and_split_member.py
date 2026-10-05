"""split and split_member

Revision ID: b3c8e1f47a52
Revises: a2b7d9e41c36
Create Date: 2026-10-05 10:00:00.000000

Adds the non-ledger `split` and `split_member` tables (#28, DESIGN.md § Splits), each born with
the NonLedger columns, a partial unique index on live rows, and indexed FKs. Additive: two new
empty tables, nothing existing is touched, and Alembic runs it once.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'b3c8e1f47a52'
down_revision: Union[str, None] = 'a2b7d9e41c36'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _common_columns() -> list[sa.Column]:
    return [
        sa.Column('created_on', sa.Date(), nullable=False),
        sa.Column('archived_on', sa.Date(), nullable=True),
        sa.Column('seeded_key', sa.String(), nullable=True),
        sa.Column('owner_id', sa.BigInteger(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    ]


def upgrade() -> None:
    op.create_table('split',
    sa.Column('id', sa.BigInteger(), nullable=False),
    sa.Column('name', sa.String(), nullable=False),
    sa.Column('description', sa.String(), nullable=True),
    *_common_columns(),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_split_owner_id'), 'split', ['owner_id'], unique=False)
    op.create_index('ix_split_owner_lower_name', 'split', ['owner_id', sa.literal_column('lower(name)')], unique=True,
                    postgresql_where=sa.text('archived_on IS NULL'))
    op.create_index('ix_split_owner_seeded_key', 'split', ['owner_id', 'seeded_key'], unique=True,
                    postgresql_where=sa.text('seeded_key IS NOT NULL'))

    op.create_table('split_member',
    sa.Column('id', sa.BigInteger(), nullable=False),
    sa.Column('split_id', sa.BigInteger(), nullable=False),
    sa.Column('payee_id', sa.BigInteger(), nullable=False),
    sa.Column('account_id', sa.BigInteger(), nullable=False),
    sa.Column('percent', sa.Numeric(precision=7, scale=4), nullable=False),
    *_common_columns(),
    sa.ForeignKeyConstraint(['split_id'], ['split.id'], ),
    sa.ForeignKeyConstraint(['payee_id'], ['payee.id'], ),
    sa.ForeignKeyConstraint(['account_id'], ['account.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_split_member_owner_id'), 'split_member', ['owner_id'], unique=False)
    op.create_index(op.f('ix_split_member_split_id'), 'split_member', ['split_id'], unique=False)
    op.create_index(op.f('ix_split_member_payee_id'), 'split_member', ['payee_id'], unique=False)
    op.create_index(op.f('ix_split_member_account_id'), 'split_member', ['account_id'], unique=False)
    op.create_index('ix_split_member_split_payee', 'split_member', ['split_id', 'payee_id'], unique=True,
                    postgresql_where=sa.text('archived_on IS NULL'))
    op.create_index('ix_split_member_owner_seeded_key', 'split_member', ['owner_id', 'seeded_key'], unique=True,
                    postgresql_where=sa.text('seeded_key IS NOT NULL'))


def downgrade() -> None:
    op.drop_table('split_member')
    op.drop_table('split')
