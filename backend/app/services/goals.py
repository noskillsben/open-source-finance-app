"""Category goals (DESIGN.md § Goals): one rule per category, progress being the category's
balance compared to the rule. A goal binds to a named pay (#21) that funds it: `income_stream_id`
plus, for a Commitment's "add" flavour, `percent_of_net` as an alternative to a fixed
`amount_cents` — resolved against the pay's net, never gross, and never stored as cents.
"""
import calendar
from dataclasses import dataclass
from datetime import date, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import AccountLine, Category, CategoryLine, EarmarkLine, Goal, IncomeStream, Transaction
from app.services.accounts import dollars
from app.services.cadence import CADENCES, step
from app.services.categories import category_balance_cents
from app.services.income_streams import next_payday

KINDS = ("recurring_bill", "target", "commitment")


class GoalError(Exception):
    """A goal the service refuses — a settings surface, so a block is allowed."""


def _step(goal: Goal, day: date, n: int) -> date:
    return step(goal.cadence, goal.cadence_weeks, day, n)


def apply_goal(
    session: Session, category: Category, goal: Goal | None, *, on: date, name: str, kind: str,
    amount_cents: int | None, cadence: str | None, cadence_weeks: int | None,
    target_date: date | None, level_cents: int | None,
    income_stream_id: int | None = None, percent_of_net=None, first_due_on: date | None = None,
) -> Goal:
    """The one write path for a goal, shared by create and edit. Validates everything before
    touching the row; a field the kind doesn't use must be left empty (null, never zero).
    """
    if kind not in KINDS:
        raise GoalError(f"Unknown goal kind {kind!r}.")
    if cadence is not None and cadence not in CADENCES:
        raise GoalError(f"Unknown cadence {cadence!r}.")
    if kind == "commitment" and (cadence == "weeks" or cadence_weeks is not None):
        raise GoalError("A commitment has no every-N-weeks cadence; that stays on bills.")
    if kind != "commitment" and first_due_on is not None:
        raise GoalError("Only a commitment has a first due month.")
    if cadence == "weeks":
        if cadence_weeks is None or cadence_weeks < 1:
            raise GoalError("'Every N weeks' needs N, at least 1.")
    elif cadence_weeks is not None:
        raise GoalError("The number of weeks only applies to an 'every N weeks' cadence.")
    for label, cents in (("amount", amount_cents), ("level", level_cents)):
        if cents is not None and cents < 0:
            raise GoalError(f"The {label} cannot be negative.")
    if percent_of_net is not None and percent_of_net < 0:
        raise GoalError("The percentage cannot be negative.")

    if income_stream_id is not None and session.get(IncomeStream, income_stream_id) is None:
        raise GoalError(f"Unknown income stream id: {income_stream_id}")

    if kind == "recurring_bill":
        if amount_cents is None or cadence is None:
            raise GoalError("A recurring bill needs an amount and a cadence.")
        if level_cents is not None:
            raise GoalError("A recurring bill has no level.")
        if percent_of_net is not None:
            raise GoalError("A recurring bill has no percentage.")
    elif kind == "target":
        if amount_cents is None:
            raise GoalError("A target needs an amount.")
        if level_cents is not None:
            raise GoalError("A target has no level.")
        if percent_of_net is not None:
            raise GoalError("A target has no percentage.")
        if cadence is not None and target_date is None:
            raise GoalError("A per-period contribution needs a target date.")
    else:
        if target_date is not None:
            raise GoalError("A commitment has no target date.")
        flavours = [v for v in (amount_cents, level_cents, percent_of_net) if v is not None]
        if len(flavours) != 1:
            raise GoalError(
                "A commitment adds a fixed amount, adds a percentage of net, or refills to a "
                "level — give exactly one, not more."
            )
        # Refill and percent-of-net are always per payday, so they carry no cadence. Only a fixed
        # amount may have one, and then it names the first month it is due (a month's last day).
        if cadence is not None and amount_cents is None:
            raise GoalError("Only a fixed-amount commitment has a cadence; the others are per payday.")
        if cadence is None and first_due_on is not None:
            raise GoalError("A commitment with no cadence has no first due month.")
        if cadence is not None:
            if first_due_on is None:
                raise GoalError("A commitment with a cadence needs its first due month.")
            if first_due_on.day != calendar.monthrange(first_due_on.year, first_due_on.month)[1]:
                raise GoalError("A commitment's first due month is stored as that month's last day.")

    if percent_of_net is not None and income_stream_id is None:
        raise GoalError("A percentage of net needs a bound pay.")

    if goal is None:
        goal = Goal(category_id=category.id, created_on=on)
        session.add(goal)
    goal.name = name
    goal.kind = kind
    goal.amount_cents = amount_cents
    goal.cadence = cadence
    goal.cadence_weeks = cadence_weeks
    goal.first_due_on = first_due_on
    goal.target_date = target_date
    goal.level_cents = level_cents
    goal.income_stream_id = income_stream_id
    goal.percent_of_net = percent_of_net
    return goal


