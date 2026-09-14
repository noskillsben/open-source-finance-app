"""DESIGN.md § Transactions — every row of the worked-examples table is a test case, plus the
one thing the app refuses: category lines that don't sum to the budget movement.
"""
import datetime

import pytest

from app.models import Category
from app.services.accounts import account_balance_cents, create_account_with_opening_valuation
from app.services.transactions import TransactionError, write_transaction

TODAY = datetime.date(2026, 3, 1)


def make_account(db_session, name, *, type="Chequing", on_budget=True, floor=0, opening_balance=0):
    account = create_account_with_opening_valuation(
        db_session, name=name, created_on=TODAY, type=type,
        on_budget=on_budget, on_budget_floor_cents=floor, opening_balance_cents=opening_balance,
    )
    db_session.flush()
    return account


def make_category(db_session, name):
    category = Category(name=name)
    db_session.add(category)
    db_session.flush()
    return category


def test_groceries_on_debit(db_session):
    chequing = make_account(db_session, "Chequing", opening_balance=500_00)
    groceries = make_category(db_session, "Groceries")

    txn = write_transaction(
        db_session, transaction=None, txn_date=TODAY, memo=None, payee_id=None,
        account_lines=[{"account_id": chequing.id, "cents": -80_00}],
        category_lines=[{"category_id": groceries.id, "cents": -80_00}],
    )

    assert txn.account_lines[0].budget_cents == -80_00
    assert account_balance_cents(db_session, chequing.id) == 420_00


def test_groceries_on_credit_card_above_floor(db_session):
    card = make_account(db_session, "Card", type="Credit card", floor=-1_000_00, opening_balance=-200_00)
    groceries = make_category(db_session, "Groceries")

    txn = write_transaction(
        db_session, transaction=None, txn_date=TODAY, memo=None, payee_id=None,
        account_lines=[{"account_id": card.id, "cents": -100_00}],
        category_lines=[{"category_id": groceries.id, "cents": -100_00}],
    )

    assert txn.account_lines[0].budget_cents == -100_00


def test_pay_the_card_above_floor(db_session):
    chequing = make_account(db_session, "Chequing", opening_balance=1_000_00)
    card = make_account(db_session, "Card", type="Credit card", floor=-1_000_00, opening_balance=-300_00)

    txn = write_transaction(
        db_session, transaction=None, txn_date=TODAY, memo=None, payee_id=None,
        account_lines=[
            {"account_id": chequing.id, "cents": -300_00},
            {"account_id": card.id, "cents": 300_00},
        ],
        category_lines=[],
    )

    lines = {line.account_id: line.budget_cents for line in txn.account_lines}
    assert lines[chequing.id] == -300_00
    assert lines[card.id] == 300_00


def test_pay_the_card_eating_tracked_debt_first(db_session):
    chequing = make_account(db_session, "Chequing", opening_balance=1_000_00)
    card = make_account(db_session, "Card", type="Credit card", floor=-1_000_00, opening_balance=-2_000_00)
    debt_payments = make_category(db_session, "Debt payments")

    txn = write_transaction(
        db_session, transaction=None, txn_date=TODAY, memo=None, payee_id=None,
        account_lines=[
            {"account_id": chequing.id, "cents": -300_00},
            {"account_id": card.id, "cents": 300_00},
        ],
        category_lines=[{"category_id": debt_payments.id, "cents": -300_00}],
    )

    lines = {line.account_id: line.budget_cents for line in txn.account_lines}
    assert lines[chequing.id] == -300_00
    assert lines[card.id] == 0  # all below floor: tracked debt, not on-budget


def test_transfer_chequing_to_savings(db_session):
    chequing = make_account(db_session, "Chequing", opening_balance=1_000_00)
    savings = make_account(db_session, "Savings", type="Savings", opening_balance=0)

    txn = write_transaction(
        db_session, transaction=None, txn_date=TODAY, memo=None, payee_id=None,
        account_lines=[
            {"account_id": chequing.id, "cents": -500_00},
            {"account_id": savings.id, "cents": 500_00},
        ],
        category_lines=[],
    )

    assert len(txn.category_lines) == 0


def test_cash_gift_no_category_arrives_unassigned(db_session):
    chequing = make_account(db_session, "Chequing", opening_balance=0)

    txn = write_transaction(
        db_session, transaction=None, txn_date=TODAY, memo=None, payee_id=None,
        account_lines=[{"account_id": chequing.id, "cents": 2_400_00}],
        category_lines=[],
    )

    assert txn.account_lines[0].budget_cents == 2_400_00
    assert txn.category_lines == []


def test_paycheque_net_only(db_session):
    chequing = make_account(db_session, "Chequing", opening_balance=0)
    salary = make_category(db_session, "Salary income")

    txn = write_transaction(
        db_session, transaction=None, txn_date=TODAY, memo=None, payee_id=None,
        account_lines=[{"account_id": chequing.id, "cents": 2_400_00}],
        category_lines=[{"category_id": salary.id, "cents": 2_400_00}],
    )

    assert txn.category_lines[0].cents == 2_400_00


def test_paycheque_gross_with_deductions(db_session):
    chequing = make_account(db_session, "Chequing", opening_balance=0)
    salary = make_category(db_session, "Salary income")
    income_tax = make_category(db_session, "Income tax")
    cpp_ei = make_category(db_session, "CPP/EI")

    txn = write_transaction(
        db_session, transaction=None, txn_date=TODAY, memo=None, payee_id=None,
        account_lines=[{"account_id": chequing.id, "cents": 2_500_00}],
        category_lines=[
            {"category_id": salary.id, "cents": 4_000_00},
            {"category_id": income_tax.id, "cents": -1_000_00},
            {"category_id": cpp_ei.id, "cents": -500_00},
        ],
    )

    assert sum(line.cents for line in txn.category_lines) == 2_500_00


