from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db import get_session
from app.models import IncomeStream
from app.routers.shapes import _transaction_shape
from app.schemas import ArchiveIn, ArchiveOut, CategoryActualOut, IncomeStreamIn, IncomeStreamOut, PayPeriodOut
from app.services.archiving import Archivable, ArchiveError, _visible, archive, unarchive
from app.services.income_streams import (
    IncomeStreamError, apply_income_stream, income_stream_latest_ledger_date, next_payday, pay_period,
    recorded_pay_transaction,
)
from app.services.transactions import read_deposits

router = APIRouter()



def _income_stream_out(session: Session, stream: IncomeStream, *, as_of: date) -> IncomeStreamOut:
    upcoming = next_payday(stream, as_of=as_of)
    return IncomeStreamOut(
        id=stream.id, name=stream.name, payee_id=stream.payee_id, cadence=stream.cadence,
        cadence_weeks=stream.cadence_weeks, anchor_payday=stream.anchor_payday,
        expected_gross_cents=stream.expected_gross_cents,
        expected_net_low_cents=stream.expected_net_low_cents,
        expected_net_high_cents=stream.expected_net_high_cents,
        income_category_id=stream.income_category_id, destination_account_id=stream.destination_account_id,
        deductions=[
            {"id": d.id, "category_id": d.category_id, "amount_cents": d.amount_cents} for d in stream.deductions
        ],
        created_on=stream.created_on, archived_on=stream.archived_on,
        next_payday=upcoming,
        # The same lookup the pay screen's period call uses, so the two never disagree.
        next_payday_recorded=recorded_pay_transaction(session, stream.id, upcoming) is not None,
    )


@router.get("/api/income-streams", response_model=list[IncomeStreamOut])
def list_income_streams(
    as_of: date, include_archived: bool = False, session: Session = Depends(get_session)
) -> list[IncomeStreamOut]:
    streams = session.scalars(
        select(IncomeStream).where(_visible(IncomeStream, as_of, include_archived)).order_by(IncomeStream.name)
    ).all()
    return [_income_stream_out(session, s, as_of=as_of) for s in streams]


@router.get("/api/pay-period", response_model=PayPeriodOut)
def get_pay_period(
    payday: date, income_stream_id: int | None = None, session: Session = Depends(get_session)
) -> PayPeriodOut:
    """The pay screen's facts for one payday; no `income_stream_id` is a one-off."""
    stream = None
    if income_stream_id is not None:
        stream = session.get(IncomeStream, income_stream_id)
        if stream is None:
            raise HTTPException(status_code=404, detail=f"No named pay with id {income_stream_id}.")
    period = pay_period(session, stream, payday)
    return PayPeriodOut(
        period_end=period.period_end,
        previous_payday=period.previous_payday,
        # The list's shape: no notes (those belong to a save), deposits included.
        recorded=_transaction_shape(period.recorded, [], read_deposits(session, period.recorded)) if period.recorded else None,
        last_period_actuals=[
            CategoryActualOut(category_id=cid, cents=cents)
            for cid, cents in sorted(period.last_period_actuals.items())
        ],
    )


@router.post("/api/income-streams", response_model=IncomeStreamOut, status_code=201)
def create_income_stream(payload: IncomeStreamIn, session: Session = Depends(get_session)) -> IncomeStreamOut:
    try:
        stream = apply_income_stream(
            session, None, on=payload.on, name=payload.name, payee_id=payload.payee_id,
            cadence=payload.cadence, cadence_weeks=payload.cadence_weeks, anchor_payday=payload.anchor_payday,
            expected_gross_cents=payload.expected_gross_cents,
            expected_net_low_cents=payload.expected_net_low_cents,
            expected_net_high_cents=payload.expected_net_high_cents,
            income_category_id=payload.income_category_id, destination_account_id=payload.destination_account_id,
            deductions=[d.model_dump() for d in payload.deductions],
        )
    except IncomeStreamError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    try:
        session.flush()
    except IntegrityError:
        raise HTTPException(status_code=409, detail=f"A named pay called {payload.name!r} already exists.")
    return _income_stream_out(session, stream, as_of=payload.on)


@router.put("/api/income-streams/{income_stream_id}", response_model=IncomeStreamOut)
def update_income_stream(
    income_stream_id: int, payload: IncomeStreamIn, session: Session = Depends(get_session)
) -> IncomeStreamOut:
    stream = session.get(IncomeStream, income_stream_id)
    if stream is None:
        raise HTTPException(status_code=404, detail=f"No named pay with id {income_stream_id}.")
    try:
        stream = apply_income_stream(
            session, stream, on=payload.on, name=payload.name, payee_id=payload.payee_id,
            cadence=payload.cadence, cadence_weeks=payload.cadence_weeks, anchor_payday=payload.anchor_payday,
            expected_gross_cents=payload.expected_gross_cents,
            expected_net_low_cents=payload.expected_net_low_cents,
            expected_net_high_cents=payload.expected_net_high_cents,
            income_category_id=payload.income_category_id, destination_account_id=payload.destination_account_id,
            deductions=[d.model_dump() for d in payload.deductions],
        )
    except IncomeStreamError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    try:
        session.flush()
    except IntegrityError:
        raise HTTPException(status_code=409, detail=f"A named pay called {payload.name!r} already exists.")
    return _income_stream_out(session, stream, as_of=payload.on)


@router.post("/api/income-streams/{income_stream_id}/archive", response_model=ArchiveOut)
def archive_income_stream(
    income_stream_id: int, payload: ArchiveIn, session: Session = Depends(get_session)
) -> ArchiveOut:
    stream = session.get(IncomeStream, income_stream_id)
    if stream is None:
        raise HTTPException(status_code=404, detail=f"No named pay with id {income_stream_id}.")
    latest_ledger_date = income_stream_latest_ledger_date(session, stream.id)
    try:
        warnings = archive(Archivable(entity=stream, latest_ledger_date=latest_ledger_date), payload.archived_on)
    except ArchiveError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    session.flush()
    return ArchiveOut(id=stream.id, archived_on=stream.archived_on, warnings=warnings)


@router.post("/api/income-streams/{income_stream_id}/unarchive", response_model=ArchiveOut)
def unarchive_income_stream(income_stream_id: int, session: Session = Depends(get_session)) -> ArchiveOut:
    stream = session.get(IncomeStream, income_stream_id)
    if stream is None:
        raise HTTPException(status_code=404, detail=f"No named pay with id {income_stream_id}.")
    name = stream.name  # read before the flush: a failed flush rolls the session back and expires the row
    unarchive(stream)
    try:
        session.flush()
    except IntegrityError:
        raise HTTPException(status_code=409, detail=f"A named pay called {name!r} already exists.")
    return ArchiveOut(id=stream.id, archived_on=stream.archived_on, warnings=[])
