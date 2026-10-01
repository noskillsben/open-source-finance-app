-- At down_revision c5a1e8d37b42 categories have no absorb switch. Live, archived, pooled and
-- plain categories must all survive with it off, and a pool link must be untouched.
INSERT INTO category (id, name, created_on, archived_on, pool_id, owner_id)
VALUES (1, 'Household', '2026-01-01', NULL, NULL, 1),
       (2, 'Food', '2026-01-01', NULL, 1, 1),
       (3, 'Snacks', '2026-01-01', NULL, 2, 1),
       (4, 'Old fund', '2026-01-01', '2026-06-01', NULL, 1);
