-- At down_revision b7d2f4a96c18 every account has a stated day. Account 2 (Sam) was created by a split membership,
-- same created_at as its first member row, and has a line wrongly netted into its opening. Account 3 (Alex) was
-- picked for a member, older than the member row, and account 1 came from the form. Only account 2 comes out
-- with no stated day, and Data check flags its netted line after.
INSERT INTO payee (id, name, created_on, owner_id) VALUES (1, 'Sam', '2026-10-16', 1), (2, 'Alex', '2026-10-16', 1);

INSERT INTO account (id, name, created_on, created_at, opening_stated_on, type, on_budget, on_budget_floor_cents, owner_id)
VALUES (1, 'Chequing', '2026-01-01', '2026-01-01 09:00:00+00', '2026-01-01', 'Chequing', true, 0, 1),
       (2, 'Sam', '2026-10-16', '2026-10-16 12:00:00+00', '2026-10-16', 'Money owed to me', true, 0, 1),
       (3, 'Alex', '2026-03-01', '2026-03-01 09:00:00+00', '2026-03-01', 'Money owed to me', true, 0, 1);

INSERT INTO split (id, name, created_on, owner_id) VALUES (1, 'Household', '2026-10-16', 1);

INSERT INTO split_member (id, split_id, payee_id, account_id, percent, created_on, created_at, owner_id)
VALUES (1, 1, 1, 2, 50, '2026-10-16', '2026-10-16 12:00:00+00', 1),
       (2, 1, 2, 3, 20, '2026-10-16', '2026-10-16 12:00:00+00', 1);

INSERT INTO "transaction" (id, date, memo, owner_id) VALUES (1, '2026-10-05', 'Shared bill', 1);

INSERT INTO account_line (id, transaction_id, account_id, cents, budget_cents, netted_into_opening, owner_id)
VALUES (1, 1, 1, -10000, -10000, false, 1),
       (2, 1, 2, 5000, 5000, true, 1);
