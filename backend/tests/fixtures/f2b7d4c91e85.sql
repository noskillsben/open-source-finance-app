-- At down_revision e5f9c3b82a74 a split's receivable is a Cash stand-in. A split member's account
-- (live and archived-member), an ordinary Cash account nobody references, and a Chequing account must
-- survive, and only the referenced Cash accounts are retyped.
INSERT INTO payee (id, name, created_on, owner_id) VALUES (1, 'Sam', '2026-01-01', 1), (2, 'Alex', '2026-01-01', 1);

INSERT INTO account (id, name, created_on, archived_on, type, on_budget, on_budget_floor_cents, opening_stated_on, locked_payee_id, owner_id)
VALUES (1, 'Chequing', '2026-01-01', NULL, 'Chequing', true, 0, '2026-01-01', NULL, 1),
       (2, 'Sam', '2026-01-01', NULL, 'Cash', true, 0, '2026-01-01', NULL, 1),
       (3, 'Wallet', '2026-01-01', NULL, 'Cash', true, 0, '2026-01-01', NULL, 1),
       (4, 'Alex', '2026-01-01', '2026-06-01', 'Cash', true, 0, '2026-01-01', NULL, 1);

INSERT INTO split (id, name, created_on, owner_id) VALUES (1, 'Household', '2026-01-01', 1);

INSERT INTO split_member (id, split_id, payee_id, account_id, percent, created_on, archived_on, owner_id)
VALUES (1, 1, 1, 2, 50, '2026-01-01', NULL, 1),
       (2, 1, 2, 4, 20, '2026-01-01', '2026-06-01', 1);

INSERT INTO "transaction" (id, date, memo, owner_id) VALUES (1, '2026-01-05', 'Rent share', 1);

INSERT INTO account_line (id, transaction_id, account_id, cents, budget_cents, owner_id)
VALUES (1, 1, 1, -10000, -10000, 1),
       (2, 1, 2, 5000, 5000, 1);
