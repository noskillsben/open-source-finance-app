from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, true
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db import get_session
from app.models import Account, Category, Goal, IncomeStream
from app.schemas import (
    ArchiveIn,
    ArchiveOut,
    BillDueDateOut,
    BillLastPaymentOut,
    CategoryCreate,
    CategoryLinksIn,
    CategoryOut,
    CategoryUpdate,
    GoalIn,
    GoalOut,
    GoalProgressOut,
    LinkedAccountOut,
)
from app.services.archiving import Archivable, ArchiveError, _visible, archive, unarchive
from app.services.categories import CategoryError, apply_category_settings, build_category_archivable
from app.services.earmarks import sweep_archived_category_tree
from app.services.goals import (
    GoalError, _short_date, apply_goal, bill_status, commitment_context, due_by_next_payday, earliest_unpaid_due_date,
    goal_latest_linked_date, goal_progress, last_paid_text, last_payment, live_goal, offered_due_dates,
    unbound_bill_horizon,
)
from app.services.links import (
    LinkError,
    linked_accounts_by_category,
    prune_archived_links,
    set_category_links,
)

router = APIRouter()



def _category_out(category: Category, linked: dict[int, list[Account]]) -> CategoryOut:
    out = CategoryOut.model_validate(category)
    out.linked_accounts = [LinkedAccountOut.model_validate(a) for a in linked.get(category.id, [])]
    return out


@router.get("/api/categories", response_model=list[CategoryOut])
def list_categories(
    as_of: date | None = None, include_archived: bool = False, session: Session = Depends(get_session)
) -> list[CategoryOut]:
    categories = session.scalars(
        select(Category).where(_visible(Category, as_of, include_archived)).order_by(Category.name)
    ).all()
    linked = linked_accounts_by_category(session)
    return [_category_out(c, linked) for c in categories]


@router.post("/api/categories", response_model=CategoryOut, status_code=201)
def create_category(payload: CategoryCreate, session: Session = Depends(get_session)) -> CategoryOut:
    category = Category(created_on=payload.created_on)
    try:
        apply_category_settings(
            session, category, name=payload.name, parent_id=payload.parent_id,
            pool_id=payload.pool_id, domain_id=payload.domain_id, need_level=payload.need_level,
            absorb_overspending=payload.absorb_overspending,
        )
    except CategoryError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    session.add(category)
    try:
        session.flush()
    except IntegrityError:
        raise HTTPException(status_code=409, detail=f"A category named {payload.name!r} already exists.")
    return _category_out(category, linked_accounts_by_category(session))


@router.put("/api/categories/{category_id}", response_model=CategoryOut)
def update_category(
    category_id: int, payload: CategoryUpdate, session: Session = Depends(get_session)
) -> CategoryOut:
    category = session.get(Category, category_id)
    if category is None:
        raise HTTPException(status_code=404, detail=f"No category with id {category_id}.")
    try:
        apply_category_settings(
            session, category, name=payload.name, parent_id=payload.parent_id,
            pool_id=payload.pool_id, domain_id=payload.domain_id, need_level=payload.need_level,
            absorb_overspending=payload.absorb_overspending,
        )
    except CategoryError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    try:
        session.flush()
    except IntegrityError:
        raise HTTPException(status_code=409, detail=f"A category named {payload.name!r} already exists.")
    return _category_out(category, linked_accounts_by_category(session))


@router.put("/api/categories/{category_id}/linked-accounts", response_model=CategoryOut)
def set_linked_accounts(
    category_id: int, payload: CategoryLinksIn, session: Session = Depends(get_session)
) -> CategoryOut:
    """DESIGN.md § Linked categories: replace the on-budget accounts this category's money
    lives in. Many-to-many; an empty list unlinks.
    """
    category = session.get(Category, category_id)
    if category is None:
        raise HTTPException(status_code=404, detail=f"No category with id {category_id}.")
    try:
        set_category_links(session, category, payload.account_ids, as_of=payload.on)
    except LinkError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return _category_out(category, linked_accounts_by_category(session))


@router.get("/api/goals", response_model=list[GoalProgressOut])
def list_goals(
    as_of: date, include_archived: bool = False, any_date: bool = False, session: Session = Depends(get_session)
) -> list[GoalProgressOut]:
    """Every goal shown on `as_of`, each with its progress — the picker date is the only "today".
    `any_date` skips the created-on filter (archived included) so a ledger row can still name a goal
    created after `as_of`; progress is still computed at `as_of`."""
    visible = true() if any_date else _visible(Goal, as_of, include_archived)
    goals = session.scalars(select(Goal).where(visible).order_by(Goal.category_id)).all()
    horizon = unbound_bill_horizon(session, as_of=as_of)
    out = []
    for g in goals:
        due_cents = None
        context_text = None
        stream = session.get(IncomeStream, g.income_stream_id) if g.income_stream_id is not None else None
        if stream is not None:
            due_cents = due_by_next_payday(session, g, stream, as_of=as_of)
            context_text = commitment_context(session, g, stream, as_of=as_of)
        status = bill_status(session, g, as_of=as_of, stream=stream, horizon=horizon)
        last_paid = last_paid_text(session, g, as_of=as_of) if g.kind == "recurring_bill" else None
        earliest_unpaid = earliest_unpaid_due_date(session, g)
        out.append(
            GoalProgressOut(
                goal=GoalOut.model_validate(g),
                due_by_next_payday_cents=due_cents,
                commitment_context_text=context_text,
                earliest_unpaid_due_on=earliest_unpaid,
                earliest_unpaid_due_text=_short_date(earliest_unpaid, as_of=as_of) if earliest_unpaid else None,
                bill_status=status[0] if status else None,
                bill_status_text=status[1] if status else None,
                last_paid_due_on=last_paid[0] if last_paid else None,
                last_paid_cents=last_paid[1] if last_paid else None,
                last_paid_text=last_paid[2] if last_paid else None,
                **vars(goal_progress(session, g, as_of=as_of, stream=stream)),
            )
        )
    return out


