# Salvage from bens_finance_app

*2026-09-10. What the old app's docs (45 ADRs, DESIGN/PRODUCT_VISION/CLAUDE.md, five critiques, onboarding notes, two research files, the user guide, the process docs) still have to say to the rebuild. Every item is judged against `Open Source Finance App.md` as it stood on 2026-09-10. Items marked **DECIDE** are conflicts with that doc that need Ben's call before the doc is updated.*

---

## 1. Carry over verbatim

These files are product-neutral and should be copied into the new repo's `docs/` as-is, with only the headers (which name old ADRs) trimmed.

- `Canadian_Loan_mechanics.md` — semi-annual mortgage compounding, term vs. amortization, statement-level card grace, the three kinds of payment plan (0% schedule / simple-interest / deferred-interest trap), prepayment and penalty models, jurisdiction minimums. Treat its "Recommendations" section as *inputs a report will need*, not a build list.
- `savings in budgeting apps research 2026-09-02.md` — emergency-fund sizing from needs-only spend, the industry split on how growth is recorded (contributions consume a category; growth is an uncategorised adjustment), the "contributed X / market added Y / total Z" white space, the 3–5-year horizon guardrail, debt-vs-invest thresholds. Its recommendations assume a three-tier need scale; the rebuild has four.
- `DESIGN.MD` § Philosophy, § Three Pillars, and the "What this app explicitly does NOT do" list (minus the category-type items) — inherit as the new doc's opening section. The strongest lines: *"a financial mirror, not a financial cage"*; *"never alarm without context, and always let you say 'I know what I'm doing' and move on"*; *"a negative leftover is a legitimate outcome, not an error"*; three views with three tempos (where does my money sit / can I afford what's coming / am I making the trade-offs I want) that are never collapsed into one screen.
- `TERMINOLOGY_REVIEW_2026-07-12.md` — UI copy rules (see §5).
- `guide/04-moving-money.md` and `guide/06-the-pay-period.md` — not verbatim, but the clearest prose statements of the budget-boundary rule and the pay-period run; rewrite from these rather than from scratch when the guide is written.

## 2. Absorb into the design doc (no decision needed — these are compatible)

Grouped by the section of `Open Source Finance App.md` they land in.

**General concepts**
- Structural validation of a record (signs, sums, lines matching budget movement) is *validation*, not a block, and does not contradict "the only refusal is money that does not exist". Write the corollary. (ADR-008)
- Every row keeps a wall-clock `created_at` separate from its business date. It is provenance, never read as a date by the user, and it is what lets "you entered this after your last reconciliation" be derived instead of stored. (ADR-006, ADR-044 D5)
- Configuration changes — floor, boundary category, linked-category set — never rewrite existing lines; the integrity check reports drift, re-saving fixes it, nothing cascades. So a floor change cannot be backdated. (ADR-014)
- "What stood on a date" (stock) and "what happened between two dates" (flow) are two queries over the same rows; the current period uses the same query as any past one. The distribution screen and every report need flow; the doc currently only names stock. (ADR-023)
- Zero is a valid amount for a transaction and a line; an empty field is refused, a typed 0 is honoured. (ADR-020)
- Nothing posts itself. A recurring bill or income can offer a one-tap "record now"; silent auto-posting was declined deliberately. This answers the doc's open question on auto-paid bills. (ADR-044 A3)
- Spent vs. moved out is derived, never stored: a category line on a transaction that also has a tracking-side account line is money leaving the budget, not spending. Reports, anomaly baselines and the emergency-cushion median read spent only. (ADR-012, ADR-039)
- "On-budget above floor" is computed in exactly one helper. The old app had four inlined liquidity definitions giving four answers. (ADR-012)

