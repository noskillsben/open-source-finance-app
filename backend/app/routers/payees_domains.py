from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db import get_session
from app.models import Domain, Payee
from app.schemas import ArchiveIn, ArchiveOut, DomainCreate, DomainOut, DomainUpdate, PayeeCreate, PayeeOut
from app.seed import guard_not_me, is_me
from app.services.archiving import Archivable, ArchiveError, _visible, archive, unarchive
from app.services.payees import payee_latest_ledger_date

router = APIRouter()



@router.get("/api/domains", response_model=list[DomainOut])
def list_domains(
    as_of: date | None = None, include_archived: bool = False, session: Session = Depends(get_session)
) -> list[DomainOut]:
    domains = session.scalars(
        select(Domain).where(_visible(Domain, as_of, include_archived)).order_by(Domain.name)
    ).all()
    return [DomainOut.model_validate(d) for d in domains]


@router.post("/api/domains", response_model=DomainOut, status_code=201)
def create_domain(payload: DomainCreate, session: Session = Depends(get_session)) -> DomainOut:
    domain = Domain(name=payload.name, description=payload.description, created_on=payload.created_on)
    session.add(domain)
    try:
        session.flush()
    except IntegrityError:
        raise HTTPException(status_code=409, detail=f"A domain named {payload.name!r} already exists.")
    return DomainOut.model_validate(domain)


@router.put("/api/domains/{domain_id}", response_model=DomainOut)
def update_domain(domain_id: int, payload: DomainUpdate, session: Session = Depends(get_session)) -> DomainOut:
    domain = session.get(Domain, domain_id)
    if domain is None:
        raise HTTPException(status_code=404, detail=f"No domain with id {domain_id}.")
    domain.name = payload.name
    domain.description = payload.description
    try:
        session.flush()
    except IntegrityError:
        raise HTTPException(status_code=409, detail=f"A domain named {payload.name!r} already exists.")
    return DomainOut.model_validate(domain)


@router.post("/api/domains/{domain_id}/archive", response_model=ArchiveOut)
def archive_domain(
    domain_id: int, payload: ArchiveIn, session: Session = Depends(get_session)
) -> ArchiveOut:
    domain = session.get(Domain, domain_id)
    if domain is None:
        raise HTTPException(status_code=404, detail=f"No domain with id {domain_id}.")
    # No ledger row points at a domain (it is a reporting label on categories), so there is no
    # date bound and no balance to warn about.
    try:
        warnings = archive(Archivable(entity=domain, latest_ledger_date=None), payload.archived_on)
    except ArchiveError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    session.flush()
    return ArchiveOut(id=domain.id, archived_on=domain.archived_on, warnings=warnings)


@router.post("/api/domains/{domain_id}/unarchive", response_model=ArchiveOut)
def unarchive_domain(domain_id: int, session: Session = Depends(get_session)) -> ArchiveOut:
    domain = session.get(Domain, domain_id)
    if domain is None:
        raise HTTPException(status_code=404, detail=f"No domain with id {domain_id}.")
    name = domain.name  # read before the flush: a failed flush rolls the session back and expires the row
    unarchive(domain)
    try:
        session.flush()
    except IntegrityError:
        raise HTTPException(status_code=409, detail=f"A domain named {name!r} already exists.")
    return ArchiveOut(id=domain.id, archived_on=domain.archived_on, warnings=[])


@router.get("/api/payees", response_model=list[PayeeOut])
def list_payees(
    as_of: date | None = None, include_archived: bool = False, session: Session = Depends(get_session)
) -> list[PayeeOut]:
    payees = session.scalars(
        select(Payee).where(_visible(Payee, as_of, include_archived)).order_by(Payee.name)
    ).all()
    return [
        PayeeOut(id=p.id, name=p.name, created_on=p.created_on, archived_on=p.archived_on, is_me=is_me(p))
        for p in payees
    ]


@router.post("/api/payees", response_model=PayeeOut, status_code=201)
def create_payee(payload: PayeeCreate, session: Session = Depends(get_session)) -> PayeeOut:
    payee = Payee(name=payload.name, created_on=payload.created_on)
    session.add(payee)
    try:
        session.flush()
    except IntegrityError:
        raise HTTPException(status_code=409, detail=f"A payee named {payload.name!r} already exists.")
    return PayeeOut(id=payee.id, name=payee.name, created_on=payee.created_on, archived_on=payee.archived_on)


@router.post("/api/payees/{payee_id}/archive", response_model=ArchiveOut)
def archive_payee(
    payee_id: int, payload: ArchiveIn, session: Session = Depends(get_session)
) -> ArchiveOut:
    payee = session.get(Payee, payee_id)
    if payee is None:
        raise HTTPException(status_code=404, detail=f"No payee with id {payee_id}.")
    try:
        guard_not_me(payee)
        target = Archivable(entity=payee, latest_ledger_date=payee_latest_ledger_date(session, payee_id))
        warnings = archive(target, payload.archived_on)
    except ArchiveError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    session.flush()
    return ArchiveOut(id=payee.id, archived_on=payee.archived_on, warnings=warnings)


@router.post("/api/payees/{payee_id}/unarchive", response_model=ArchiveOut)
def unarchive_payee(payee_id: int, session: Session = Depends(get_session)) -> ArchiveOut:
    payee = session.get(Payee, payee_id)
    if payee is None:
        raise HTTPException(status_code=404, detail=f"No payee with id {payee_id}.")
    name = payee.name  # read before the flush: a failed flush rolls the session back and expires the row
    unarchive(payee)
    try:
        session.flush()
    except IntegrityError:
        raise HTTPException(status_code=409, detail=f"A payee named {name!r} already exists.")
    return ArchiveOut(id=payee.id, archived_on=payee.archived_on, warnings=[])
