-- At down_revision d4e8b2a71f63 "account" has no boundary_category_id. A tracking car loan, a chequing
-- account and an archived account, with a loan payment between them, must survive untouched, every
-- account arriving with a null boundary category: no backfill.
INSERT INTO category (id, name, created_on, owner_id) VALUES (1, 'Debt payments', '2026-01-01', 1), (2, 'Interest', '2026-01-01', 1);

INSERT INTO account (id, name, created_on, archived_on, type, on_budget, on_budget_floor_cents, opening_stated_on, owner_id)
VALUES (1, 'Chequing', '2026-01-01', NULL, 'Chequing', true, 0, '2026-01-01', 1),
       (2, 'Car loan', '2026-01-01', NULL, 'Loan', false, 0, '2026-01-01', 1),
       (3, 'Old card', '2026-01-01', '2026-06-01', 'Cash', true, 0, '2026-01-01', 1);

INSERT INTO "transaction" (id, date, memo, owner_id) VALUES (1, '2026-01-05', 'Loan payment', 1);

INSERT INTO account_line (id, transaction_id, account_id, cents, budget_cents, owner_id)
VALUES (1, 1, 1, -45000, -45000, 1),
       (2, 1, 2, 38000, 0, 1);

INSERT INTO category_line (id, transaction_id, category_id, cents, owner_id)
VALUES (1, 1, 1, -38000, 1), (2, 1, 2, -7000, 1);