**Accounts**
- Every debt account gets a nullable *terms* block (rate, compounding rule, statement-close and due dates, term and amortization dates, open/penalty model, promo-expiry for deferred-interest plans). It is additive and no v1 logic reads it, but without it no payoff report is ever possible. **Null means unknown, never zero** — a 0.0 default put a false rate on a real card. (ADR-041, Canadian_Loan_mechanics)
- The loan-payment example must show interest: `Chequing −450, Car loan +380` with category lines `Car loan −380, Car interest −70`. Otherwise the loan drifts from the lender's statement monthly. (ADR-016, Canadian_Loan_mechanics)
- A valuation on a tracking liability whose adjustment is interest should be able to carry an "Interest" category line, or interest that only arrives via reconciliation never reaches a spending report. (ADR-040)
- Reconciliation: a transaction dated before the latest valuation warns on entry and marks that valuation stale (derived from `created_at`, not a flag). (ADR-008, CRITIQUE slice 3 B4) — see DECIDE 6 for whether it also locks.
- Gift cards, store credit, cashback balances are ordinary on-budget accounts; "only spendable at one payee" is the account's name, not a mechanism. "Can't access it" and "can only spend it here" must never share a field. (ONBOARDING_NOTES O7/O8) — see DECIDE 9.
- Opening balance is a dated transaction that arrives unassigned (or a valuation on a tracking account); say which. (ADR-040)

**Categories / goals**
- Say whether a category with children is postable and appears in pickers. The old failure was organising headers silently eating "to be assigned". (ADR-011)
- A Target goal needs a date *or* a per-period amount, never both and never neither — a dateless, amountless target computes nothing and silently does nothing. (ADR-026)
- Add "top up to $X each payday" (refill-to-level) as a Commitment variant. It is the most common envelope rule and no current goal kind expresses it. (ADR-026 amendment, ADR-038)
- Distribution prefill for categories with no goal: last period's actual, not a stored default (groceries swung $263–$914 across six real periods). (DESIGN.MD)
- Overspend is a persistent state on the category until funded, never a toast; the aggregate is Σ max(0, overspend), never netted; over-assigned and over-spent are two different facts. (ADR-008, ADR-021)
- Permanent regression test: record an expense against a funded category; "to be assigned" is unchanged. (ADR-021)
- A row hidden on a surface contributes nothing to that surface's totals or red state. (ADR-019, ADR-021)
- Closing requires zero balance as of the close date and no rows dated after it; closed things vanish from pickers, stay on history, and an existing reference still shows labelled "(closed)" and saves unchanged. Allow hard delete only when nothing references the row (a mis-typed "Grocries" must be removable, or exclude closed rows from the unique-name index). (ADR-029)
- The link between a mechanism and a category is always an FK from the thing that needs it (`boundary_category_id`, linked account), never a role enum or a reserved name. (ADR-035)

**Transactions**
- Record the rejected alternative and why it's now acceptable: ADR-033 refused "refund as a sign convention" because it hid meaning in a sign; the new model is fine because the category line's sign *is* the meaning and the ledger UI labels a positive category line as a return.
- Inflow default: with a resolved category it is a refund, without one it is income to assign; the form says which it chose. (ADR-033 D7)
- Create and edit go through one validation/write path; edit is never a second implementation. Validate everything, then persist. (ADR-013, CRITIQUE slice 3)
- A one-off "I fronted $40 for a friend, no split rule" also uses a receivable account — otherwise the third mechanism for money-owed-to-me returns. (ADR-033)
- Never store an amount the calendar already carries; a plan references a planned event by id and reads the amount from it. (ADR-042 D2)
- Free-lottery-ticket acceptance test: total $0, +$6 and −$6 to the same category, must save. (ADR-018)

**Payees**
- Payees carry a default category (and later import aliases). Pick payee → most fields pre-filled → confirm amount → done was the best-liked interaction in the old app. (DESIGN.MD, DESIGN_CRITIQUE, guide/05)

