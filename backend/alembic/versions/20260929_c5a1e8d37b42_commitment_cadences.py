"""commitment cadences

Revision ID: c5a1e8d37b42
Revises: a3d7f1c92e58
Create Date: 2026-09-29 10:00:00.000000

A Commitment's cadence is now meaningful only on a fixed amount, and states the first month it
is due (#156). Refill and percent-of-net goals are per payday and lose theirs; a fixed amount on
"every N weeks" becomes an empty cadence (each payday), which is what its pre-fill already did.
A fixed amount on monthly, quarterly, every-6-months or yearly needs a first due month the app
cannot guess: any such goal (live or archived) makes this refuse and list them, changing
nothing — change each to a per-payday cadence by hand, then upgrade again.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'c5a1e8d37b42'
down_revision: Union[str, None] = 'a3d7f1c92e58'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_FIXED = "kind = 'commitment' AND amount_cents IS NOT NULL AND level_cents IS NULL AND percent_of_net IS NULL"


def upgrade() -> None:
    bind = op.get_bind()
    undated = bind.execute(sa.text(
        f"SELECT id, name FROM goal WHERE {_FIXED} AND cadence IN ('monthly', 'quarterly', 'semiannual', 'yearly') "
        "ORDER BY id"
    )).all()
    if undated:
        listing = ", ".join(f"#{goal_id} {name!r}" for goal_id, name in undated)
        raise RuntimeError(
            "Cannot give fixed-amount commitments a first due month: these are on a monthly, quarterly, "
            "6-month or yearly cadence with none (live or archived) — change each one to a per-payday "
            f"cadence by hand, then upgrade again: {listing}"
        )
    op.add_column("goal", sa.Column("first_due_on", sa.Date(), nullable=True))
    bind.execute(sa.text(
        "UPDATE goal SET cadence = NULL, cadence_weeks = NULL "
        "WHERE kind = 'commitment' AND (level_cents IS NOT NULL OR percent_of_net IS NOT NULL)"
    ))
    bind.execute(sa.text(f"UPDATE goal SET cadence = NULL, cadence_weeks = NULL WHERE {_FIXED} AND cadence = 'weeks'"))


def downgrade() -> None:
    op.drop_column("goal", "first_due_on")
