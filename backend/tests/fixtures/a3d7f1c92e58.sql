-- At down_revision 9e2c7a41d3b6 the transaction table has no bill link. A payment on a
-- recurring bill's category, recorded before payments could say which due date they paid, must
-- come through with both new columns null (nothing is backfilled), the bill untouched, and the
-- ledger balance unchanged.
INSERT INTO account (id, name, created_on, opening_stated_on, type, on_budget, on_budget_floor_cents, owner_id)
VALUES (1, 'Chequing', '2026-01-01', '2026-01-01', 'Chequing', true, 0, 1);

INSERT INTO valuation (id, account_id, date, balance_cents, owner_id)
VALUES (1, 1, '2026-01-01', 200000, 1);

INSERT INTO category (id, name, created_on, owner_id)
VALUES (1, 'Rent', '2026-01-01', 1);

INSERT INTO goal (id, category_id, name, kind, amount_cents, cadence, cadence_weeks, target_date, level_cents, created_on, owner_id)
VALUES (1, 1, 'Rent', 'recurring_bill', 120000, 'monthly', NULL, '2026-02-01', NULL, '2026-01-01', 1);

INSERT INTO "transaction" (id, date, memo, payee_id, valuation_id, owner_id)
VALUES (1, '2026-01-01', NULL, NULL, 1, 1);

INSERT INTO account_line (id, transaction_id, account_id, cents, budget_cents, owner_id)
VALUES (1, 1, 1, 200000, 200000, 1);

INSERT INTO "transaction" (id, date, memo, payee_id, valuation_id, owner_id)
VALUES (2, '2026-02-03', 'February rent', NULL, NULL, 1);

INSERT INTO account_line (id, transaction_id, account_id, cents, budget_cents, owner_id)
VALUES (2, 2, 1, -120000, -120000, 1);

INSERT INTO category_line (id, transaction_id, category_id, cents, owner_id)
VALUES (1, 2, 1, -120000, 1);
