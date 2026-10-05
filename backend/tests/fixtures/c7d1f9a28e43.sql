-- At down_revision b3c8e1f47a52 a transaction has no split_id or paid_by_payee_id. A split with one
-- member (Roommate, with their account) and a transaction on that account must survive untouched,
-- the transaction's two new columns arriving null.
INSERT INTO payee (id, name, created_on, owner_id) VALUES (1, 'Roommate', '2026-01-01', 1);

INSERT INTO account (id, name, created_on, archived_on, type, on_budget, on_budget_floor_cents, opening_stated_on, locked_payee_id, owner_id)
VALUES (1, 'Chequing', '2026-01-01', NULL, 'Chequing', true, 0, '2026-01-01', NULL, 1),
       (2, 'Roommate', '2026-01-01', NULL, 'Cash', true, 0, '2026-01-01', 1, 1);

INSERT INTO split (id, name, created_on, owner_id) VALUES (1, 'Household', '2026-01-01', 1);
INSERT INTO split_member (id, split_id, payee_id, account_id, percent, created_on, owner_id)
VALUES (1, 1, 1, 2, 50, '2026-01-01', 1);

INSERT INTO "transaction" (id, date, memo, payee_id, owner_id) VALUES (1, '2026-01-05', 'Electricity', 1, 1);

INSERT INTO account_line (id, transaction_id, account_id, cents, budget_cents, owner_id)
VALUES (1, 1, 1, -10000, -10000, 1),
       (2, 1, 2, 5000, 5000, 1);
