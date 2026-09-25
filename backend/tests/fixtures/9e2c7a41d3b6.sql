-- At down_revision 06817c6fe779 a recurring bill's date is optional. A dated bill must come
-- through the migration unchanged, alongside a dateless target (which stays legal).
INSERT INTO category (id, name, created_on, owner_id)
VALUES (1, 'Car insurance', '2026-01-01', 1), (2, 'Vacation', '2026-01-01', 1);

INSERT INTO goal (id, category_id, name, kind, amount_cents, cadence, cadence_weeks, target_date, level_cents, created_on, owner_id)
VALUES (1, 1, 'My part', 'recurring_bill', 104800, 'yearly', NULL, '2026-06-15', NULL, '2026-01-01', 1),
       (2, 2, 'Someday', 'target', 200000, NULL, NULL, NULL, NULL, '2026-01-01', 1);
