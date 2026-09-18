-- At down_revision 769d6a847874, account/valuation/category/transaction/account_line/
-- category_line all exist. This revision adds a nullable valuation_id column to "transaction"
-- -- proves an existing, fully-linked transaction survives untouched.
INSERT INTO account (id, name, created_on, type, on_budget, on_budget_floor_cents, owner_id)
VALUES (1, 'Chequing', '2026-01-01', 'Chequing', true, 0, 1);

INSERT INTO valuation (id, account_id, date, balance_cents, owner_id)
VALUES (1, 1, '2026-01-01', 50000, 1);

INSERT INTO category (id, name, owner_id)
VALUES (1, 'Groceries', 1);

INSERT INTO "transaction" (id, date, memo, payee_id, owner_id)
VALUES (1, '2026-01-05', 'Groceries run', NULL, 1);

INSERT INTO account_line (id, transaction_id, account_id, cents, budget_cents, owner_id)
VALUES (1, 1, 1, -8000, -8000, 1);

INSERT INTO category_line (id, transaction_id, category_id, cents, owner_id)
VALUES (1, 1, 1, -8000, 1);
