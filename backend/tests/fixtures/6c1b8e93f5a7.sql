-- At down_revision 3850604f8ded the goal table has no income_stream_id or percent_of_net. An
-- existing goal (made before named pays could bind to it) must come through with both new
-- columns null, and its category's balance must be untouched.
INSERT INTO account (id, name, created_on, opening_stated_on, type, on_budget, on_budget_floor_cents, owner_id)
VALUES (1, 'Chequing', '2026-01-01', '2026-01-01', 'Chequing', true, 0, 1);

INSERT INTO valuation (id, account_id, date, balance_cents, owner_id)
VALUES (1, 1, '2026-01-01', 50000, 1);

INSERT INTO category (id, name, created_on, owner_id)
VALUES (1, 'Car insurance', '2026-01-01', 1);

INSERT INTO "transaction" (id, date, memo, payee_id, valuation_id, owner_id)
VALUES (1, '2026-01-01', NULL, NULL, 1, 1);

INSERT INTO account_line (id, transaction_id, account_id, cents, budget_cents, owner_id)
VALUES (1, 1, 1, 50000, 50000, 1);

INSERT INTO earmark_line (id, date, category_id, cents, source, owner_id)
VALUES (1, '2026-01-02', 1, 13282, 'move', 1);

INSERT INTO goal (id, category_id, name, kind, amount_cents, cadence, cadence_weeks, target_date, level_cents, created_on, owner_id)
VALUES (1, 1, 'My part', 'recurring_bill', 104800, 'yearly', NULL, '2026-06-15', NULL, '2026-01-01', 1);
