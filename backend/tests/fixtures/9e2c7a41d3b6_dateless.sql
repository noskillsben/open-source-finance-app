-- The refusal case for 9e2c7a41d3b6: one live and one archived recurring bill with no date.
-- The migration must raise and name both rather than guess a date.
INSERT INTO category (id, name, created_on, owner_id)
VALUES (1, 'Car insurance', '2026-01-01', 1), (2, 'Rent', '2026-01-01', 1);

INSERT INTO goal (id, category_id, name, kind, amount_cents, cadence, cadence_weeks, target_date, level_cents, created_on, archived_on, owner_id)
VALUES (1, 1, 'My part', 'recurring_bill', 104800, 'yearly', NULL, NULL, NULL, '2026-01-01', NULL, 1),
       (2, 2, 'Old rent', 'recurring_bill', 150000, 'monthly', NULL, NULL, NULL, '2026-01-01', '2026-02-01', 1);
