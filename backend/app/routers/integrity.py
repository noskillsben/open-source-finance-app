from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db import get_session
from app.schemas import IntegrityFindingOut
from app.services.integrity import find_integrity_issues

router = APIRouter()



@router.get("/api/integrity-check", response_model=list[IntegrityFindingOut])
def integrity_check(session: Session = Depends(get_session)) -> list[IntegrityFindingOut]:
    """The app's own integrity check, not a dev-only tool (DESIGN.md § Transactions →
    Invariant): replays every transaction and lists any drift. No fixing here — that's
    `re_save_transaction`, one row at a time.
    """
    return [
        IntegrityFindingOut(
            transaction_id=f.transaction_id, date=f.date, payee_id=f.payee_id,
            kind=f.kind, expected_cents=f.expected_cents, stored_cents=f.stored_cents,
        )
        for f in find_integrity_issues(session)
    ]
