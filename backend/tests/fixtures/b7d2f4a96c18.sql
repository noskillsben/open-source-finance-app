-- At down_revision a6c3e9d27f51 a goal has no set_aside_whole. Existing recurring bills, one bound to a
-- named pay and one unbound, plus a Target and an archived bill, must all survive and come out false.
INSERT INTO category (id, name, created_on, owner_id)
VALUES (1, 'Rent', '2026-01-01', 1), (2, 'Internet', '2026-01-01', 1), (3, 'Vacation', '2026-01-01', 1),
       (4, 'Old bill', '2026-01-01', 1), (5, 'Salary income', '2026-01-01', 1);

INSERT INTO account (id, name, created_on, opening_stated_on, type, on_budget, on_budget_floor_cents, owner_id)
VALUES (1, 'Chequing', '2026-01-01', '2026-01-01', 'Chequing', true, 0, 1);

INSERT INTO income_stream (id, name, cadence, cadence_weeks, anchor_payday, expected_net_low_cents, expected_net_high_cents, income_category_id, destination_account_id, created_on, owner_id)
VALUES (1, 'Salary', 'weeks', 2, '2026-10-10', 0, 0, 5, 1, '2026-01-01', 1);

INSERT INTO goal (id, category_id, name, kind, amount_cents, cadence, cadence_weeks, first_due_on, target_date, level_cents, percent_of_net, income_stream_id, created_on, archived_on, owner_id)
VALUES (1, 1, 'Rent', 'recurring_bill', 150000, 'monthly', NULL, '2026-11-01', NULL, NULL, NULL, 1, '2026-01-01', NULL, 1),
       (2, 2, 'Internet', 'recurring_bill', 8000, 'monthly', NULL, '2026-11-05', NULL, NULL, NULL, NULL, '2026-01-01', NULL, 1),
       (3, 3, 'Vacation', 'target', 200000, NULL, NULL, NULL, '2027-06-01', NULL, NULL, 1, '2026-01-01', NULL, 1),
       (4, 4, 'Old bill', 'recurring_bill', 5000, 'monthly', NULL, '2026-01-15', NULL, NULL, NULL, 1, '2026-01-01', '2026-06-01', 1);
