from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_session
from app.models import Account, Split
from app.routers.shapes import _transaction_shape
from app.schemas import ArchiveIn, ArchiveOut, MemberBalanceOut, SplitCreate, SplitMemberOut, SplitOut, SplitUpdate
from app.services.archiving import ArchiveError, _visible
from app.services.splits import (
    SplitError, archive_split, balance_since_zero, create_split, my_share_percent, shown_members, unarchive_split_checked, update_split,
)

router = APIRouter()


def _split_out(split: Split, as_of: date | None = None) -> SplitOut:
    members = shown_members(split, as_of)
    return SplitOut(
        id=split.id, name=split.name, description=split.description,
        created_on=split.created_on, archived_on=split.archived_on,
        members=[
            SplitMemberOut(
                id=m.id, payee_id=m.payee_id, payee_name=m.payee.name,
                account_id=m.account_id, account_name=m.account.name, percent=m.percent,
            )
            for m in members
        ],
        my_share_percent=my_share_percent([m.percent for m in members]),
    )


def _get(session: Session, split_id: int) -> Split:
    split = session.get(Split, split_id)
    if split is None:
        raise HTTPException(status_code=404, detail=f"No split with id {split_id}.")
    return split


@router.get("/api/splits", response_model=list[SplitOut])
def list_splits(
    as_of: date | None = None, include_archived: bool = False, session: Session = Depends(get_session)
) -> list[SplitOut]:
    splits = session.scalars(
        select(Split).where(_visible(Split, as_of, include_archived)).order_by(Split.name)
    ).all()
    return [_split_out(s, as_of) for s in splits]


@router.get("/api/splits/accounts/{account_id}/balance", response_model=MemberBalanceOut)
def member_balance(account_id: int, as_of: date | None = None, session: Session = Depends(get_session)) -> MemberBalanceOut:
    if session.get(Account, account_id) is None:
        raise HTTPException(status_code=404, detail=f"No account with id {account_id}.")
    balance, transactions = balance_since_zero(session, account_id, as_of)
    return MemberBalanceOut(
        account_id=account_id, balance_cents=balance,
        transactions=[_transaction_shape(t, []) for t in transactions],
    )


@router.post("/api/splits", response_model=SplitOut, status_code=201)
def create_split_route(payload: SplitCreate, session: Session = Depends(get_session)) -> SplitOut:
    try:
        split = create_split(
            session, name=payload.name, description=payload.description,
            created_on=payload.created_on, members=payload.members,
        )
    except SplitError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc))
    return _split_out(split)


@router.put("/api/splits/{split_id}", response_model=SplitOut)
def update_split_route(split_id: int, payload: SplitUpdate, session: Session = Depends(get_session)) -> SplitOut:
    split = _get(session, split_id)
    try:
        _, warnings = update_split(
            session, split, name=payload.name, description=payload.description,
            as_of=payload.as_of, members=payload.members,
        )
    except SplitError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc))
    out = _split_out(split)
    out.warnings = warnings
    return out


@router.post("/api/splits/{split_id}/archive", response_model=ArchiveOut)
def archive_split_route(
    split_id: int, payload: ArchiveIn, session: Session = Depends(get_session)
) -> ArchiveOut:
    split = _get(session, split_id)
    try:
        warnings = archive_split(session, split, payload.archived_on)
    except ArchiveError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    session.flush()
    return ArchiveOut(id=split.id, archived_on=split.archived_on, warnings=warnings)


@router.post("/api/splits/{split_id}/unarchive", response_model=ArchiveOut)
def unarchive_split_route(split_id: int, session: Session = Depends(get_session)) -> ArchiveOut:
    split = _get(session, split_id)
    try:
        unarchive_split_checked(session, split)
    except SplitError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc))
    return ArchiveOut(id=split.id, archived_on=split.archived_on, warnings=[])
