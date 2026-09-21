-- At down_revision b91f3e7a2c45, "category" is the minimal table (name, parent_id) with a
-- category_line and its own child pointing at it, and the seeded payee Me is identified by
-- created_on = 0001-01-01. This revision alters category in place (pool_id, domain_id,
-- need_level), adds seeded_key everywhere, and moves Me's identity onto seeded_key.
INSERT INTO account (id, name, created_on, opening_stated_on, type, on_budget, on_budget_floor_cents, owner_id)
VALUES (1, 'Chequing', '2026-01-01', '2026-01-01', 'Chequing', true, 0, 1);

INSERT INTO category (id, name, parent_id, created_on, owner_id)
VALUES (1, 'Car', NULL, '2026-01-01', 1);

INSERT INTO category (id, name, parent_id, created_on, owner_id)
VALUES (2, 'Car insurance', 1, '2026-01-01', 1);

INSERT INTO payee (id, name, created_on, owner_id)
VALUES (1, 'Me', '0001-01-01', 1);

INSERT INTO payee (id, name, created_on, owner_id)
VALUES (2, 'Walmart', '2026-01-01', 1);

INSERT INTO "transaction" (id, date, memo, payee_id, valuation_id, owner_id)
VALUES (1, '2026-01-05', 'Insurance', 2, NULL, 1);

INSERT INTO account_line (id, transaction_id, account_id, cents, budget_cents, owner_id)
VALUES (1, 1, 1, -8000, -8000, 1);

INSERT INTO category_line (id, transaction_id, category_id, cents, owner_id)
VALUES (1, 1, 2, -8000, 1);