**Income streams**
- Irregular income never projects into upcoming, forecast or next-payday maths. Define which stream sets "next payday" for goals; a user with only gig income has no payday. (ADR-025)
- Plan on the midpoint of the expected range, forecast on the minimum. (guide/05)
- "Paycheque landed?" prompt with midpoint prefill and a "set actual" button; a "Distribute this paycheque?" toast after income posts, inline, never modal. (SESSION_LOG)
- Give streams a start/end date and an "indexed" flag; a pension is then just a stream. (ADR-045)

**Reporting (later)**
- Cash-flow forecasting ("can I afford what's coming before next payday") is a pillar with no home. It is a report over future-dated rows and goal due dates, with a Safe-to-Spend that never adds future income and so can never exceed cash on hand. (ADR-002, PRODUCT_VISION)
- The emergency-fund target (N months of needs-only spend) is the first report to build; no peer app derives it. Needs a mapping decision for the four-tier scale (cushion = need; comfort = need + should). (savings research)
- "Contributed X, market added Y, total Z" per linked category is the white-space feature and the only thing that justifies routing gains into goals; the transaction shape in DECIDE 2 makes it a group-by. (savings research)
- Warn when a short-dated goal is linked to a volatile account (3–5 year horizon). Planning surface, so a warning is allowed. (savings research)
- Anomaly flags are computed at read time, never stored; an acknowledgement is a context note (scope + date range + text), one primitive. (ADR-039)
- The reports specced but never shipped: need/want composition of a period, "safe to cut", planned-vs-actual by stream, goal "at this rate by [date]", net worth over time, a Sankey (flagged as the case where double-counting is silently wrong). (DESIGN.MD)

## 3. DECIDE — conflicts with the design doc that need Ben's call

