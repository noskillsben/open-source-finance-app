-- At down_revision d5e2b7c30f18 earmark_line exists without transaction_id. A category holding a
-- move line and an overspend against it must come through with the new column left null, and the
-- category's balance (earmark + transaction lines) must not move.
INSERT INTO account (id, name, created_on, opening_stated_on, type, on_budget, on_budget_floor_cents, owner_id)
VALUES (1, 'Chequing', '2026-01-01', '2026-01-01', 'Chequing', true, 0, 1);

INSERT INTO valuation (id, account_id, date, balance_cents, owner_id)
VALUES (1, 1, '2026-01-01', 50000, 1);

INSERT INTO category (id, name, created_on, owner_id)
VALUES (1, 'Groceries', '2026-01-01', 1);

INSERT INTO "transaction" (id, date, memo, payee_id, valuation_id, owner_id)
VALUES (1, '2026-01-01', NULL, NULL, 1, 1);

INSERT INTO "transaction" (id, date, memo, payee_id, valuation_id, owner_id)
VALUES (2, '2026-01-05', 'Groceries run', NULL, NULL, 1);

INSERT INTO account_line (id, transaction_id, account_id, cents, budget_cents, owner_id)
VALUES (1, 1, 1, 50000, 50000, 1);

INSERT INTO account_line (id, transaction_id, account_id, cents, budget_cents, owner_id)
VALUES (2, 2, 1, -8000, -8000, 1);

INSERT INTO category_line (id, transaction_id, category_id, cents, owner_id)
VALUES (1, 2, 1, -8000, 1);

INSERT INTO earmark_line (id, date, category_id, cents, source, owner_id)
VALUES (1, '2026-01-02', 1, 5000, 'move', 1);