def live_goal(session: Session, category_id: int) -> Goal | None:
    return session.scalar(select(Goal).where(Goal.category_id == category_id, Goal.archived_on.is_(None)))


def contribution_cents(goal: Goal, balance_cents: int, *, as_of: date) -> int | None:
    """A target's per-period contribution: the shortfall spread over the whole cadence periods
    between `as_of` and the target date (at least one), rounded UP to the cent so the periods
    never leave it short; 0 once the balance has reached the amount.
    """
    if goal.kind != "target" or goal.cadence is None or goal.target_date is None:
        return None
    shortfall = max(goal.amount_cents - balance_cents, 0)
    periods = 0
    while _step(goal, as_of, periods + 1) <= goal.target_date:
        periods += 1
    return -(-shortfall // max(periods, 1))


def due_date(session: Session, goal: Goal) -> date | None:
    """The date shown for a goal, and the one definition of "due" both Categories and the pay
    screen read. A recurring bill's is its earliest unpaid due date — it does not roll past
    `as_of`, so an unpaid bill stays due (and reads overdue) instead of becoming next month's;
    a target's is its target date.
    """
    if goal.target_date is None:
        return None
    if goal.kind != "recurring_bill":
        return goal.target_date
    return earliest_unpaid_due_date(session, goal)


@dataclass
class Progress:
    balance_cents: int
    target_cents: int | None
    owed_cents: int | None
    due_date: date | None
    per_period_cents: int | None
    # A fixed Commitment's goal-row wording, worded once here (DESIGN.md § Goals): "$200.00 monthly
    # · next due Oct 31" / "$50.00 each payday", and "$140.00 of $200.00 this month" (none for each
    # payday, which has no period). Null for any other goal.
    commitment_cadence_text: str | None = None
    commitment_progress_text: str | None = None
    # A recurring bill's amount and cadence ("$87.00 yearly", "$120.00 every 2 weeks") or a Target's
    # per-period amount and cadence ("$100.00 monthly"), worded once here. Null for any other goal.
    per_period_text: str | None = None


def goal_progress(session: Session, goal: Goal, *, as_of: date) -> Progress:
    # Postgres sums come back as Decimal, whose // truncates toward zero — the round-up needs an int.
    balance = int(category_balance_cents(session, goal.category_id, as_of=as_of))
    if goal.kind == "commitment":
        target = goal.level_cents  # an "add" commitment has no target
        per_period = goal.amount_cents
    else:
        target = goal.amount_cents
        per_period = contribution_cents(goal, balance, as_of=as_of)
    return Progress(
        balance_cents=balance,
        target_cents=target,
        owed_cents=None if target is None else max(target - balance, 0),
        due_date=due_date(session, goal),
        per_period_cents=per_period,
        per_period_text=per_period_text(goal, per_period),
        **commitment_row_text(session, goal, as_of=as_of),
    )


def _month_end(day: date) -> date:
    return day.replace(day=calendar.monthrange(day.year, day.month)[1])


def _commitment_due(goal: Goal, n: int) -> date:
    """A fixed Commitment's nth due date: the first due month stepped by the cadence, always that
    month's last day (a bill's clamp would drift Nov 30 to Dec 30; a Commitment's never does)."""
    return _month_end(_step(goal, goal.first_due_on, n))


def _commitment_period(goal: Goal, day: date) -> tuple[date, date]:
    """The period of a Commitment with a cadence that `day` falls in: (start, due). Due is the
    earliest due date on or after `day`; the period starts the day after the previous due date, the
    first period included (one cadence step before the first due month). The one calculation both
    `commitment_ask` (at the payday) and the goal row (at the picker date) use.
    """
    n = 0
    while _commitment_due(goal, n) < day:
        n += 1
    return _commitment_due(goal, n - 1) + timedelta(days=1), _commitment_due(goal, n)


def _assigned_cents(session: Session, category_id: int, start: date, through: date) -> int:
    """Signed earmark lines to the category from `start` to `through` — spending never counts."""
    return int(session.scalar(
        select(func.coalesce(func.sum(EarmarkLine.cents), 0)).where(
            EarmarkLine.category_id == category_id, EarmarkLine.date >= start, EarmarkLine.date <= through
        )
    ))


def _periods_left(stream: IncomeStream, pivot: date, due: date) -> int:
    """Paydays of the stream from `pivot` (the pay being recorded, counted) up to `due`, at least 1."""
    periods = 0
    while step(stream.cadence, stream.cadence_weeks, pivot, periods) <= due:
        periods += 1
    return max(periods, 1)


@dataclass
class CommitmentAsk:
    instalment_cents: int
    assigned_cents: int
    due_on: date


def commitment_ask(session: Session, goal: Goal, stream: IncomeStream, *, as_of: date) -> CommitmentAsk | None:
    """A fixed Commitment with a cadence, spread over the paydays before its due date (DESIGN.md §
    Goals). Due: the earliest due date on or after the payday the screen is open for. Still
    missing: the amount less the signed earmark lines to the category from the period's start to
    that payday — spending never counts — floored at 0 and never above the amount. The period
    starts the day after the previous due date, the first period included (one cadence step before
    the first due month). None for a Commitment with no cadence (each payday).
    """
    if goal.kind != "commitment" or goal.amount_cents is None or goal.cadence is None or goal.first_due_on is None:
        return None
    pivot = next_payday(stream, as_of=as_of)
    start, due = _commitment_period(goal, pivot)
    assigned = _assigned_cents(session, goal.category_id, start, pivot)
    missing = min(max(goal.amount_cents - assigned, 0), goal.amount_cents)
    instalment = -(-missing // _periods_left(stream, pivot, due))
    return CommitmentAsk(instalment, assigned, due)


_PERIOD_LABELS = {"monthly": "this month", "quarterly": "this quarter", "semiannual": "this 6-month period", "yearly": "this year"}
_CADENCE_LABELS = {"monthly": "monthly", "quarterly": "quarterly", "semiannual": "every 6 months", "yearly": "yearly"}


def cadence_label(cadence: str, cadence_weeks: int | None) -> str:
    """A cadence in words: "monthly", "every 6 months", "every week", "every 2 weeks"."""
    if cadence == "weeks":
        return "every week" if cadence_weeks == 1 else f"every {cadence_weeks} weeks"
    return _CADENCE_LABELS[cadence]


def per_period_text(goal: Goal, per_period_cents: int | None) -> str | None:
    """The goal row's amount-and-cadence wording: a recurring bill's own amount, or a Target's
    per-period contribution when it has a cadence. Null for anything else."""
    if goal.cadence is None:
        return None
    if goal.kind == "recurring_bill" and goal.amount_cents is not None:
        return f"{dollars(goal.amount_cents)} {cadence_label(goal.cadence, goal.cadence_weeks)}"
    if goal.kind == "target" and per_period_cents is not None:
        return f"{dollars(per_period_cents)} {cadence_label(goal.cadence, goal.cadence_weeks)}"
    return None


def commitment_row_text(session: Session, goal: Goal, *, as_of: date) -> dict[str, str | None]:
    """A fixed Commitment's two goal-row lines, measured at the picker date and needing no bound
    pay: "$200.00 monthly · next due Oct 31" and "$140.00 of $200.00 this month" (assigned since the
    period began, capped at the amount). Each payday has no period, so it gets only "$50.00 each
    payday". Refill and percent-of-net carry no cadence, so both lines are null.
    """
    none = {"commitment_cadence_text": None, "commitment_progress_text": None}
    if goal.kind != "commitment" or goal.amount_cents is None:
        return none
    amount = dollars(goal.amount_cents)
    if goal.cadence is None or goal.first_due_on is None:
        return {"commitment_cadence_text": f"{amount} each payday", "commitment_progress_text": None}
    start, due = _commitment_period(goal, as_of)
    assigned = min(max(_assigned_cents(session, goal.category_id, start, as_of), 0), goal.amount_cents)
    return {
        "commitment_cadence_text": f"{amount} {_CADENCE_LABELS[goal.cadence]} · next due {_short_date(due, as_of=as_of)}",
        "commitment_progress_text": f"{dollars(assigned)} of {amount} {_PERIOD_LABELS[goal.cadence]}",
    }


def commitment_context(session: Session, goal: Goal, stream: IncomeStream, *, as_of: date) -> str | None:
    """The pay screen's context line for a fixed Commitment, worded once here: "each payday", or
    "$100.00 of $200.00 due Oct 31" ($100.00 assigned so far this period). None for any other."""
    if goal.kind != "commitment" or goal.amount_cents is None:
        return None
    ask = commitment_ask(session, goal, stream, as_of=as_of)
    if ask is None:
        return "each payday"
    assigned = min(max(ask.assigned_cents, 0), goal.amount_cents)
    return f"{dollars(assigned)} of {dollars(goal.amount_cents)} due {_short_date(ask.due_on, as_of=as_of)}"


def due_by_next_payday(session: Session, goal: Goal, stream: IncomeStream, *, as_of: date) -> int | None:
    """What a bound goal wants at its very next payday (DESIGN.md § Goals): the shortfall to the
    goal's amount, spread over the STREAM's paydays remaining up to the goal's due date — the
    $1,200 quarterly bill with $400 saved and two Salary paydays left wants $400 now. Counts the
    stream's cadence, not the goal's own (a quarterly bill still wants an instalment at each of
    its biweekly paydays), so it is not `contribution_cents`, which spreads a target's shortfall
    over its own cadence. A fixed Commitment with a cadence is the same spread, its "missing"
    being what was assigned this period rather than the balance (`commitment_ask`). None for a
    goal with no due date (a dateless Target, or a Commitment with no cadence — each payday is
    just its full amount).
    """
    if goal.kind == "commitment":
        ask = commitment_ask(session, goal, stream, as_of=as_of)
        return None if ask is None else ask.instalment_cents
    due = due_date(session, goal)
    if due is None:
        return None
    target = goal.amount_cents
    if target is None:
        return None
    balance = int(category_balance_cents(session, goal.category_id, as_of=as_of))
    shortfall = max(target - balance, 0)
    return -(-shortfall // _periods_left(stream, next_payday(stream, as_of=as_of), due))


def is_bill_due_date(goal: Goal, day: date) -> bool:
    """Whether `day` is one of a recurring bill's due dates: its first due date stepped forward
    by whole cadence periods (DESIGN.md § Goals). Stepping from the first date each time, never
    from the previous step, so a month-end clamp doesn't drift the later dates.
    """
    if goal.kind != "recurring_bill" or goal.target_date is None or day < goal.target_date:
        return False
    n = 0
    while _step(goal, goal.target_date, n) < day:
        n += 1
    return _step(goal, goal.target_date, n) == day


def linked_due_dates(session: Session, goal_id: int) -> set[date]:
    """The due dates of a bill that at least one transaction says it paid."""
    return set(session.scalars(
        select(Transaction.goal_due_on).where(Transaction.goal_id == goal_id, Transaction.goal_due_on.is_not(None))
    ))


def earliest_unpaid_due_date(session: Session, goal: Goal) -> date | None:
    """The first of a recurring bill's due dates with no linked transaction — computed at read
    time, never stored, so an unpaid bill stays due instead of rolling on (DESIGN.md § Goals).
    One linked payment marks a date paid whatever its amount. Links to dates no longer on the
    bill's cycle (after its cadence or first date was edited) mark nothing paid.
    """
    if goal.kind != "recurring_bill" or goal.target_date is None:
        return None
    paid = linked_due_dates(session, goal.id)
    n = 0
    while _step(goal, goal.target_date, n) in paid:
        n += 1
    return _step(goal, goal.target_date, n)


def offered_due_dates(session: Session, goal: Goal, *, before: int = 3, after: int = 8) -> list[tuple[date, bool]]:
    """The due dates the Ledger form lets a payment pick from: the earliest unpaid one, a few
    before it (a second payment against a date already paid) and a few after, each with whether
    it already has a linked payment.
    """
    earliest = earliest_unpaid_due_date(session, goal)
    if earliest is None:
        return []
    paid = linked_due_dates(session, goal.id)
    index = 0
    while _step(goal, goal.target_date, index) < earliest:
        index += 1
    return [
        (day, day in paid)
        for day in (_step(goal, goal.target_date, n) for n in range(max(index - before, 0), index + after + 1))
    ]


def goal_latest_linked_date(session: Session, goal_id: int) -> date | None:
    """The date of the latest transaction linked to a bill — what the archive guard checks."""
    return session.scalar(select(func.max(Transaction.date)).where(Transaction.goal_id == goal_id))


def last_payment(session: Session, goal: Goal) -> tuple[int | None, int | None] | None:
    """The payee and account of the latest transaction linked to a bill, read from the ledger and
    never stored (DESIGN.md § Paying a bill): what "record now" pre-fills. The account is the one
    the most money left (the first account line by id on a tie). None before any payment is linked.
    """
    latest = session.scalars(
        select(Transaction).where(Transaction.goal_id == goal.id).order_by(Transaction.date.desc(), Transaction.id.desc())
    ).first()
    if latest is None:
        return None
    account_id = session.scalar(
        select(AccountLine.account_id)
        .where(AccountLine.transaction_id == latest.id)
        .order_by(AccountLine.cents, AccountLine.id)
        .limit(1)
    )
    return latest.payee_id, account_id


def _short_date(day: date, *, as_of: date) -> str:
    """"Oct 1", with the year only when it isn't the picker's year."""
    text = f"{day:%b} {day.day}"
    return text if day.year == as_of.year else f"{text}, {day.year}"


def bill_status(
    session: Session, goal: Goal, *, as_of: date, stream: IncomeStream | None
) -> tuple[str, str] | None:
    """A recurring bill's status and its wording, computed here so no component words it again:
    "overdue" once `as_of` is past its earliest unpaid due date; "due" when that date falls
    strictly before the bound pay's next payday — the first payday strictly after `as_of`, so on
    payday itself the horizon is the payday still to come, not today (or is `as_of` itself for a
    bill bound to no pay); otherwise "next_due", including a bill due exactly on that next
    payday, which waits for that payday to arrive. None for any other kind of goal.
    """
    due = earliest_unpaid_due_date(session, goal)
    if due is None:
        return None
    day = _short_date(due, as_of=as_of)
    if due < as_of:
        return "overdue", f"overdue since {day}"
    if stream is None:
        horizon = as_of
        if due <= horizon:
            return "due", f"due {day} · not paid"
    else:
        horizon = next_payday(stream, as_of=as_of + timedelta(days=1))
        if due < horizon:
            return "due", f"due {day} · not paid"
    return "next_due", f"next due {day}"


def last_paid_due_date(session: Session, goal: Goal) -> date | None:
    """The latest of a bill's due dates that a transaction says it paid."""
    return max(linked_due_dates(session, goal.id), default=None)


def paid_against(session: Session, goal: Goal, due_on: date) -> int:
    """Cents paid against one due date: the bill's own category lines (a payment's outflow is
    negative, so the sign flips) on the transactions linked to that goal and date. Lines of other
    categories on a split payment are not this bill's money.
    """
    total = session.scalar(
        select(func.coalesce(func.sum(CategoryLine.cents), 0))
        .join(Transaction, Transaction.id == CategoryLine.transaction_id)
        .where(
            Transaction.goal_id == goal.id,
            Transaction.goal_due_on == due_on,
            CategoryLine.category_id == goal.category_id,
        )
    )
    return -int(total)


def last_paid_text(session: Session, goal: Goal, *, as_of: date) -> tuple[date, int, str] | None:
    """The last paid due date, what was paid against it, and its wording next to what the bill
    expected: "Oct 1 paid · $112.40 of $120.00". None when nothing was paid yet.
    """
    due_on = last_paid_due_date(session, goal)
    if due_on is None:
        return None
    paid = paid_against(session, goal, due_on)
    text = f"{_short_date(due_on, as_of=as_of)} paid · {dollars(paid)} of {dollars(goal.amount_cents)}"
    return due_on, paid, text
