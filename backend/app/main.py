from fastapi import Depends, FastAPI, HTTPException
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config import settings
from app.db import get_session
from app.models import Account
from app.schemas import AccountCreate, AccountOut, Health
from app.services.accounts import account_balance_cents, create_account_with_opening_valuation

app = FastAPI(title="Open Source Finance App", version="0.0.1", docs_url="/docs", openapi_url="/api/openapi.json")


@app.get("/api/health", response_model=Health)
def health(session: Session = Depends(get_session)) -> Health:
    try:
        session.execute(text("SELECT 1"))
        database = "ok"
    except Exception as exc:  # the health page is the one place a swallowed error is acceptable
        database = f"error: {type(exc).__name__}"
    return Health(status="ok", database=database, app_mode=settings.app_mode)


@app.get("/api/accounts", response_model=list[AccountOut])
def list_accounts(session: Session = Depends(get_session)) -> list[AccountOut]:
    accounts = session.scalars(select(Account).order_by(Account.name)).all()
    return [
        AccountOut(
            id=a.id, name=a.name, created_on=a.created_on, type=a.type,
            on_budget=a.on_budget, on_budget_floor_cents=a.on_budget_floor_cents,
            balance_cents=account_balance_cents(a),
        )
        for a in accounts
    ]


@app.post("/api/accounts", response_model=AccountOut, status_code=201)
def create_account(payload: AccountCreate, session: Session = Depends(get_session)) -> AccountOut:
    try:
        account = create_account_with_opening_valuation(
            session,
            name=payload.name,
            created_on=payload.created_on,
            type=payload.type,
            on_budget=payload.on_budget,
            on_budget_floor_cents=payload.on_budget_floor_cents,
            opening_balance_cents=payload.opening_balance_cents,
            **payload.terms.model_dump(),
        )
    except IntegrityError:
        raise HTTPException(status_code=409, detail=f"An account named {payload.name!r} already exists.")
    return AccountOut(
        id=account.id, name=account.name, created_on=account.created_on, type=account.type,
        on_budget=account.on_budget, on_budget_floor_cents=account.on_budget_floor_cents,
        balance_cents=payload.opening_balance_cents,
    )