def test_employer_rrsp_match_on_budget_linked_account(db_session):
    wealthsimple = make_account(db_session, "Wealthsimple", type="Investment", opening_balance=0)
    retirement = make_category(db_session, "Retirement")

    txn = write_transaction(
        db_session, transaction=None, txn_date=TODAY, memo=None, payee_id=None,
        account_lines=[{"account_id": wealthsimple.id, "cents": 150_00}],
        category_lines=[{"category_id": retirement.id, "cents": 150_00}],
    )

    assert txn.account_lines[0].budget_cents == 150_00


def test_car_loan_payment_with_interest(db_session):
    chequing = make_account(db_session, "Chequing", opening_balance=1_000_00)
    car_loan = make_account(db_session, "Car loan", type="Loan", on_budget=False, opening_balance=-5_000_00)
    debt_payments = make_category(db_session, "Debt payments")
    interest = make_category(db_session, "Interest")

    txn = write_transaction(
        db_session, transaction=None, txn_date=TODAY, memo=None, payee_id=None,
        account_lines=[
            {"account_id": chequing.id, "cents": -450_00},
            {"account_id": car_loan.id, "cents": 380_00},
        ],
        category_lines=[
            {"category_id": debt_payments.id, "cents": -380_00},
            {"category_id": interest.id, "cents": -70_00},
        ],
    )

    lines = {line.account_id: line.budget_cents for line in txn.account_lines}
    assert lines[car_loan.id] == 0  # tracking account: never on-budget


def test_free_lottery_ticket_zero_dollar_transaction(db_session):
    chequing = make_account(db_session, "Chequing", opening_balance=0)
    fun = make_category(db_session, "Fun")

    txn = write_transaction(
        db_session, transaction=None, txn_date=TODAY, memo=None, payee_id=None,
        account_lines=[{"account_id": chequing.id, "cents": 0}],
        category_lines=[
            {"category_id": fun.id, "cents": 6_00},
            {"category_id": fun.id, "cents": -6_00},
        ],
    )

    assert txn.account_lines[0].cents == 0
    assert sum(line.cents for line in txn.category_lines) == 0


def test_refund(db_session):
    chequing = make_account(db_session, "Chequing", opening_balance=0)
    groceries = make_category(db_session, "Groceries")

    txn = write_transaction(
        db_session, transaction=None, txn_date=TODAY, memo=None, payee_id=None,
        account_lines=[{"account_id": chequing.id, "cents": 40_00}],
        category_lines=[{"category_id": groceries.id, "cents": 40_00}],
    )

    assert txn.category_lines[0].cents == 40_00


def test_draw_on_line_of_credit_arrives_unassigned(db_session):
    loc = make_account(db_session, "LOC", type="Line of credit", on_budget=False, opening_balance=0)
    chequing = make_account(db_session, "Chequing", opening_balance=0)

    txn = write_transaction(
        db_session, transaction=None, txn_date=TODAY, memo=None, payee_id=None,
        account_lines=[
            {"account_id": loc.id, "cents": -2_000_00},
            {"account_id": chequing.id, "cents": 2_000_00},
        ],
        category_lines=[],
    )

    lines = {line.account_id: line.budget_cents for line in txn.account_lines}
    assert lines[loc.id] == 0
    assert txn.category_lines == []


def test_deposit_to_fhsa_on_budget_linked(db_session):
    chequing = make_account(db_session, "Chequing", opening_balance=1_000_00)
    fhsa = make_account(db_session, "FHSA", type="Investment", opening_balance=0)

    txn = write_transaction(
        db_session, transaction=None, txn_date=TODAY, memo=None, payee_id=None,
        account_lines=[
            {"account_id": chequing.id, "cents": -500_00},
            {"account_id": fhsa.id, "cents": 500_00},
        ],
        category_lines=[],
    )

    assert txn.category_lines == []


def test_category_lines_that_dont_add_up_are_refused(db_session):
    chequing = make_account(db_session, "Chequing", opening_balance=500_00)
    groceries = make_category(db_session, "Groceries")

    with pytest.raises(TransactionError):
        write_transaction(
            db_session, transaction=None, txn_date=TODAY, memo=None, payee_id=None,
            account_lines=[{"account_id": chequing.id, "cents": -80_00}],
            category_lines=[{"category_id": groceries.id, "cents": -70_00}],
        )


def test_edit_regenerates_budget_cents_and_reruns_the_invariant(db_session):
    card = make_account(db_session, "Card", type="Credit card", floor=-1_000_00, opening_balance=-200_00)
    groceries = make_category(db_session, "Groceries")

    txn = write_transaction(
        db_session, transaction=None, txn_date=TODAY, memo=None, payee_id=None,
        account_lines=[{"account_id": card.id, "cents": -100_00}],
        category_lines=[{"category_id": groceries.id, "cents": -100_00}],
    )
    db_session.flush()

    edited = write_transaction(
        db_session, transaction=txn, txn_date=TODAY, memo="corrected", payee_id=None,
        account_lines=[{"account_id": card.id, "cents": -50_00}],
        category_lines=[{"category_id": groceries.id, "cents": -50_00}],
    )

    assert edited.id == txn.id
    assert edited.memo == "corrected"
    assert len(edited.account_lines) == 1
    assert edited.account_lines[0].cents == -50_00
    assert edited.account_lines[0].budget_cents == -50_00


def test_category_name_unique_case_insensitively(db_session):
    from sqlalchemy.exc import IntegrityError

    make_category(db_session, "Groceries")
    with pytest.raises(IntegrityError):
        make_category(db_session, "groceries")
