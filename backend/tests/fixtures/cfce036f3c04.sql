-- At down_revision ffe95c16a43c, "category" has no created_on/archived_on/parent_id yet, so
-- created_at (server default: now(), i.e. today) is all any pre-existing row has. This revision
-- backfills created_on from the earliest category_line's transaction date, falling back to
-- created_at::date when a category has no category_line at all -- the exact shape #15's harness
-- never once ran with rows in the table.
INSERT INTO account (id, name, created_on, type, on_budget, on_budget_floor_cents, owner_id)
VALUES (1, 'Chequing', '2026-01-01', 'Chequing', true, 0, 1);

INSERT INTO valuation (id, account_id, date, balance_cents, owner_id)
VALUES (1, 1, '2026-01-01', 50000, 1);

-- Has a category_line whose transaction predates today (created_at) by months -- the backfill
-- must pick up that earlier date, not created_at.
INSERT INTO category (id, name, owner_id)
VALUES (1, 'Groceries', 1);

-- No category_line at all -- the backfill must fall back to created_at::date.
INSERT INTO category (id, name, owner_id)
VALUES (2, 'Unused', 1);

INSERT INTO "transaction" (id, date, memo, payee_id, valuation_id, owner_id)
VALUES (1, '2026-01-05', 'Groceries run', NULL, NULL, 1);

INSERT INTO account_line (id, transaction_id, account_id, cents, budget_cents, owner_id)
VALUES (1, 1, 1, -8000, -8000, 1);

INSERT INTO category_line (id, transaction_id, category_id, cents, owner_id)
VALUES (1, 1, 1, -8000, 1);
