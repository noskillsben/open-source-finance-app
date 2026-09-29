-- At down_revision a3d7f1c92e58 every commitment has a cadence. Each case the migration must
-- handle, live or archived. Refill and percent-of-net lose theirs, a fixed amount on weeks moves
-- to an empty cadence and loses its week count, bills and targets stay as they are. (The abort
-- case, a fixed monthly/quarterly/yearly goal, is c5a1e8d37b42_undated.sql.)
INSERT INTO category (id, name, created_on, owner_id)
VALUES (1, 'Groceries', '2026-01-01', 1), (2, 'Savings', '2026-01-01', 1), (3, 'Fun money', '2026-01-01', 1),
       (4, 'Old refill', '2026-01-01', 1), (5, 'Rent', '2026-01-01', 1), (6, 'Vacation', '2026-01-01', 1),
       (7, 'Salary income', '2026-01-01', 1);

INSERT INTO account (id, name, created_on, opening_stated_on, type, on_budget, on_budget_floor_cents, owner_id)
VALUES (1, 'Chequing', '2026-01-01', '2026-01-01', 'Chequing', true, 0, 1);

INSERT INTO income_stream (id, name, cadence, cadence_weeks, anchor_payday, expected_net_low_cents, expected_net_high_cents, income_category_id, destination_account_id, created_on, owner_id)
VALUES (1, 'Salary', 'weeks', 2, '2026-09-25', 0, 0, 7, 1, '2026-01-01', 1);

INSERT INTO goal (id, category_id, name, kind, amount_cents, cadence, cadence_weeks, target_date, level_cents, percent_of_net, income_stream_id, created_on, archived_on, owner_id)
VALUES (1, 1, 'Groceries level', 'commitment', NULL, 'monthly', NULL, NULL, 60000, NULL, NULL, '2026-01-01', NULL, 1),
       (2, 2, 'Retain 5%', 'commitment', NULL, 'weeks', 2, NULL, NULL, 5.0000, 1, '2026-01-01', NULL, 1),
       (3, 3, 'Fun every fortnight', 'commitment', 5000, 'weeks', 2, NULL, NULL, NULL, NULL, '2026-01-01', NULL, 1),
       (4, 4, 'Old refill', 'commitment', NULL, 'yearly', NULL, NULL, 10000, NULL, NULL, '2026-01-01', '2026-06-01', 1),
       (5, 5, 'Rent', 'recurring_bill', 120000, 'weeks', 4, '2026-02-01', NULL, NULL, NULL, '2026-01-01', NULL, 1),
       (6, 6, 'Vacation', 'target', 200000, 'monthly', NULL, '2027-06-01', NULL, NULL, NULL, '2026-01-01', NULL, 1);
