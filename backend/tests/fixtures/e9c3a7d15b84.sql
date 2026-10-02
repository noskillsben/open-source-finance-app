-- At down_revision d8b4f2a65c19 a Target can have both a named pay and a cadence. A live bound
-- Target with a cadence (monthly, and one on weeks) loses it, an unbound one keeps it, and a bound
-- Target with no cadence, a bound bill with a cadence and an archived bound Target are untouched.
INSERT INTO category (id, name, created_on, owner_id)
VALUES (1, 'Vacation', '2026-01-01', 1), (2, 'New roof', '2026-01-01', 1), (3, 'Car insurance', '2026-01-01', 1),
       (4, 'Old plan', '2026-01-01', 1), (5, 'Salary income', '2026-01-01', 1), (6, 'Laptop', '2026-01-01', 1),
       (7, 'Bike', '2026-01-01', 1);

INSERT INTO account (id, name, created_on, opening_stated_on, type, on_budget, on_budget_floor_cents, owner_id)
VALUES (1, 'Chequing', '2026-01-01', '2026-01-01', 'Chequing', true, 0, 1);

INSERT INTO income_stream (id, name, cadence, cadence_weeks, anchor_payday, expected_net_low_cents, expected_net_high_cents, income_category_id, destination_account_id, created_on, owner_id)
VALUES (1, 'Salary', 'weeks', 2, '2026-09-25', 0, 0, 5, 1, '2026-01-01', 1);

INSERT INTO goal (id, category_id, name, kind, amount_cents, cadence, cadence_weeks, target_date, level_cents, percent_of_net, income_stream_id, created_on, archived_on, owner_id)
VALUES (1, 1, 'Vacation', 'target', 200000, 'monthly', NULL, '2027-06-01', NULL, NULL, 1, '2026-01-01', NULL, 1),
       (2, 2, 'New roof', 'target', 900000, 'monthly', NULL, '2027-06-01', NULL, NULL, NULL, '2026-01-01', NULL, 1),
       (3, 3, 'Car insurance', 'recurring_bill', 120000, 'quarterly', NULL, '2026-12-01', NULL, NULL, 1, '2026-01-01', NULL, 1),
       (4, 4, 'Old plan', 'target', 50000, 'monthly', NULL, '2027-01-01', NULL, NULL, 1, '2026-01-01', '2026-06-01', 1),
       (5, 6, 'Laptop', 'target', 150000, NULL, NULL, '2027-03-01', NULL, NULL, 1, '2026-01-01', NULL, 1),
       (6, 7, 'Bike', 'target', 80000, 'weeks', 3, '2027-03-01', NULL, NULL, 1, '2026-01-01', NULL, 1);
