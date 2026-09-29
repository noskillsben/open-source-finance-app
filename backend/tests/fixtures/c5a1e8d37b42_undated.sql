-- Fixed-amount commitments on a month cadence have no first due month to migrate to, so the
-- upgrade must refuse and name each one, an archived one included, and change nothing. The
-- weekly one and the refill are fine and must not be named.
INSERT INTO category (id, name, created_on, owner_id)
VALUES (1, 'Vacation', '2026-01-01', 1), (2, 'Gifts', '2026-01-01', 1), (3, 'Fun money', '2026-01-01', 1),
       (4, 'Groceries', '2026-01-01', 1), (5, 'Old', '2026-01-01', 1);

INSERT INTO goal (id, category_id, name, kind, amount_cents, cadence, cadence_weeks, level_cents, created_on, archived_on, owner_id)
VALUES (1, 1, '200 a month', 'commitment', 20000, 'monthly', NULL, NULL, '2026-01-01', NULL, 1),
       (2, 2, 'Yearly gifts', 'commitment', 90000, 'yearly', NULL, NULL, '2026-01-01', NULL, 1),
       (3, 3, 'Fun every fortnight', 'commitment', 5000, 'weeks', 2, NULL, '2026-01-01', NULL, 1),
       (4, 4, 'Groceries level', 'commitment', NULL, 'monthly', NULL, 60000, '2026-01-01', NULL, 1),
       (5, 5, 'Old quarterly', 'commitment', 1000, 'quarterly', NULL, NULL, '2026-01-01', '2026-06-01', 1);
