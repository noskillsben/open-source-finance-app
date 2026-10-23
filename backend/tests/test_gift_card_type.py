import datetime

import pytest
from fastapi.testclient import TestClient

from app.account_types import ACCOUNT_TYPES
from app.db import get_session
from app.main import app

DAY = datetime.date(2026, 10, 3)


@pytest.fixture()
def client(db_session):
    def override():
        yield db_session

    app.dependency_overrides[get_session] = override
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.clear()


def test_gift_card_type_is_accepted_and_defaults_on_budget(client):
    assert ACCOUNT_TYPES["Gift card / store credit"] is True
    response = client.post("/api/accounts", json={
        "name": "Shop card", "created_on": DAY.isoformat(), "type": "Gift card / store credit",
        "on_budget": True, "opening_balance_cents": 2_500,
    })
    assert response.status_code == 201, response.text
    assert response.json()["type"] == "Gift card / store credit"
    assert response.json()["on_budget"] is True
