-- At down_revision a2b7d9e41c36 there is no split or split_member table. A live account, an archived
-- one, a payee (Roommate) and a payee-locked account with a spending transaction must survive
-- untouched, with both new tables arriving empty.
INSERT INTO payee (id, name, created_on, owner_id) VALUES (1, 'Roommate', '2026-01-01', 1);

INSERT INTO account (id, name, created_on, archived_on, type, on_budget, on_budget_floor_cents, opening_stated_on, locked_payee_id, owner_id)
VALUES (1, 'Chequing', '2026-01-01', NULL, 'Chequing', true, 0, '2026-01-01', NULL, 1),
       (2, 'Old card', '2026-01-01', '2026-06-01', 'Cash', true, 0, '2026-01-01', NULL, 1),
       (3, 'Roommate', '2026-01-01', NULL, 'Cash', true, 0, '2026-01-01', 1, 1);

INSERT INTO "transaction" (id, date, memo, payee_id, owner_id) VALUES (1, '2026-01-05', 'Rent share', 1, 1);

INSERT INTO account_line (id, transaction_id, account_id, cents, budget_cents, owner_id)
VALUES (1, 1, 3, 50000, 50000, 1);
