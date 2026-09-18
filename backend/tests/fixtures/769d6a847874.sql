-- At down_revision 749e15077f93, "account" and "valuation" already exist. This revision adds
-- category/transaction/account_line/category_line — proves that doesn't disturb the rows
-- already sitting in the tables it doesn't touch.
INSERT INTO account (id, name, created_on, type, on_budget, on_budget_floor_cents, owner_id)
VALUES (1, 'Chequing', '2026-01-01', 'Chequing', true, 0, 1);

INSERT INTO valuation (id, account_id, date, balance_cents, owner_id)
VALUES (1, 1, '2026-01-01', 50000, 1);
