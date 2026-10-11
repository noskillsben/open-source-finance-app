"""split receivables become Money owed to me

Revision ID: f2b7d4c91e85
Revises: e5f9c3b82a74
Create Date: 2026-10-11 10:00:00.000000

Data migration only (#250, DESIGN.md § Account type): accounts referenced by a split_member row
were created as `Cash` stand-ins; they become `Money owed to me`. No schema change. Idempotent:
a second run finds no referenced account still typed `Cash`.
"""
from typing import Sequence, Union

from alembic import op


revision: str = 'f2b7d4c91e85'
down_revision: Union[str, None] = 'e5f9c3b82a74'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        "UPDATE account SET type = 'Money owed to me' "
        "WHERE type = 'Cash' AND id IN (SELECT account_id FROM split_member)"
    )


def downgrade() -> None:
    op.execute(
        "UPDATE account SET type = 'Cash' "
        "WHERE type = 'Money owed to me' AND id IN (SELECT account_id FROM split_member)"
    )
