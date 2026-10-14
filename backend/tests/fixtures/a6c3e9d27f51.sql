-- At down_revision f2b7d4c91e85 "category_line" has need_level. Lines carrying a value and a null
-- must survive with their cents, and the column is simply dropped with no backfill.
INSERT INTO category (id, name, created_on, owner_id) VALUES (1, 'Groceries', '2026-01-01', 1), (2, 'Dining', '2026-01-01', 1);

INSERT INTO account (id, name, created_on, archived_on, type, on_budget, on_budget_floor_cents, opening_stated_on, owner_id)
VALUES (1, 'Chequing', '2026-01-01', NULL, 'Chequing', true, 0, '2026-01-01', 1);

INSERT INTO "transaction" (id, date, memo, owner_id) VALUES (1, '2026-01-05', 'Shop', 1);

INSERT INTO account_line (id, transaction_id, account_id, cents, budget_cents, owner_id)
VALUES (1, 1, 1, -9000, -9000, 1);

INSERT INTO category_line (id, transaction_id, category_id, cents, need_level, owner_id)
VALUES (1, 1, 1, -6000, 'want', 1), (2, 1, 2, -3000, NULL, 1);
