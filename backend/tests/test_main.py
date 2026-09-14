"""Route-level wiring for `GET /api/accounts` (DESIGN.md § General concepts, One clock:
the date picker). `account_balance_cents` itself is covered in test_accounts.py; this
checks the `as_of` query param actually reaches it.
"""
import datetime

from fastapi.testclient import TestClient

from app.db import get_session
from app.main import app
from app.services.accounts import create_account_with_opening_valuation
from app.services.transactions import write_transaction

EARLIER = datetime.date(2026, 3, 1)
LATER = datetime.date(2026, 3, 15)


def _client(db_session):
    def override():
        yield db_session

    app.dependency_overrides[get_session] = override
    return TestClient(app)


def test_accounts_as_of_reflects_balance_on_that_date_not_today(db_session):
    account = create_account_with_opening_valuation(
        db_session, name="Chequing", created_on=EARLIER, type="Chequing",
        on_budget=True, on_budget_floor_cents=0, opening_balance_cents=500_00,
    )
    write_transaction(
        db_session, transaction=None, txn_date=LATER, memo=None, payee_id=None,
        account_lines=[{"account_id": account.id, "cents": -100_00}],
        category_lines=[],
    )
    db_session.flush()

    client = _client(db_session)
    try:
        as_of_earlier = client.get(f"/api/accounts?as_of={EARLIER.isoformat()}")
        as_of_later = client.get(f"/api/accounts?as_of={LATER.isoformat()}")
    finally:
        app.dependency_overrides.clear()

    assert as_of_earlier.status_code == 200
    earlier_balance = next(a for a in as_of_earlier.json() if a["id"] == account.id)["balance_cents"]
    later_balance = next(a for a in as_of_later.json() if a["id"] == account.id)["balance_cents"]

    assert earlier_balance == 500_00  # the -100 line, dated after EARLIER, isn't counted yet
    assert later_balance == 400_00
