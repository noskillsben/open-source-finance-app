"""account opening_stated_on nullable

Revision ID: c8e3a5b17d92
Revises: b7d2f4a96c18
Create Date: 2026-10-26 10:00:00.000000

An opening the app made up is not a stated balance (#434, DESIGN.md § Balance checks). The
column becomes nullable, and is cleared on every account a split membership created: the account
and its first membership row share a creation timestamp (one transaction). Accounts from the
account form, and accounts picked for a member, keep their stated day. Idempotent: dropping NOT
NULL twice is a no-op and the update only touches rows that are not already null. Lines already
netted into those openings are repaired through Data check's per-row Re-save, not here.
"""
from typing import Sequence, Union

from alembic import op


revision: str = 'c8e3a5b17d92'
down_revision: Union[str, None] = 'b7d2f4a96c18'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE account ALTER COLUMN opening_stated_on DROP NOT NULL")
    op.execute(
        """
        UPDATE account SET opening_stated_on = NULL
        WHERE opening_stated_on IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM split_member m
            WHERE m.account_id = account.id
              AND m.created_at = account.created_at
              AND m.id = (SELECT MIN(first.id) FROM split_member first WHERE first.account_id = account.id)
          )
        """
    )


def downgrade() -> None:
    op.execute("UPDATE account SET opening_stated_on = created_on WHERE opening_stated_on IS NULL")
    op.alter_column('account', 'opening_stated_on', nullable=False)
