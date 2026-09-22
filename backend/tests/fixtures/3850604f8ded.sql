-- At down_revision a8b5e0f63c41 there is no income_stream or income_stream_deduction table. A
-- category holding an earmarked move and an on-budget account must come through untouched, and
-- both new tables must start empty.
INSERT INTO account (id, name, created_on, opening_stated_on, type, on_budget, on_budget_floor_cents, owner_id)
VALUES (1, 'Chequing', '2026-01-01', '2026-01-01', 'Chequing', true, 0, 1);

INSERT INTO valuation (id, account_id, date, balance_cents, owner_id)
VALUES (1, 1, '2026-01-01', 100000, 1);

INSERT INTO category (id, name, created_on, owner_id)
VALUES (1, 'Salary income', '2026-01-01', 1);

INSERT INTO "transaction" (id, date, memo, payee_id, valuation_id, owner_id)
VALUES (1, '2026-01-01', NULL, NULL, 1, 1);

INSERT INTO account_line (id, transaction_id, account_id, cents, budget_cents, owner_id)
VALUES (1, 1, 1, 100000, 100000, 1);

INSERT INTO earmark_line (id, date, category_id, cents, source, owner_id)
VALUES (1, '2026-01-02', 1, 40000, 'move', 1);
