-- At down_revision e9c3a7d15b84 a recurring bill's first due date is in target_date. A live monthly
-- bill on the 31st, an archived weekly bill, a fixed quarterly Commitment with its due month in
-- first_due_on and a dated Target (with a cadence) must come out reading the same due dates: the
-- bills' dates move to first_due_on, the Commitment and the Target are untouched.
INSERT INTO category (id, name, created_on, owner_id)
VALUES (1, 'Rent', '2026-01-01', 1), (2, 'Old gym', '2026-01-01', 1), (3, 'Insurance', '2026-01-01', 1),
       (4, 'Vacation', '2026-01-01', 1);

INSERT INTO goal (id, category_id, name, kind, amount_cents, cadence, cadence_weeks, first_due_on, target_date, level_cents, percent_of_net, income_stream_id, created_on, archived_on, owner_id)
VALUES (1, 1, 'Rent', 'recurring_bill', 120000, 'monthly', NULL, NULL, '2026-01-31', NULL, NULL, NULL, '2026-01-01', NULL, 1),
       (2, 2, 'Old gym', 'recurring_bill', 4000, 'weeks', 4, NULL, '2026-02-01', NULL, NULL, NULL, '2026-01-01', '2026-06-01', 1),
       (3, 3, 'Insurance', 'commitment', 30000, 'quarterly', NULL, '2026-12-31', NULL, NULL, NULL, NULL, '2026-01-01', NULL, 1),
       (4, 4, 'Vacation', 'target', 200000, 'monthly', NULL, NULL, '2027-06-01', NULL, NULL, NULL, '2026-01-01', NULL, 1);
