"""bill first due on

Revision ID: f1a6c2e84d97
Revises: e9c3a7d15b84
Create Date: 2026-10-03 10:00:00.000000

A recurring bill's first due date moves from `target_date` to `first_due_on`, the field a fixed
Commitment's first due month already uses; `target_date` is a Target's alone (#199, DESIGN.md §
Goals). Every recurring bill, live or archived, has its date copied across and `target_date`
cleared, and the CHECK that a bill has a first due date moves onto `first_due_on`. No column is
added or dropped. Idempotent: after one run no bill has a `target_date` left to move.
"""
from typing import Sequence, Union

from alembic import op


revision: str = 'f1a6c2e84d97'
down_revision: Union[str, None] = 'e9c3a7d15b84'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_constraint("ck_goal_recurring_bill_first_due", "goal", type_="check")
    op.execute(
        "UPDATE goal SET first_due_on = target_date, target_date = NULL "
        "WHERE kind = 'recurring_bill' AND target_date IS NOT NULL"
    )
    op.create_check_constraint(
        "ck_goal_recurring_bill_first_due", "goal", "kind <> 'recurring_bill' OR first_due_on IS NOT NULL"
    )


def downgrade() -> None:
    op.drop_constraint("ck_goal_recurring_bill_first_due", "goal", type_="check")
    op.execute(
        "UPDATE goal SET target_date = first_due_on, first_due_on = NULL WHERE kind = 'recurring_bill'"
    )
    op.create_check_constraint(
        "ck_goal_recurring_bill_first_due", "goal", "kind <> 'recurring_bill' OR target_date IS NOT NULL"
    )
