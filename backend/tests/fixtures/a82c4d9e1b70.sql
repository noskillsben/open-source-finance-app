-- At down_revision cfce036f3c04, "account" has no opening_stated_on. This revision adds it,
-- NOT NULL, backfilled from created_on. Two accounts prove the backfill runs on every row and
-- that a second upgrade leaves the value alone.
INSERT INTO account (id, name, created_on, type, on_budget, on_budget_floor_cents, owner_id)
VALUES (1, 'Chequing', '2026-01-01', 'Chequing', true, 0, 1);

INSERT INTO account (id, name, created_on, type, on_budget, on_budget_floor_cents, owner_id)
VALUES (2, 'Savings', '2026-03-10', 'Savings', true, 0, 1);

INSERT INTO valuation (id, account_id, date, balance_cents, owner_id)
VALUES (1, 1, '2026-01-01', 50000, 1);

INSERT INTO "transaction" (id, date, memo, payee_id, valuation_id, owner_id)
VALUES (1, '2026-01-05', 'Groceries run', NULL, NULL, 1);

INSERT INTO account_line (id, transaction_id, account_id, cents, budget_cents, owner_id)
VALUES (1, 1, 1, -8000, -8000, 1)
;
