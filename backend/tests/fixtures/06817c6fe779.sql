-- At down_revision b85e039f86ae a recorded pay's earmark batch is a set of 'move' lines carrying
-- the paycheque's transaction_id. Those must come through relabelled 'pay_batch'. A plain move
-- (no transaction_id) and a pool draw (which also carries a transaction_id) must keep their
-- source, and no category balance may move.
INSERT INTO account (id, name, created_on, opening_stated_on, type, on_budget, on_budget_floor_cents, owner_id)
VALUES (1, 'Chequing', '2026-01-01', '2026-01-01', 'Chequing', true, 0, 1);

INSERT INTO valuation (id, account_id, date, balance_cents, owner_id)
VALUES (1, 1, '2026-01-01', 0, 1);

INSERT INTO category (id, name, created_on, owner_id)
VALUES (1, 'Salary income', '2026-01-01', 1);

INSERT INTO category (id, name, created_on, owner_id)
VALUES (2, 'Groceries', '2026-01-01', 1);

INSERT INTO category (id, name, created_on, owner_id)
VALUES (3, 'Fun', '2026-01-01', 1);

INSERT INTO "transaction" (id, date, memo, payee_id, valuation_id, owner_id)
VALUES (1, '2026-01-01', NULL, NULL, 1, 1);

INSERT INTO account_line (id, transaction_id, account_id, cents, budget_cents, owner_id)
VALUES (1, 1, 1, 0, 0, 1);

INSERT INTO "transaction" (id, date, memo, payee_id, valuation_id, owner_id)
VALUES (2, '2026-02-01', NULL, NULL, NULL, 1);

INSERT INTO account_line (id, transaction_id, account_id, cents, budget_cents, owner_id)
VALUES (2, 2, 1, 240000, 240000, 1);

INSERT INTO category_line (id, transaction_id, category_id, cents, owner_id)
VALUES (1, 2, 1, 240000, 1);

-- The pay batch: income -> ready to assign, ready to assign -> Groceries.
INSERT INTO earmark_line (id, date, category_id, cents, source, transaction_id, owner_id)
VALUES (1, '2026-02-01', 1, -240000, 'move', 2, 1);

INSERT INTO earmark_line (id, date, category_id, cents, source, transaction_id, owner_id)
VALUES (2, '2026-02-01', 2, 50000, 'move', 2, 1);

-- A plain move from the Categories page.
INSERT INTO earmark_line (id, date, category_id, cents, source, transaction_id, owner_id)
VALUES (3, '2026-02-02', 3, 10000, 'move', NULL, 1);

-- A pool draw a transaction generated.
INSERT INTO earmark_line (id, date, category_id, cents, source, transaction_id, owner_id)
VALUES (4, '2026-02-01', 3, -1000, 'pool_draw', 2, 1);