@router.get("/api/goals/{goal_id}/due-dates", response_model=list[BillDueDateOut])
def list_bill_due_dates(goal_id: int, session: Session = Depends(get_session)) -> list[BillDueDateOut]:
    """The due dates a payment can say it paid, earliest unpaid first among them (DESIGN.md §
    Goals → Paying a bill): a few already-paid ones before it, a few coming after."""
    goal = session.get(Goal, goal_id)
    if goal is None:
        raise HTTPException(status_code=404, detail=f"No goal with id {goal_id}.")
    if goal.kind != "recurring_bill":
        raise HTTPException(status_code=400, detail=f"{goal.name!r} is not a recurring bill.")
    earliest = earliest_unpaid_due_date(session, goal)
    return [
        BillDueDateOut(due_on=day, paid=paid, earliest_unpaid=day == earliest)
        for day, paid in offered_due_dates(session, goal)
    ]


@router.get("/api/goals/{goal_id}/last-payment", response_model=BillLastPaymentOut)
def get_bill_last_payment(goal_id: int, session: Session = Depends(get_session)) -> BillLastPaymentOut:
    """The payee and account of the bill's last linked payment, for "record now" to pre-fill
    (DESIGN.md § Paying a bill); both null until a payment is linked."""
    goal = session.get(Goal, goal_id)
    if goal is None:
        raise HTTPException(status_code=404, detail=f"No goal with id {goal_id}.")
    if goal.kind != "recurring_bill":
        raise HTTPException(status_code=400, detail=f"{goal.name!r} is not a recurring bill.")
    payment = last_payment(session, goal)
    return BillLastPaymentOut(payee_id=payment[0], account_id=payment[1]) if payment else BillLastPaymentOut()


@router.put("/api/categories/{category_id}/goal", response_model=GoalOut)
def set_category_goal(category_id: int, payload: GoalIn, session: Session = Depends(get_session)) -> GoalOut:
    """Create the category's goal, or replace its live one — one goal per category."""
    category = session.get(Category, category_id)
    if category is None:
        raise HTTPException(status_code=404, detail=f"No category with id {category_id}.")
    try:
        goal = apply_goal(
            session, category, live_goal(session, category_id), on=payload.on, name=payload.name,
            kind=payload.kind, amount_cents=payload.amount_cents, cadence=payload.cadence,
            cadence_weeks=payload.cadence_weeks, first_due_on=payload.first_due_on,
            target_date=payload.target_date, level_cents=payload.level_cents,
            income_stream_id=payload.income_stream_id, percent_of_net=payload.percent_of_net,
        )
    except GoalError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    session.flush()
    return GoalOut.model_validate(goal)


@router.post("/api/categories/{category_id}/goal/archive", response_model=ArchiveOut)
def archive_category_goal(
    category_id: int, payload: ArchiveIn, session: Session = Depends(get_session)
) -> ArchiveOut:
    goal = live_goal(session, category_id)
    if goal is None:
        raise HTTPException(status_code=404, detail=f"Category {category_id} has no goal.")
    # A bill can't be archived on or before its latest linked payment (DESIGN.md § Paying a bill).
    try:
        warnings = archive(
            Archivable(entity=goal, latest_ledger_date=goal_latest_linked_date(session, goal.id)),
            payload.archived_on,
        )
    except ArchiveError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    session.flush()
    return ArchiveOut(id=goal.id, archived_on=goal.archived_on, warnings=warnings)


@router.post("/api/categories/{category_id}/archive", response_model=ArchiveOut)
def archive_category(
    category_id: int, payload: ArchiveIn, session: Session = Depends(get_session)
) -> ArchiveOut:
    category = session.get(Category, category_id)
    if category is None:
        raise HTTPException(status_code=404, detail=f"No category with id {category_id}.")
    target = build_category_archivable(session, category, as_of=payload.archived_on)
    try:
        archive(target, payload.archived_on)
    except ArchiveError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    notes = sweep_archived_category_tree(session, target, archived_on=payload.archived_on)
    session.flush()
    prune_archived_links(session)
    return ArchiveOut(id=category.id, archived_on=category.archived_on, warnings=notes)



@router.post("/api/categories/{category_id}/unarchive", response_model=ArchiveOut)
def unarchive_category(category_id: int, session: Session = Depends(get_session)) -> ArchiveOut:
    category = session.get(Category, category_id)
    if category is None:
        raise HTTPException(status_code=404, detail=f"No category with id {category_id}.")
    name = category.name  # read before the flush: a failed flush rolls the session back and expires the row
    unarchive(category)
    try:
        session.flush()
    except IntegrityError:
        raise HTTPException(status_code=409, detail=f"A category named {name!r} already exists.")
    return ArchiveOut(id=category.id, archived_on=category.archived_on, warnings=[])
