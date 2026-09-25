"""recurring bill first due date

Revision ID: 9e2c7a41d3b6
Revises: 06817c6fe779
Create Date: 2026-09-24 14:00:00.000000

A recurring bill can no longer exist without a first due date (#131): its due dates are that
date stepped forward by cadence, and no cycle exists before it. `goal.target_date` is shared
with targets (which may be dateless), so the rule is a CHECK, not a NOT NULL. Any live or
archived recurring bill with no date makes this refuse and list them; the app never guesses a
date — set one by hand, then upgrade again.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '9e2c7a41d3b6'
down_revision: Union[str, None] = '06817c6fe779'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    dateless = op.get_bind().execute(
        sa.text("SELECT id, name FROM goal WHERE kind = 'recurring_bill' AND target_date IS NULL ORDER BY id")
    ).all()
    if dateless:
        listing = ", ".join(f"#{goal_id} {name!r}" for goal_id, name in dateless)
        raise RuntimeError(
            "Cannot require a first due date on recurring bills: these have none (live or archived) "
            f"— give each one a date by hand, then upgrade again: {listing}"
        )
    op.create_check_constraint(
        "ck_goal_recurring_bill_first_due", "goal", "kind <> 'recurring_bill' OR target_date IS NOT NULL"
    )


def downgrade() -> None:
    op.drop_constraint("ck_goal_recurring_bill_first_due", "goal", type_="check")