1. **Gross pay and deductions.** The doc's paycheque is net-only and the invariant (category lines must equal budget movement) cannot represent `Chequing +2,400` with `Income tax −1,025, CPP/EI −476` lines. ADR-034 argued source deductions are real spending (a bus pass deducted at source *is* transport). Options: (a) generalise the rule to *unassigned = budget movement − Σ category lines* — gross lands unassigned, deductions hit their categories, distribution pre-fills them; no new mechanism; (b) net-only, with the stream carrying a gross/deduction template for a report. Recommendation: (a).
2. **How a valuation gain reaches the goals.** The doc says the gain is written to the earmark ledger. But the account balance is a sum of transaction lines, so an earmark-only write raises Σ category balances without raising on-budget money and "to be assigned" goes negative by the gain — the exact bug ADR-021 fixed. Fix: a valuation on a linked account produces an *adjustment transaction* (`FHSA +300`, category lines `Home Downpayment +300` pro-rata) — the refund shape, same path as any reconciliation, no `source = valuation` earmark kind. Recommendation: adopt; it deletes a mechanism.
3. **Deposits to a linked account.** `Chequing −500, FHSA +500` raises the account but not its linked categories, so "account balance = Σ linked categories" breaks on every deposit. Fix: the deposit form also writes an earmark move into a linked category (from "to be assigned" or a chosen category), and the equality is a warning on the account page, not an invariant. Recommendation: adopt.
4. **Domains vs. parent grouping.** ADR-036 chose a *fixed* domain taxonomy ("comparability across time is the point; an editable taxonomy is just categories again"). The doc has editable domains *and* `parent_id`, i.e. two user-defined groupings. Options: fixed domains; or keep both with a hard split — `parent_id` is display-only and never appears in a report, domain is report-only and never drives the tree. Recommendation: keep both with the split; it's two consumers, not two mechanisms.
5. **The date picker and writes.** The doc says the picker "never changes what gets written". ADR-044 D5 (Ben's own rule) makes the picker the *default date* of every write form — walking to next month to record next month's payday must not mean retyping the date each time. Reword: the picker never changes a write's *meaning*; it is the default of the write's date field. Recommendation: reword.
6. **Reconciliation lock.** Old app: reconciling locked every earlier transaction; un-reconcile to edit. The doc's "only refuse nonexistent money" forbids that and is silent on what reconciling protects. Options: lock; warn and mark stale (derived); nothing. Recommendation: warn + stale.
7. **The "draws funds from another category" sentence.** The doc's Context promises a category-to-category funding relationship; App Design defines none. ADR-022's `funds` edges were the old app's second earmark mechanism and were reported as "the pool does nothing". Options: delete the sentence (overspend goes negative, covered by an ordinary move); or define a draw-on-overspend rule. Recommendation: delete.
8. **One goal, many accounts.** ADR-045: retirement spans RRSP + TFSA. The doc links a category to at most one account, so the only route is a category per account — the per-account pattern ADR-035 rejected. Fix: the link is a table anyway; make it many-to-many, pro-rata still works. Recommendation: many-to-many.
9. **Payee-locked money.** Gift cards, store credit, cashback. Recommendation: ordinary on-budget accounts, no mechanism (see §2). Confirm.
10. **`credit_limit_cents` and `account_type` under the earns-its-place test.** Both are "mostly a label". Each needs a named consumer (a report counts) or goes; `credit_limit` probably belongs in the terms block. Recommendation: move the limit into terms; keep type with the consumer written next to it (form defaults + net-worth grouping).
11. **Reversal of ADR-002.** ADR-002 rejected effective-dating the ledger to model the future because it turns every balance into a time-travel query. The doc chose exactly that. Deliberate — record why the dated-sum cost is now acceptable (Postgres, personal scale, one query for past and present). Recommendation: one paragraph in Founding decisions.
12. **Reversal of the no-tenant-key rule.** Old CLAUDE.md: never add a user id to any table (tenancy at the connection layer). New doc: `owner_id` everywhere. Record the rejected alternative and why (RLS needs the column; schema-per-tenant was for Drive-backed storage). Recommendation: one line.

## 4. Requirements for the undesigned UI (from real use)

From `ONBOARDING_NOTES_2026-08-02.md`, `DESIGN_CRITIQUE_2026-06-07.md` and the critiques. These are the frictions Ben actually hit; the new UI is judged against them.

- The first screen is the least forgiving. Every choice list gets a one-line "use this when…"; short list plus "more"; account type is changeable after creation, or the form says it is not.
- Liabilities get one field, "amount still owed", with the signed result shown live and liabilities grouped in red. Two of two loans went in with the wrong sign and inflated net worth by $72k.
- Category choice at entry time shows funding: "Groceries: $80 → −$20" in red, with an explicit "record anyway" that is never the default.
- Split-generated and multi-line transactions must be editable; a mistyped amount is the commonest failure and must be fixable without retyping the rest.
- Nav by intent (assign / plan / review), not by table. Dashboard = a few trustworthy numbers plus one next-step prompt ("$886 unassigned — distribute?") plus quick-add. A number you can't trust is worse than no number ("Safe to Spend $1,895" above "Liquid Cash $1,466" cost every other number its credibility).
- Every budget screen carries period context; ledger grouped by month with filters.
- Contrast: the dark navy theme is liked, but pickers, placeholder text and secondary labels are too low-contrast to read on a phone in daylight. Meet WCAG AA contrast on every control, not just body text.
- Nothing hover-only; touch targets; works on a narrow phone, a desktop and a foldable inner screen; no `type="number"` money inputs (phone keypads have no minus key).
- Stat colour reflects state (green/amber/red), not always green; one page-header, one primary button, one stat card, one currency formatter, one date formatter (`en-CA`, noon-UTC parse).
- Phone quick-capture is a mode inside the one app calling the same record path; last-used category per payee is read from the ledger, not stored.
- Most recent account pre-selected; switching is one tap. Warnings inline, never modal.
- The integrity check must run in production, where the data is — the old one was dev-gated.
- What Ben liked and should survive: dark navy theme, payee autocomplete auto-fill, two-click inline delete, skeleton loading, income shown as a min–max range with an "auto-filled" label.

## 5. UI copy rules (TERMINOLOGY_REVIEW)

"Pay Period", never "Waterfall". "Run" and "commit" never appear in user copy. "Safe to Spend" and "Available to Assign" are the anchor terms — the doc currently says "To be assigned"; pick one. "Upcoming" / "Record now" / an overdue state. Plain liquidity words, never enum names. A concept the UI leans on must be introduced somewhere. Icon-only meaning fails on touch — always a visible label. Settle the envelope-vs-category register once. Note the word "earmark" changed meaning: old = a payee-locked slice of an account balance; new = the category-assignment ledger. Check any carried-over prose.

## 6. For the new CLAUDE.md (stack-independent conventions that survived)

Money is integer cents everywhere, dollars only at display; state a rounding policy wherever a rate meets cents. Pydantic is the API shape, ORM classes are the stored shape; never persist one or return the other from a router. All access through the per-request session; commit on normal return, roll back on any exception; validate every line then persist. Direction is the sign of the line and nothing else. Never call `date.today()` / `new Date()` to decide what day it is for logic or form defaults — resolve the picker. Never a second door for "this balance changed with no transaction". Render filter and roll-up filter are one predicate from the backend. Choice surfaces hide closed entities; history surfaces keep them. Enums are plain strings; every FK column is indexed; the DB enforces only invariants the service already enforces with a matching 4xx; a list becomes a table only once something queries it. Migrations run at container start behind an automatic pre-upgrade dump, refuse to start when the DB is newer than the code, and are tested against a *populated* previous-revision database — both broken migrations in the old app passed every empty-DB test. Test fixtures under `tests/fixtures/`, never in the data directory. No `scripts/` of one-off fixes someone must remember to run on the Pi. `pg_dump` is not a user feature: export/import as a versioned format is, and the restore is tested. No build state in CLAUDE.md. ADRs are numbered, never edited to change a decision; supersede and annotate in place; an ADR says what it deletes. No abstraction without two real consumers — multi-user readiness (`owner_id`) is the one named exception. Frontend: functional components; every fetch through one request helper that surfaces the backend's `detail` on every non-OK response; Tailwind tokens only, chart colours from one module mirroring them; one `formatCents`, one date formatter.

## 7. Governance lessons (process docs)

The rules the old project paid for, each with its incident: instruction files point at repo files and never restate them (every restatement drifted); issue state is pulled fresh every session, never from memory (sessions asserted closed issues were open); one write channel for docs (a session wrote to WSL *and* pushed to main, leaving a conflict); the plain-language rule — issue title is one sentence of what the user can now do, decisions open with "In practice" (Ben could no longer follow either seat); "what does the second click do?" for any multi-call save (a retry duplicated a live record); two gates every Done note must answer aloud — schema outcome and guide outcome (a fixture reshape was passing as a migration on the only copy of the data); an Architect session ends in a decision, a Manager session in a commit, never both (scope creep, with commits to prove it); the Tutor never explains a file it did not read this session (six weeks of docs described an app that no longer existed); no GitHub Milestones (the MCP can assign but never read one); a mechanism that dies gets deleted from the docs the same day (`is_slush_fund` outlived its ban by six weeks); ask clarifying questions before a detailed plan, most of all in the Architect seat (a wrong assumption becomes an ADR).

Whether the rebuild keeps four seats is a separate decision. What it should keep regardless is the shape: one file of pointers per seat, the read protocol (titles only, then the one issue, then the one ADR), and the two gates.

## 8. Drop

JSON storage, Drive/OAuth storage, the plugin architecture, category graph and multi-parent edges, holding pools and the sweep, `funds` edges, earmark-as-reservation, WaterfallRun / BudgetProjection, the liquidity spectrum (Instant/Short/Locked/Asset), transaction types, category types, payee types, free-form tags, reimbursables as a mechanism, two-row linked transfers, the cleared flag, SQLite batch-mode rules, the Commit & Lock / planned / confirmed state machine, per-month budget snapshots, `BACKLOG_ARCHIVE.md` and `ROADMAP.md` (history only).
