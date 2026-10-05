-- At down_revision c7d1f9a28e43 a transaction has no shared_total_cents. A bill Roommate paid (only my
-- share on the lines, split and payer set) and a bill with a split but no payer must survive
-- untouched, the new column arriving null on both: no backfill.
INSERT INTO payee (id, name, created_on, owner_id) VALUES (1, 'Roommate', '2026-01-01', 1);

INSERT INTO account (id, name, created_on, archived_on, type, on_budget, on_budget_floor_cents, opening_stated_on, locked_payee_id, owner_id)
VALUES (1, 'Chequing', '2026-01-01', NULL, 'Chequing', true, 0, '2026-01-01', NULL, 1),
       (2, 'Roommate', '2026-01-01', NULL, 'Cash', true, 0, '2026-01-01', 1, 1);

INSERT INTO split (id, name, created_on, owner_id) VALUES (1, 'Household', '2026-01-01', 1);
INSERT INTO split_member (id, split_id, payee_id, account_id, percent, created_on, owner_id)
VALUES (1, 1, 1, 2, 50, '2026-01-01', 1);

INSERT INTO "transaction" (id, date, memo, payee_id, split_id, paid_by_payee_id, owner_id)
VALUES (1, '2026-01-05', 'Groceries', 1, 1, 1, 1),
       (2, '2026-01-06', 'Electricity', 1, 1, NULL, 1);

INSERT INTO account_line (id, transaction_id, account_id, cents, budget_cents, owner_id)
VALUES (1, 1, 2, -3000, -3000, 1),
       (2, 2, 1, -10000, -10000, 1),
       (3, 2, 2, 5000, 5000, 1);
