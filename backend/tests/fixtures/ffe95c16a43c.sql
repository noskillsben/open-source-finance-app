-- At down_revision 208c0d25ef38, "transaction" already has the nullable valuation_id column.
-- This revision creates "payee" and adds a nullable payee_id FK on "transaction" -- proves an
-- existing transaction with no payee survives untouched.
INSERT INTO account (id, name, created_on, type, on_budget, on_budget_floor_cents, owner_id)
VALUES (1, 'Chequing', '2026-01-01', 'Chequing', true, 0, 1);

INSERT INTO valuation (id, account_id, date, balance_cents, owner_id)
VALUES (1, 1, '2026-01-01', 50000, 1);

INSERT INTO category (id, name, owner_id)
VALUES (1, 'Groceries', 1);

INSERT INTO "transaction" (id, date, memo, payee_id, valuation_id, owner_id)
VALUES (1, '2026-01-05', 'Groceries run', NULL, NULL, 1);

INSERT INTO account_line (id, transaction_id, account_id, cents, budget_cents, owner_id)
VALUES (1, 1, 1, -8000, -8000, 1);

INSERT INTO category_line (id, transaction_id, category_id, cents, owner_id)
VALUES (1, 1, 1, -8000, 1);
