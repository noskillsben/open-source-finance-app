-- At down_revision f1a6c2e84d97 "account" has no locked_payee_id. A live account, an archived one and
-- a payee with a spending transaction must survive, with both accounts coming out unlocked.
INSERT INTO account (id, name, created_on, archived_on, type, on_budget, on_budget_floor_cents, opening_stated_on, owner_id)
VALUES (1, 'Chequing', '2026-01-01', NULL, 'Chequing', true, 0, '2026-01-01', 1),
       (2, 'Old card', '2026-01-01', '2026-06-01', 'Cash', true, 0, '2026-01-01', 1);

INSERT INTO payee (id, name, created_on, owner_id) VALUES (1, 'Starbucks', '2026-01-01', 1);

INSERT INTO "transaction" (id, date, memo, payee_id, owner_id) VALUES (1, '2026-01-05', 'Coffee', 1, 1);

INSERT INTO account_line (id, transaction_id, account_id, cents, budget_cents, owner_id)
VALUES (1, 1, 1, -450, -450, 1);
