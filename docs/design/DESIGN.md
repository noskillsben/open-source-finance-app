# Open Source Finance App

## Context

This is a rebuild from scratch of a previous finance app known as "Ben's finance app". Developing that app was incredibly insightful, but multiple changes in direction during iteration saddled the project with too much tech debt and bloat before version 1, so this app restarts with a clearer vision.

The aim is to be the least specific possible. When reading examples in this document, do not assume an example is a special use case that needs a special type of account, transaction, payee, etc. They are examples. If a category is described as drawing funds from another category, that does not make either one special — it means there is a relationship model any category can use on both ends, not a special "holding" category or "funded by others" category.

**The one-mechanism test.** Every proposed feature has to answer two questions before it is filed: which existing relationship or table does this use, and if it adds a new one, what existing one does it delete? The previous app died of second mechanisms (two ways to earmark, three ways to say "money owed to me"). A feature that adds a mechanism and deletes nothing is a decision to be argued, not a build.

## Philosophy

This app is a **financial mirror, not a financial cage**. Money represents time and choices. The app's job is to make sure decisions are informed rather than reflexive — to surface what is actually happening with clarity and context, not to judge or restrict.

Mindful spending, not restrictive spending. The app helps you see clearly so you can make the trade-off you actually want to make. It never alarms without context, and it always lets you say "I know what I'm doing" and move on. A negative leftover is a legitimate outcome, not an error; covering a period from savings or credit is a normal move. The app shows it, names the shortfall, and offers a suggestion — never a block on recording.

The app does three things with three different tempos, and they are three separate views that are never collapsed into one screen:

| View                   | Question it answers                         | Tempo                   |
| ---------------------- | ------------------------------------------- | ----------------------- |
| Envelope budgeting     | Where does my money sit right now           | Daily / per transaction |
| Cash-flow forecasting  | Can I afford what's coming                  | Per paycheque / monthly |
| Spending awareness     | Am I making the trade-offs I actually want  | Monthly / quarterly     |

What the app explicitly does not do: moralize; block on budget status; count transfers to investments or debt payments as spending; treat every non-chequing account as equally inaccessible; force a category structure the user doesn't think in.

## Vision

This is a budget app for Canadian finance nerds. It goes beyond recording a transaction under a payee, category and account. The following are general statements, not building instructions.

### Planning

Plan your income streams — reliable like a paycheque, or less reliable like self-employment and gig work — and plan a one-off income, like a bonus or a tax refund, as the dated income you expect. Set goals on categories: recurring bills, savings targets with or without a deadline, or a fixed commitment per payday. When a paycheque lands (or is planned), distribute it across categories with the goals pre-filling what each one needs.

### Transactions

A transaction is money actually moving. Categories carry a domain (food, shelter, entertainment — user-defined, with defaults) and a default need level (need, should, nice to have, want). Both feed reporting and the "what do I actually need in an emergency" view.

### Accounts

Accounts are on-budget (their money can be assigned to categories) or tracking (value is watched but not budgeted). Credit cards and overdrafts can put a chosen slice of their credit on budget. Investment and registered accounts can be on-budget and linked to long-term categories, so gains and losses flow into those goals. Every account gets the same balance check.

### Ledger based

Everything is datestamped, including account, payee and category creation, earmarks, moves and balance checks. The app can show its state on any date in the past.

## Architecture Overview

The app runs in single-user mode by default (no auth; Cloudflare tunnel + Zero Trust for WAN access) and is schema-ready for a later multi-user mode.

| Layer                         | Technology                                                                                       |
| ----------------------------- | ------------------------------------------------------------------------------------------------ |
| Backend                       | Python 3.12 / FastAPI / Pydantic v2                                                              |
| Frontend                      | React 18 / Vite / Tailwind CSS                                                                   |
| Storage                       | PostgreSQL via SQLAlchemy 2.0 (no SQLite)                                                        |
| Auth (`single_user`, default) | None — single user, no middleware (Cloudflare tunnel + Zero Trust as auth for WAN access)        |
| Auth (`multi_user`, later)    | Login auth + Postgres row-level security. Not built in v1.                                       |
| Containerization              | Docker + docker compose (Linux containers via Docker Desktop, developed outside WSL)             |
| Deployment target             | Raspberry Pi 4 (arm64 Postgres image); backups are a scheduled `pg_dump`, not a folder copy      |

All data access goes through the per-request ORM session. No direct SQL or file I/O in a router.

### Founding decisions

- **Clean start.** No migration from the previous app's data. The old app keeps running until this one is usable; accounts and opening balances are re-entered.
- **Effective-date view, not audit replay.** "Show me any past date" means: balances, earmarks and entities as they stood on that date, using today's knowledge. A corrected transaction shows corrected on every date. This needs dated rows and dated archives, not an event log.
- **Schema-ready for multi-user.** Every table carries an `owner_id` from day one. v1 has no login, no user management, no RLS. Adding them later is additive, not a stored-shape migration.
- **Minimal protected data.** The only protected record in the app is the payee "Me". Everything else the app creates by default (categories, domains) is editable and archivable.
- **Two deliberate reversals of the previous app.** It refused to date the ledger for the future because every balance would become a time-travel query; that cost is accepted now (Postgres, personal scale, one query serves past and present). It refused a user id on any table because each user had their own storage; that no longer applies, and row-level security needs the column.

## App Design

The following mixes logic and database description to describe functionality and the philosophy behind it. Field names are illustrative, not final.

### General concepts

- **Unique names, case-insensitive.** "TD savings" == "td Savings" and will not be created twice. Postgres: unique index on `(owner_id, lower(name))` or the `citext` type. Applies to accounts, payees, categories, domains, splits, income streams. Goal names are not unique — a goal is addressed through its category.
- **One clock: the date picker.** The UI has a global date picker defaulting to today. Every data view reads it, and it is the *default* date of every write form — walk the app to next month and the paycheque you record is dated next month without retyping. It never changes a write's meaning: every row carries its own date, and the picker only pre-fills it. The picker is the only place "today" is a default; business logic never asks the wall clock what day it is.
- **Two dates on every row.** The business date (`date` / `created_on` / `archived_on`) is what the user reads and what every view filters on. A wall-clock `created_at` (and `updated_at`) is also stored on every row; the user never sees it as a date. It is provenance: it is what lets "this was entered after your last balance check" be derived instead of stored.
- **Stock and flow are two queries on the same rows.** "What stood on this date" (balance, category total, to-be-assigned) sums lines up to the picker date. "What happened between two dates" (assigned this period, spent this month, income this year) sums lines inside a range. The current period uses the same range query as any past one.
- **Zero is a valid amount.** A transaction or a line may be $0 (a free lottery ticket; a $6/−$6 correction to the same category). An empty field is refused because empty is a forgotten field; a typed 0 is a stated intent.
- **Two kinds of rows: ledger and non-ledger.** Ledger rows are the dated money facts — transactions and their lines, earmark lines, valuations. They can be edited and deleted outright; a correction shows corrected on every date (see Founding decisions). Non-ledger rows are the things ledger rows point at — accounts, categories, payees, domains, goals, splits, income streams.
- **Non-ledger rows are archived, never deleted.** Every non-ledger row carries `created_on` and a nullable `archived_on`, as one shared mixin that a non-ledger table is never created without — the two dates arrive with the table, in the same revision, never as a later retrofit. Archiving and unarchiving are built once against the mixin, so a new entity gets the behaviour the day its table exists. A row is shown on a given picker date if `created_on ≤ date` and (`archived_on` is null or `date < archived_on`). Archiving is the only "delete"; it defaults to the picker date. Rules:
  - `archived_on` must be strictly later than the date of the latest ledger row still pointing at the entity. If a transaction dated the 15th references the category, the category cannot be archived on or before the 15th. (By the same logic `created_on` cannot be later than the earliest ledger row pointing at it.) The one row exempt is the archive sweep below, which is dated on `archived_on` itself.
  - Unarchiving clears `archived_on` entirely. The entity then appears at every date since `created_on`, including periods during which it had been archived — the app remembers only the current state, not the history of archiving. This is the effective-date view applied to entities.
  - Archived entities vanish from every picker and choice surface and stay on every history surface (ledger, reports). A ledger row that references an archived entity still shows it, labelled "(archived)", and saves unchanged.
  - Archiving a category with children archives the children with the same date; unarchiving a parent never unarchives its children.
  - **Archiving a category empties it into ready to assign.** If the category's balance on the archive date is not zero, archiving writes one earmark line of that balance, positive or negative, dated on `archived_on`, with source *archive sweep* — so money and deficits never vanish with the envelope: ready to assign rises by what the category held, or falls by what it was short. The save note says what moved ("moved $42.10 to Ready to assign"). Each child archived with its parent gets its own sweep. The sweep is an ordinary move written once: unarchiving leaves it in place, and the user moves money back by hand if they want it. A later edit to an older row on an archived category can leave a remainder, which is moved by hand like any other balance.
  - Archiving an account with a non-zero balance as of the archive date is a warning, not a block — emptying an account would need a transaction, and the app never writes one on its own. Archived rows are ignored by the unique-name rule (the unique index is partial: `WHERE archived_on IS NULL`), so a mistyped "Grocries" can be archived and "Groceries" created; unarchiving refuses (planning surface) if the name is now taken.
- **First-run defaults come from one seed step.** The things the app needs to exist before the user types anything — the payee Me, the default category set, the default domains, the "Debt payments" category — are inserted by a single idempotent step that runs at container start after migrations: insert what is missing, never touch what exists, so a default the user renamed or archived stays renamed or archived. What a default *is* is its `seeded_key` — per-row provenance on the non-ledger mixin, unique per owner — never a name lookup, which a rename would defeat; a default is skipped as well when the user already has a live row of that name, because theirs is the row they meant. Defaults are data in that one list, never inserts inside a migration. An issue that introduces a new default adds a line to the list; it does not add a second mechanism.
- **No stored balances.** Every balance, category total and "ready to assign" number is a sum of dated lines up to the picker date. If this ever gets slow, add a materialized view — don't add a balance column.
- **Future-dated rows are the plan.** A transaction dated next Friday is excluded when the picker is at today. When the money actually lands, the row is edited. There is no "planned vs. real" status flag.
- **Nothing posts itself.** A recurring bill or a named pay that is due offers a one-tap "record now", which writes the transaction with the goal's category and amount pre-filled — on the goal's own row on Categories for a bill, and on Pay for a named pay, never on a separate "what's due" list; the app never writes a transaction on its own — the single exception is the opening-balance adjustment it maintains (Balance checks). Silent auto-posting is declined deliberately — a transaction is what has happened, a goal is what hasn't, and there is no third state.
- **The only thing the app refuses to record is a record that does not add up.** On the recording surface (transactions, moves, balance checks) every other guard is a warning. Blocks are allowed on planning and settings surfaces — archiving, links, pools, unarchiving into a taken name — because nothing recorded there is a claim about money. Checking the *shape of the record itself* — a missing date or account, lines that don't add up to the total — is validation, not a block: it protects the ledger from being unreadable, not the user from their budget. Refusing to record money that was already spent doesn't protect the budget; it makes the mirror wrong. A balance that could not physically have happened — a wallet dispensing more than it holds, a card past its limit — is a warning and not a refusal either (Accounts → Credit limit): an impossible record is a sign the record is wrong, not a reason to lose it.
- **Settings never rewrite history.** A transaction's budget movement is computed once, when it is written, and stored on its account lines (each line records how many of its cents landed on-budget — Transactions → Invariant defines that number). Changing a floor, a boundary category, a pool, a linked account or an account's budget side affects only writes from then on. The integrity check can flag an old row that would compute differently under today's settings, and re-saving it applies them. Nothing cascades, and nothing is recomputed at read time. Consequence: a floor or a link is a *setting* with a current value, not a dated ledger fact — it is not backdated, and it needs no history table. Second consequence, stated because it surprises: since the floor is not dated, "ready to assign as of last March" answers using today's floors. That is correct — the floor is how much credit you are *currently* willing to budget with — and it is why there is no floor history table.

### Accounts

An account is where money, debt or value is held: a wallet, a bank account, a loan, an investment account, or a physical item worth money.

#### Account type

A label with exactly three consumers, and nothing else may branch on it: **form defaults and labels** (which fields the account form shows, the floor, budget side and boundary-category defaults it pre-fills, and whether the balance-check button says "check balance" or "update value"), **net-worth grouping** (cash / investments / liabilities / assets), and the **short-horizon note** on links to Investment accounts. The interest and payoff reports, when they exist, read the terms block below, never the type — a "Payment plan" can be 0% fixed, simple-interest or deferred-interest, and the type cannot tell.

- Cash — physical dollars
- Chequing — daily transaction account
- Savings — pays nominal interest
- Investment — buying and selling investments (TFSA, RRSP, FHSA, non-registered)
- Credit card — revolving credit charged directly
- Line of credit — revolving credit usually drawn into another account
- Mortgage — loan for land and homes
- Payment plan — micro-loan dividing a purchase into equal payments, with or without interest and fees
- Loan — other closed loans (car loans etc.)
- Asset — a physical item that holds value; usually not sold, but can be

#### Budget side: on-budget or tracking

- **On-budget:** money in this account can be assigned to categories. This includes cash, chequing, savings, the budget slice of credit accounts, receivables (see Splits), and any investment or registered account the user wants goals against.
- **Tracking:** value or liability the app watches but does not budget: assets, mortgages, closed loans, investments the user only wants in net worth, money that isn't spendable yet (accruing cashback).

Any account can be either. The user chooses per account.

#### On-budget floor

Every account has `on_budget_floor_cents`, default 0. An account's **on-budget money** is `balance − floor` — how far the balance sits above the floor, and negative when it sits below. One subtraction, in exactly one helper, covering overdraft and "budgeting with credit":

- A chequing account with $500 overdraft the user is willing to budget with: floor −500.
- A credit card where the user allows themselves $1,000 of credit as budget money: floor −1,000. Balance −250 shows 750 of on-budget money; balance −1,500 shows −500 — the budget is $500 in the hole, and the account page says *below your floor by $500.00*.
- A savings account: floor 0.

**The floor does not clamp.** On-budget money goes negative below the floor; it is never held at zero, and there is no separate "tracked debt" figure — below-floor debt *is* negative on-budget money, the same fact with a sign. A `max()` there would be the only non-linear term in the app's arithmetic, and it breaks conservation: money spent past the floor leaves the account but disappears from the budget, so an honest overdraft cannot be categorised and a deposit into an overdrawn account registers no budget movement at all. Passing the floor is not an event the ledger records and it needs no category; it is a consequence read off the account.

The floor is a setting, not a dated event (see General concepts → Settings never rewrite history). It may not be set below `−credit_limit_cents` where that limit is known — you cannot budget with credit the lender has not extended. That is a settings surface, so it is a block.

#### Debt terms

Any account may carry a nullable **terms** block — what the lender imposed. One field in it has behaviour in v1, `credit_limit_cents` (Credit limit, below); the rest is read only by the account page, and the payoff and interest report, later, is their consumer. Without them that report can never be built, and it is cheaper to add to the form now than to backfill later. Fields, all nullable: `credit_limit_cents` (card limit, LOC max, original loan amount — and the floor of what the account can physically hold); annual rate; compounding rule (Canadian fixed-rate mortgages compound semi-annually, variable ones monthly, cards daily — the rule is data, not code); statement-close day and grace days for revolving credit; term end and amortization end for closed loans (two dates: the term is when you renew, the amortization is when it's paid off); prepayment model (open / closed with privileges / penalty); promo-expiry date and deferred rate for deferred-interest plans; minimum-payment rule.

**Null means unknown, never zero.** A rate the user hasn't entered is null; a 0% plan is 0. Nothing may default a numeric term to zero — with one stated exception: the account form pre-fills `credit_limit_cents` to 0 for the types that have no credit (Cash, Chequing, Savings), because "no credit" is a fact about a wallet rather than a missing answer. Every other term, and the limit on every credit type, starts null.

Jurisdiction rules (Quebec minimums, the federal rate cap) are wizard defaults the user can override, never enforced.

#### Credit limit — the floor of reality

The on-budget floor is how much of an account's money the user is willing to budget with. `credit_limit_cents` is a different number: what the institution will actually let them have. A balance may not physically go below `−credit_limit_cents` — a wallet holding $100 cannot dispense $200, and a card at its limit is declined at the till.

- **Null means unknown and nothing is said. 0 means no credit** — warn below zero. The account form pre-fills 0 for Cash, Chequing and Savings and leaves it null for the credit and loan types until the user states the limit; a chequing account with a $500 overdraft is that 0 changed to 500. (Form defaults per type — one of account type's three sanctioned consumers, so no fourth appears.)
- **It warns and never blocks.** A balance past the limit is almost always a typo or a missing transaction, because the real one was declined and never happened. The warning therefore says *the record looks wrong*, not *the budget looks bad* — the one balance guard that is a mirror correction rather than a cage. Saving a transaction that takes the balance past the limit on that transaction's own date returns an advisory note on the save, through the same notes list that carries "this predates your Sept 30 check".
- **It is a standing state, not only a save-time event.** Backfilling or editing an older row shifts every later balance, so a breach can appear with no save to attach it to. The account page says so whenever the balance at the picker date is past the limit. Both checks are read-time; nothing is stored.
- **Every account, whatever its budget side** — this is physical reality, not budgeting, and it sits beside "every account gets the same balance check". A closed loan whose interest capitalises past the original principal will warn spuriously; it is a note the user dismisses, which is cheaper than teaching the rule about account types.

#### Payee-locked accounts: gift cards, store credit, cashback

Any account may carry `locked_payee_id`. Spending from that account pre-fills the payee and warns (never refuses) on any other. That is the whole mechanism; the rest is ordinary accounts used well:

- A gift card is an on-budget account, type Cash, locked to the payee. Its balance is budget money and gets earmarked like any other (it was probably earmarked "Coffee" the day it was received).
- A physical card and an online/app balance at the same store are two accounts locked to the same payee; the account list groups accounts that share a locked payee, so they read as one line with two balances.
- Money you have but cannot spend yet — cashback that unlocks on January 1 — is a **tracking** account while it accrues (record each month's cashback as a line on it, or check its value), plus a **future-dated transfer** dated January 1 into an on-budget, payee-locked account. Until then the picker at today excludes the transfer and the accrued cashback shows in net worth only; on the day it crosses the boundary it arrives unassigned. The plan is a row; nothing special fires.

#### Money crossing the budget boundary

Money moving between the on-budget side and the tracking side — into or out of an account you only track — is the only place a transfer needs a category. The boundary is one thing: an account's on-budget / tracking flag. The floor is not a second boundary, because crossing it moves nothing out of the budget (On-budget floor, above), so paying a card that is below or heading below its floor is a plain transfer.

- **Outflow from budget** (paying a car loan, buying an asset, moving money into an account you only track) leaves from a category, like any spending.
- **Inflow to budget** (drawing on a line of credit, selling an asset) arrives unassigned, like income. The app never credits money coming back into the budget to the category it originally left from — that inference was wrong more often than right in the old app, and unassigned is always correct.

Any account may carry `boundary_category_id` — a default category the transaction form pre-fills for **outflows** across its boundary. It is a normal user category with a domain and a goal like any other, not a protected one. Setup creates one generic "Debt payments" category and points every debt account at it; per-loan reporting reads the account lines, not the category, so a category per loan is allowed but is not the default.

Interest and fees charged by a lender are ordinary category lines on the payment (or on the valuation adjustment, below), never folded into principal: `Chequing −450, Car loan +380` with category lines `Debt payments −380, Interest −70`. A payment never has to match the scheduled amount.

#### Balance checks — one table

This is not accounting software and it has no bank feed. A **balance check** is a check-in: "on this date the real balance was X". The word "reconciliation" is not used in the app. A `valuation` is the stored row: account, date, stated balance. The UI says "check balance" on money accounts and "update value" on assets and investments, but it is one mechanism: **a valuation is a fact the user states; the adjustment transaction is how the ledger is made to agree with it.**

- The app compares the stated balance to the sum of lines on the valuation date. If they differ, it offers an adjustment transaction: one account line for the difference, dated on the valuation date, referencing the valuation as its source. The valuation itself is not a line and changes no balance.
- The adjustment's budget movement follows the normal rule: by default it lands in "ready to assign" (which may dip negative — that is the honest number), or the user gives it a category: "Missed transactions", "Interest −12" on a card, "Fees". A categorised adjustment counts as spending like any other line.
- On an account with linked categories (below), the difference is a gain or loss and its adjustment carries category lines to the linked categories.
- On a tracking asset or fund the user doesn't itemise, every valuation produces an adjustment, so "the latest valuation is the balance" falls out of the same sum.
- **Nothing is locked.** The account shows "balance checked Sept 30". A transaction later written with a date on or before that check gets a one-line note at entry ("this predates your Sept 30 check") and the badge becomes "checked Sept 30 — 2 entries added since", derived from the wall-clock `created_at`, never a stored flag. The user checks again when they feel like it.

**Opening balance and backfilling history.** An account's opening balance is its first valuation, dated on the account's `created_on`. Its adjustment is written with the account, dated the same day, and is the one line the app maintains for the user; an account's balance is the sum of its lines and nothing else — a valuation is never summed: whenever a transaction is written dated *before* `created_on`, the account's start moves back to that date and the opening adjustment is recomputed so the first stated balance stays true. Start on September 10 with Chequing at $1,000, then backfill August's groceries (−80): the app moves the account's start date to August 15, moves the opening adjustment there, and it becomes +1,080 — September 10 still reads $1,000, and August 15 reads $1,080. A transaction dated on or after `created_on` never moves the opening; moving it would make the stated opening balance wrong on the date it was stated. This is the one deliberate exception to "settings never rewrite history": a single, known line, recomputed at write time, never at read time. Backfilling past a *later* valuation only makes that valuation stale, as above.

#### Linked categories

A link table (`category_account_link`: category, account) joins categories to the accounts their money physically lives in. A linked account must be on-budget. Many-to-many: Home Downpayment → FHSA #1 and FHSA #2; TFSA → E-bike and Vacation. This is the general relationship for "this envelope's money lives here" and neither end becomes a special type.

Every account is on-budget, so money in the TFSA is already earmarked to E-bike and Vacation; the link records *where it sits*, it does not decide *how much is whose*. Three things follow:

1. **Gains and losses are split pro-rata — and only gains and losses.** When a valuation on the account differs from the sum of its lines, the adjustment transaction carries category lines to the linked categories in proportion to their balances: `TFSA +300` with `E-bike +100, Vacation +200`. Same shape as a refund, same path as any balance check. The split is a suggestion the user can edit before saving; the app has no per-account share for a category linked to several accounts, so it splits by the categories' total balances and the user corrects it if that is wrong. Only positive balances carry weight; each share rounds toward zero and the leftover cents go to the largest positive balance, lowest id on a tie. Because the adjustment's header references the valuation, "you contributed X, the market added Y" is a plain group-by.
2. **Deposits and withdrawals are directed by the user, never split.** A transfer into a linked account is a plain transfer (`Chequing −500, TFSA +500`, no category lines). The form then asks *which envelope this funds* and writes an earmark move: from "ready to assign" or from a category you pick, into one or more linked categories with the amounts you choose ($500 to E-bike, or $50 / $450). If the money was already earmarked to E-bike back on payday, you pick "already earmarked" and no move is written. A withdrawal is the mirror: the transfer, then which envelope the money leaves (into "ready to assign" or a category), or none if you are about to spend it from that same envelope. The directed amounts may add up to less than the transfer — the rest was already earmarked — and never to more. They are regenerated with the transfer on an edit, like any generated line: an empty list means "already earmarked" and clears the ones an earlier save wrote.
3. **Linked money looks locked.** Spending or moving out of a linked category, when the money is in an account you can't spend from directly, shows a warning naming the account. A warning, not a refusal — you may have just withdrawn it.

Two ways to save toward a linked envelope, both ordinary categories and moves: earmark to E-bike on payday while the cash is still in chequing, and transfer later; or run a staging category ("Savings to deposit") with a per-pay goal and move from it into E-bike on the deposit. The app supports both and has no opinion.

**"Account balance equals the sum of its linked categories" is a reminder, not an invariant.** The account's row on Accounts shows the difference when they drift — "E-bike and Vacation hold $500 more than the TFSA does" is precisely the nudge to make the transfer, and "the TFSA holds $120 nobody has claimed" is the nudge to earmark it.

When a category whose goal is due within five years is linked to an account of type Investment, the link form shows a note — the money may not be there when the date comes. Shown on the form, not stored, never repeated elsewhere.

### Categories

What money is spent on and saved for. Categories are flat rows. Each category has a domain, a default need level, at most one goal, and three optional relationships that any category can be on either end of — there are no category types:

- `parent_id` — grouping for the tree view. The tree is a view: it sums children for display and nothing else. **Every category is postable, parent or not** — "Car" can carry its own spending above "Car insurance" and "Car repairs". There is no heading-only category; the old app's quietest bug was money posted to a heading by mis-tap and vanishing from "ready to assign".
- `pool_id` — the category this one draws on when it overspends. See "Pools" below.
- linked accounts (a link table, so many-to-many) — the accounts this envelope's money physically lives in. See Accounts → Linked categories.

There are no protected categories. Setup creates a default set (Groceries, Rent, ...) that the user can rename or archive.

#### Pools

Any category can name another category as its pool. When spending is recorded against a category, the money comes first from the category's own balance, then from its pool, and only what neither can cover takes the category negative. The pool itself never goes negative because of a draw.

The draw is an ordinary earmark move (pool −X, category +X) written at record time, dated with the transaction and marked with the transaction as its source, so the ledger shows exactly what happened and the transaction's save note reads "covered $40 from Household". Editing or deleting the transaction regenerates or removes its draw lines, the same way split lines are regenerated. Nothing is computed at read time, and nothing rewrites past draws when the pool relationship is changed later. A draw covers only the shortfall the transaction itself creates — a category already negative before it is not topped up by an unrelated spend — and a pool archived as of the transaction's date is skipped, the walk carrying on up the chain.

A pool is just a category. It can have its own goal, its own domain and need level, be spent on directly, and be the pool for many categories. **Draws follow the chain**: Snacks → Food → Household. Each hop is its own pair of move lines, so the note can say "covered $40 from Food, then $20 from Household". A category may not be its own pool, directly or through a chain (rejected on the planning surface when the link is set). The category row shows what the chain could cover — "+$170 available if overspent" — as a pill, so the user sees the safety net before they need it. A pool whose own balance is negative counts as zero in that number, since a draw never takes from one.

**"Ready to assign" is not a category.** It is computed: the sum of every account's on-budget money (the floor formula above, unclamped) minus the sum of all category balances. There is exactly one definition and one helper. Unfolded, it is every uncategorised cent that ever landed on budget, plus the credit the floors fold in, minus everything assigned out — which is why recording an expense against a funded category leaves it unchanged, and that is its permanent regression test.

Because it is a plain difference, an overspent category reads back into it: a category at −$50 makes ready to assign $50 higher, the mirror of the overspend, and covering the overspend (from a pool, from "Short by" on the pay screen, or from Add / Withdraw on the category) is what resolves both. Overspending is surfaced, not subtracted out, and the headline says so in plain words: **"Ready to assign $1,000.00 (includes −$500.00 in overspent categories)"**. The parenthetical comes from a second, read-only helper that sums the negative category balances at the picker date. It is a display decomposition and nothing else — it never feeds a write, never changes the headline number, and the one ready-to-assign helper keeps no second `max()`.

### Domains

Bigger concepts than categories: a Food domain holds Groceries, Fast food, Snacks. Its own table with defaults: `name`, `description`. User-editable, because no default list can guess every domain.

A domain is an extra label for reporting, nothing more. It exists so the user is not forced to shape their category tree around how they want reports grouped, or to name awkward parent categories just to get a "Food" total. The tree is how you organise; the domain is how you report. No rules hang off it beyond group-by.

### Need levels

A fixed ordinal scale, not a table: `need` < `should` < `nice_to_have` < `want`. A category has a default; a transaction category line can override it (groceries are a need; the wagyu run is a want). Fixed because the ordering is what makes it reportable and what makes it a sort key on the pay screen. For the emergency-fund report, "essentials" = need only; "comfortable" = need + should.

The line-level override is stored and carried by the API, but no form sets it and no rule reads it yet — its two consumers, the pay screen’s sort key and the emergency-fund report, are both ahead of it. It is watched by #106: a control in EPIC 6, or the column goes.

### Goals

A goal is a rule about a category, not a place money goes. Money only ever lives in categories. Progress is the category's balance compared to the rule. One goal per category; "two goals under Car" is two child categories with one goal each. A goal has its own `name` ("My part of the car insurance" under the Car insurance category) because the rule is often worded differently from the envelope.

Goal kinds:

- **Recurring bill** — amount and cadence (monthly, quarterly, yearly, every N weeks). Due date rolls forward; the envelope refills after each payment.
- **Target** — an amount to reach. Optionally a target date, optionally a per-period contribution, or neither: "pay off the phone in one lump when I can" is a valid goal that shows progress and pre-fills nothing — you put money in when you have extra.
- **Commitment** — a standing rule per payday or per period, no end, in one of two flavours: *add* a fixed amount ("$50 every payday to Fun money") or *refill to a level* ("top Groceries up to $600 every payday"). The refill flavour is the most common envelope rule. The *add* amount may be a percentage of the bound pay's net ("5% of net to Savings") — the "retain income" rows on the pay screen — and a percentage always resolves against net, never gross. Stored as one flavour *or* the other on the goal — a fixed amount, or a percentage of net — never both.

Stored mechanics, so nothing is re-derived per kind: a goal is a non-ledger row, so removing one archives it and "one goal per category" is a partial unique index over the live row. "Every N weeks" is the cadence `weeks` plus a week count. A recurring bill's next due date is its stated date rolled forward by its cadence at read time, never stored. A target with a date derives its per-period amount from the shortfall spread over the periods left, rounded up to the cent.

**Goals are paid by a named pay.** A goal that wants money per payday names the income stream (`income_stream_id`, see Income streams below) that pays it: "$41.60 per Salary paycheque", "rent from Salary, never from Gig". That stream's cadence and next date are what "due by next payday" is computed against. A user with lumpy income is guided to create one monthly stream with a low and high estimate and bind everything to it. A goal with no stream (a dateless Target) never pre-fills. The binding and the percentage flavour arrive with the named pay itself (#21, EPIC 3) — `income_stream_id` is not on the goal table until then, and every goal built so far carries no stream.

Every bound goal can compute **"due by next payday"** from its amount, its stream's cadence, its target date and the category's current balance. A $1,200 quarterly bill with $400 already saved and two Salary paydays left wants $400 now. This number is what the pay screen pre-fills; there is no priority waterfall. Categories with no goal pre-fill nothing; the row shows last period's actual as a hint ("last period: $412"), never as the value — the app knows the past, not the intent.

**On the category's row on Categories** a category with a goal shows a goal row under it: the goal's name, progress as "$132.82 of $1,048.00", the due date, the per-period amount, and an amount box with Add / Withdraw — a quick earmark move between "ready to assign" and this category. The category row itself shows assigned, spent, available, and the pool pill ("+$170.00 available if overspent"). Progress and available are the same number read two ways; there is no separate goal pot.

### Earmarks

The earmark ledger assigns on-budget money to categories. One table: `date`, `category_id`, `cents` (signed), `source` (move, pay batch, pool draw, deposit, archive sweep), and a nullable `transaction_id` — set on pool draws and deposits (which the transaction generated) and on pay-batch lines (for navigation only).

- A **pay batch** (a paycheque being assigned on the pay screen) is a batch of ordinary move lines dated on the paycheque: out of the income category, into the deduction categories and ready to assign, then into the envelopes. It is written whole, never line by line: one call states every pay-batch line for a transaction and replaces whatever was there, in one database transaction, so a failure leaves the old batch rather than half a new one. Recording, re-opening and deleting a pay all go through that call — deleting is saving it empty — and the general move path does not write pay-batch lines.
- A **move** between categories is two lines: −from, +to. A move against ready to assign (the Add / Withdraw box, a one-off line on the pay screen) is one line.
- A **pool draw** is two lines per hop (pool −X, category +X) written by the transaction that overspent, with that transaction as its source.
- A **deposit** into a linked account writes the move the user directed (see Linked categories), with the transfer as its source.
- An **archive sweep** is one line against ready to assign, written when a category with a non-zero balance is archived (see General concepts → Non-ledger rows are archived). It has no transaction.

Gains and losses on linked accounts are *not* earmark lines: they are category lines on the balance-check adjustment transaction (see Balance checks).

A category's balance on a date = sum of its earmark lines + sum of its transaction category lines, up to that date.

### Transactions

There are no special transaction types. A transaction is money actually moving in or out of one or more accounts.

**Header:** `id`, `date`, `memo`, `payee_id`, `income_stream_id` (nullable — which named pay this fulfilled; the column arrives with the pay screen that sets it, not with the `income_stream` table), `split_id` (nullable), `paid_by_payee_id` (nullable, defaults to Me), `valuation_id` (nullable — set on the adjustment a balance check produced, so "contributed vs. grew" and "what did my checks find" are group-bys).

**Account lines:** `transaction_id`, `account_id`, `cents` (signed), `budget_cents` (how many of those cents landed on-budget, computed from the floor at write time — see Settings never rewrite history). One per account touched.

**Category lines:** `transaction_id`, `category_id`, `cents` (signed), `need_level`. Zero or more.

**Invariant:** every account line stores `budget_cents` — the line's own `cents` when its account was on-budget at write time, and 0 when it was tracking. That is the whole definition: no floor, no running balance, no dependence on the order rows were written in, and `Σ budget_cents` over every line is exactly the nominal balance of the on-budget accounts. The *budget movement* of a transaction is the sum of its lines' `budget_cents`. If the transaction has category lines, they must sum to the budget movement. If it has none, the budget movement is unassigned: positive is income ready to assign, negative is uncategorised spending (the app warns, but records it). Enforced in the service layer on every write; a periodic integrity check reports any drift. Direction is carried by the sign of the lines and nothing else — there is no `income` flag, no `from`/`to` pair.

Worked examples (all amounts in dollars, negative = money out):

| Case                                                   | Account lines                           | Category lines            |
| ------------------------------------------------------ | --------------------------------------- | ------------------------- |
| Groceries on debit                                     | Chequing −80                            | Groceries −80             |
| Groceries on debit, passing the floor                   | Chequing −150 (balance was 100)         | Groceries −150            |
| Groceries on credit card                               | Card −100                               | Groceries −100            |
| Pay the card, above or below its floor                 | Chequing −300, Card +300                | — (a plain transfer)      |
| Transfer chequing → savings                            | Chequing −500, Savings +500             | —                         |
| Cash gift, no category                                 | Chequing +2,400                         | — (arrives unassigned)    |
| Paycheque, net only (pay screen)                       | Chequing +2,400                         | Salary income +2,400      |
| Paycheque, gross with deductions                       | Chequing +2,500                         | Salary income +4,000, Income tax −1,000, CPP/EI −500 |
| Employer RRSP match (Wealthsimple on-budget, linked)   | Wealthsimple +150                       | Retirement +150           |
| Car loan payment with interest                         | Chequing −450, Car loan +380            | Debt payments −380, Interest −70 |
| Free lottery ticket                                    | Chequing 0                              | Fun +6, Fun −6            |
| Refund                                                 | Chequing +40                            | Groceries +40             |
| Draw on line of credit (tracking)                      | LOC −2,000, Chequing +2,000             | — (arrives unassigned)    |
| Deposit to FHSA (on-budget, linked)                    | Chequing −500, FHSA +500                | —                         |

A paycheque, a refund and a loan draw are told apart by their lines, not by a type. A positive category line is an **inflow to that category** — a refund on Groceries and gross pay on Salary income have the same shape. So a spending report reads outflow lines and an income report reads inflow lines; no category is excluded by name, and an Income category simply never has outflows. An "Income" domain groups them if the tree is to stay clean.

**Inflow default in the form:** an inflow with a category chosen is a return to that category; with none it arrives unassigned. The form says which it did. The ledger labels a positive category line "return" when that category's net for the month is an outflow and "income" when it is an inflow — the same rule the reports use — so the convention is readable without a stored flag.

**One write path.** Create and edit go through the same validation and the same write. A transaction's own lines are edited freely. Lines that a rule generated — split lines from a split rule, pool-draw and deposit earmark lines from a transaction — are regenerated when the transaction is edited and removed when it is deleted; to change one, change the transaction or the rule. A mistyped amount on a twelve-line transaction is fixed by changing one number, never by retyping the transaction. (The pay screen's earmark batch is *not* generated: it is the user's decisions and is edited on its own, always saved whole — see Earmarks.)

**Money owed to me, without a split rule.** "I fronted $40 for a friend" is the same shape as a split: `Chequing −40, Friend +40`, no category lines, where Friend is a receivable account (on-budget, like any account). Paying me back is a transfer out of it. There is no reimbursable flag, no IOU category, no third mechanism.

### Payees

Stores, companies and people the user receives money from and sends money to. Protected: **Me** (the user) — default and mostly invisible.

A payee carries a default category (whose own default need level then applies) and an `aliases` list (empty until a bank-statement import exists) so "WALMART #3021" and "Walmart" are one payee. Pick payee → category and need pre-filled → confirm amount → done. "Last account used" and "last category used for this payee" are read from the ledger, never stored.

Three different questions, three different answers, none duplicated: *who paid me* is the payee; *what kind of income* is the category (Salary income, Gig income); *which plan did this fulfil* is the named pay link on the header.

### Income streams

A **named pay**: a planned recurring money event the user creates first, and that goals then attach to. `name` ("Salary", "Gig work", "Rent from roommate"), `payee_id`, cadence, an anchor payday, expected gross, an expected-deductions list (category + amount), expected net low and high, destination account, and the income category it lands in. All of it is stated intent the form pre-fills from — the app never guesses a paycheque from history. Reliable (salary) and unreliable (gig, self-employment) incomes are the same row with different cadences.

**A one-off income is not a named pay.** A bonus, a tax refund or a single gig payment is a future-dated income transaction with no link, dated on the day you expect it and edited when it lands — future-dated rows are already the plan (General concepts). A named pay exists so that goals can bind to it and count toward its next payday, and nothing binds to a pay that comes once. So every named pay repeats, and there is no one-off cadence — not on streams, and not on goals, where "once" would only be a second way to say a Target with a date. It is recorded either as a plain transaction in the Ledger and assigned by hand, or on the pay screen opened with no named pay, when you want to split it the way you split a paycheque (Record income, below).

Every stream has a cadence **and an anchor payday**, because goals compute "due by next payday" from the pair. The anchor is one date the user states on the form — the next payday they know about. Next payday is that date rolled forward by the cadence **at read time, never stored**, exactly as a recurring bill’s due date is (Goals). Recording a pay does not advance it: the backend never learns a paycheque happened, and an anchor the app moved forward on each pay would be a second mechanism beside the roll-forward one. A user whose income is lumpy is told, in the form: *you can always set it monthly and estimate the least and most you receive in a month* — one monthly stream, everything bound to it. A user with two paydays creates two streams and binds each bill to the one that pays it.

Recording a named pay — the pay screen, or one-tap "record now" when it is due — writes a normal, possibly future-dated, income transaction with `income_stream_id` set. Income that arrives with no plan behind it simply has no link. Planned-versus-actual per source is a report over that link.

#### Record income — the pay screen

"Record income" on a named pay opens one screen, laid out like the old pay period: gross and deductions at the top, then the goals bound to this pay pre-filled with "due by next payday", then every other category with nothing pre-filled and last period's actual as a grey hint, with a running leftover down the side that is allowed to go negative. The screen is front-end orchestration only. **The backend never learns that a paycheque happened.** Saving writes two ordinary things:

1. **One transaction**, dated on the payday (the screen opens for a specific payday and pre-fills that date, overriding the picker; editable), with the named pay as its link: `Chequing +2,500` and category lines `Salary income +4,000, Income tax −1,000, CPP/EI −500`. The lines sum to the movement; the invariant is untouched. Salary income momentarily holds +4,000, the deduction categories are momentarily negative.
2. **One earmark batch**, same date, referencing the transaction for navigation only: moves from Salary income to cover each deduction category (Income tax +1,000, CPP/EI +500), a move of the rest from Salary income to ready to assign (2,500), then the distribution moves from ready to assign into Groceries, Rent, and so on.

After both, the income category is at zero, the deduction categories are at zero, ready to assign holds whatever was not assigned, and every line is a plain transaction line or earmark line with its own history that can be opened and edited later. Nothing is derived: editing the transaction does not rewrite the batch, because the batch is the user's decisions, not a consequence (unlike pool draws). A user who doesn't care about deductions enters net only; the screen then writes `Chequing +2,400` with `Salary income +2,400` and one move to ready to assign.

**A one-off on the pay screen.** Pay also offers *One-off income* beside the named pays: the same screen with no named pay behind it, for a bonus, a refund or a single gig payment you want to split rather than assign one category at a time. It writes the same transaction and the same batch, with no named-pay link. With nothing to pre-fill from, gross, deductions, destination account and income category start empty; the header shows the date alone, because there is no next payday to make a period; the goal blocks (4, 6, 7, 8) are hidden, because no goal binds to a one-off; and the grey hint on *Everything else* is last calendar month's actual. One-off this period, Short by and Left over work as they do for a named pay. **Re-opening a recorded pay, the "already recorded" duplicate guard, and Delete this pay do not appear on a one-off.** All three depend on the screen finding the transaction it wrote earlier, which only a named pay's `income_stream_id` and anchor payday make possible; a one-off has neither, and a marker invented just to re-find one would be a second identity mechanism for something Income streams (above) keeps deliberately identity-less. A recorded one-off is corrected the same way as any transaction: open it in the Ledger. Recording income straight in the Ledger stays the quick way, and the two write the same shape.

If short, rows sort by need level so wants are trimmed first.

**Re-opening a recorded pay.** A pay recorded ahead of payday is the plan; when the real cheque lands, the user re-opens that pay (from Pay, or a link on the transaction) and corrects it to the stub. There is no separate "set actual" control — correcting block 3 is how the real cheque lands, and a net-only pay is one field. The re-opened screen shows what was recorded, not what the goals would suggest now:

- **Gross to net is editable** and saving edits the same transaction through the ordinary transaction write. No second transaction is ever written; the date stays the payday.
- **Each distribution row is the net of that category's lines in the recorded batch**, placed in the block the category belongs to today: a goal bound to this pay in its goal block, anything else in *Everything else*, a negative net (a *Cover from this*) in *Short by*. Goals are the context line only, never the value — "due by next payday" already counts this pay's money, so pre-filling it would assign the same money twice. *One-off this period* comes back empty: a one-off line and an *Everything else* line are the same category-and-amount, and nothing is stored to tell them apart. A row on a category archived since shows "(archived)" and is read-only.
- **The bookkeeping lines are recomputed from block 3 on every save** — income → each deduction category, income → ready to assign for the net — and never appear as rows. The income category therefore returns to zero, and any difference between estimate and stub shows in **Left over** (block 3's net minus the recorded distribution) for the user to place.
- **Saving is two calls**: the transaction edit, then the batch replace. If the second fails, the difference sits visibly in the income category and saving again fixes it — the same trade-off as Record. Making the pair atomic would take a "save pay" call, and that would teach the backend what a paycheque is.

##### Pay screen layout (kept from the old app)

The old pay-period screen is the layout to rebuild; the blocks below are it, top to bottom, with what each block writes in the new model. Every block is a list of rows with a name, a one-line context (category · due date · expected amount · progress), an amount box, and a **running leftover** down the right edge that turns red the moment it goes negative — the leftover is the single most useful thing on the screen and it stays.

1. **Header** — the named pay, the period it covers (this payday to the next), and a status pill. There is no draft state: a pay recorded ahead of payday is simply future-dated rows, real and editable. The pill says *upcoming* or *recorded*.
2. **Income this period** — net in large type. On a recorded pay the real cheque is landed by correcting block 3, not here.
3. **Gross to net** — a "this paycheque has deductions" toggle; gross with the helper line *what the employer pays before deductions*; one row per deduction (category picker + amount + remove); "+ Add deduction"; net computed at the bottom. These rows are the transaction's category lines. Pre-filled from the named pay's expected gross and deductions list.
4. **Retain income** — the Commitment goals bound to this pay whose amount is a **percentage of net** (`5% of net → $125` on a $2,500 net). They sit here, directly under net, because that is the number they are computed from; they have no priority over anything below. Row: name, category, value, computed amount, remove.
5. **One-off this period** — an empty list with "add anything that only applies this period"; a row is a manual earmark line.
6. **Bills** — every Recurring-bill goal bound to this pay. Those due before the next payday come first, pre-filled with what is still missing for the full amount; those due later follow, pre-filled with their instalment (what is still missing ÷ paydays left — the $1,200 quarterly bill with $400 saved and two paydays left shows $400). Context line: category · due date · expected.
7. **Funding rules** — the fixed-amount and refill-to-level Commitment goals bound to this pay, each with a checkbox to skip it this time. Context line says *fixed* or *$133.73 short of $800.00 level* for the refill flavour, pre-filled with the shortfall.
8. **Goal set-asides** — Target goals bound to this pay, pre-filled with "due by next payday". Context line: category · *$93.30 of $112.00 saved* · due date.
9. **Everything else** — categories with no goal, empty amount, last period's actual as a grey hint.
10. **Short by** — appears only when the leftover is negative, or on a re-opened pay that recorded a cover: every category with a positive balance, its available amount, and a **Cover from this** button that writes a move from it into ready to assign for the amount short (or what it has). Rows already being funded on this screen are excluded from the list — covering a goal from itself is a loop.
11. **Left over** — the final number, red when negative with *assigned more than this paycheque brings in*, and the **Record** button (never "Commit & Lock" — nothing locks). On a recorded pay, **Record** saves the corrections (Re-opening a recorded pay, above). Below it, **Delete this pay** removes the transaction and offers to remove the batch that references it — by saving the batch empty.

Blocks 4, 6, 7 and 8 are the goal kinds (Commitment split by amount type); the screen's structure falls out of the goals table, not out of a rule of its own.

### Splits (roommate / partner)

A split is a rule for sharing costs: `split` (`name`, `description`) and `split_member` (`split_id`, `payee_id`, `account_id`, `percent`). Each member's running balance is an ordinary account — a receivable named after them, on-budget by default, referenced from the member row — because "money my roommate owes me is still my money". A negative balance means I owe them. No special account type.

The transaction form uses the split to generate the lines. Real cost lands in the right category on the right date; the balance amasses in the receivable:

| Case (50/50 split)                          | Account lines                    | Category lines     |
| ------------------------------------------- | -------------------------------- | ------------------ |
| I pay the $100 electricity bill             | Chequing −100, Roommate +50      | Electricity −50    |
| Roommate pays the $50 heating bill          | Roommate −25                     | Heating −25        |
| Settle up: roommate sends me $25            | Roommate −25, Chequing +25       | —                  |

The header keeps `split_id` and `paid_by_payee_id` so the form can regenerate lines on edit and reports can say who paid. `paid_by` defaults to Me; when it is someone else, the form writes no line from my accounts and a negative line on that person's receivable for my share (the heating row above).

The percentages on the split are a pre-fill, nothing more. Any single transaction can carry different amounts ("$100 bill, but I owe 60 because I used more") — that is just different line amounts, and the rule is untouched.

Settling up is a plain transfer with no category, because the spending was already recorded correctly on the original transactions. "What am I paying you for" is a view, not a stored link: the receivable account's page lists the transactions that built its balance since the last settle-up.

A debt that will never be repaid is written off by hand, never by the app: an ordinary transaction `Friend −40` with a category line the user chooses (`Gifts −40`, `Bad debt −40`), and the receivable returns to zero. The app may suggest it when a receivable has been untouched for a long time; it never writes it.

Whether a split member who is also a user of the app (multi-user mode, later) sees a mirrored transaction on their side is the one multi-user question that touches the schema. It stays in "Still to figure out" and nothing in v1 depends on the answer.

### UI conventions

Visual design is a separate pass. These are the rules it has to respect, collected as they come up:

- **The nav is four groups, named for what you are doing**, with the group names rendered as section headers in the menu, and Settings below them. The groups are the three tempos of the Philosophy section plus the recording surfaces, which are not one of the three: **Record**, **Assign**, **Plan**, **Review**. No screen answers more than one of the three questions; the groups are what keeps them apart. Page names are settled here and are not provisional any more — a new surface is named when its issue is filed, against this table.

| Group | Page | Called in this document before |
| --- | --- | --- |
| Record | **Pay** | the pay screen — the term "pay screen" is unchanged in prose and in `CLAUDE.md`; *Pay* is only the label |
| Record | **Quick add** | quick mode — a phone-first page for adding a transaction in a few taps, not a mode the app is switched into |
| Record | **Ledger** | ledger |
| Record | **Balance checks** | balance checks |
| Assign | **Categories** | the category page — the label is the list; one category's own view is its row on that page, and is still called "the category page" |
| Assign | **Accounts** | the account list and the account page, one label for both |
| Assign | **Payees** | payees |
| Assign | **Domains** | domains |
| Plan | **Outlook** | account outlook |
| Plan | **Pay history** | planned vs. actual by named pay |
| Review | **Spending** | spending by domain *and* spending by need level — one page with a grouping control, not two reports |
| Review | **Emergency fund** | emergency fund |
| Review | **Goals** | goal progress |
| Review | **Growth** | contributed vs. grew |
| Review | **Net worth** | net worth over time |
| Review | **Debt** | debt payoff and interest |
| Review | **Unusual spending** | anomalies |
| Settings | **Settings** | settings |
| Settings | **Data check** | the integrity page |

  *Accounts* sits under *Assign* knowingly: you do not assign an account, but assigning is what the group is mostly for and accounts belong beside categories, not in a group of their own. *Payees* and *Domains* sit here for the same reason and one more: neither is a settings surface — a payee or a domain is a thing that exists in the world of money, the same kind of row as a category or an account, and either could grow a balance or time-based view later (spend per payee, spend per domain) the way Accounts already has one. Filing them under Settings now would mean moving them later; Assign is where entity pages that might grow a money view live, so they start here.
- **"Home" is a reserved name and nothing else.** There is no home page. The name is held so that a landing surface, if one is ever wanted, arrives as *Home* rather than as a second "dashboard". If it is built it may show summaries that **link into** the four groups and may never become a fifth place to do the work — a widget wall that answers all three questions at once is the collapse the Philosophy section refuses. It is parked as the last item of EPIC 6 (#98), to be answered only once the four groups are in daily use, and closing it unbuilt is the expected outcome.
- **Drop-downs are alphabetical**, unless the values have a real order — need → should → nice to have → want, account types grouped by budget side.
- **Any picker that could ever hold more than five items is searchable** (type-ahead). Categories, payees, accounts, domains, named pays all qualify from day one.
- **Every list page has filters** — accounts, categories, ledger, goals, scheduled items. Filtering was one of the things that worked in the old app. Filter state is a per-viewer convenience, not stored data.
- **Quick add stays**, as a phone-first capture surface inside the same app calling the same record path — pick payee, confirm amount, done. Its exact shape is not the old one and is designed in the visual pass.
- Contrast: the dark theme is liked, but every control — pickers, placeholders, secondary labels — has to be readable on a phone in daylight, not just body text.
- Nothing hover-only; no `type="number"` money inputs (phone keypads have no minus key); one currency formatter, one date formatter (`en-CA`).

### Reporting and visuals

Mechanics first; this section is a list of questions the app should be able to answer, not a build list, and it will be challenged again before anything is built. It exists so that every stored field named in this document has a consumer somewhere. Visuals — navigation, dashboard, charts, colour — are not decided here at all; they are a separate design pass.

**The one headline number is ready to assign.** "Safe to spend" is not a separate number: cash above floors minus everything earmarked *is* ready to assign, and the old app's attempt to make it something else produced "$1,895 safe to spend" above "$1,466 in the bank" and cost every other number its credibility. What envelopes cannot tell you is *timing* — whether the cash to honour the envelopes is in the right account on the right day — and that is the second pillar, below.

*Where does my money sit* (envelope budgeting, daily):
- **Categories** and **Accounts** — balances, available, the pool pill, the goal row. These are views, not reports.
- The ledger: grouped by month, filterable by account, category, payee, domain, need level; positive category lines labelled return or income by sign.

*Can I afford what's coming* (cash-flow forecasting, per pay):
- **Outlook**: for one account, the balance at the picker date, every future-dated row and every bill bound to a named pay that falls before its next payday, and the lowest point the balance reaches. Never adds income that hasn't been recorded. This is the number "safe to spend" was trying to be.
- **Pay history** (planned vs. actual by named pay): what the pay was expected to bring (low–high) against what its linked transactions delivered, per period, and paydays that came with no transaction. Trivial for a salary; the point of it is lumpy income. Income with no link — a one-off — never appears here. The named-pay link on the transaction exists for the pay screen regardless, so this report is optional.

*Am I making the trade-offs I want* (spending awareness, monthly / quarterly):
- **Spending** for a period, grouped by domain or by need level — one page with a grouping control, not two reports. It reads outflow lines net of returns, **excluding lines on any account's boundary category** — loan principal, and money moved out to an account you only track, is not spending; the interest line beside it is. A category whose lines net to an inflow for the period (Salary income, or Groceries in a month with one big refund) appears on the income side, not here — decided by the sign of its net, never by name. Income has a domain and a need level like any category; nothing reports on them.
- **Emergency fund**: needs-only spend per month × N months, N chosen by the user; "comfortable" = need + should. Derived from the need-level report; no peer app does this from real spending.
- **Goals**: per category with a goal, "at this rate you'll reach it by [date]".
- **Growth** (contributed vs. grew) per linked category, from the balance-check adjustments (`valuation_id`) — the thing no other budgeting app shows.
- **Net worth**, over time: every account, on-budget and tracking, with valuations giving assets their line.
- **Debt** (payoff and interest): reads the terms block and the account lines, with the compounding rules from the Canadian loan research. The terms block's only consumer.
- **Unusual spending**: "3× your usual on eating out this period", computed at read time from the months before the picker date, never stored, acknowledged with a context note ("I know, thanks") — a small non-ledger `note` table (scope, date range, text) added when this report is built, not before.

## Repository and documentation layout

`docs/` is two folders, not one:

- `docs/design/` — this document, the research files carried over from the old app, and any decision record the build needs. Written for whoever is building.
- `docs/user/` — documentation for whoever is *using* the app. Its first file is `README.md`, a **point-form user guide** kept current as the app is built: one bullet per thing a user can do, in the order they'd meet it, no prose. It is not onerous because it is bullets, and it is not optional because it is how Ben knows what the app is supposed to do without reading code. Every closed issue that changes what a user can do adds or edits a bullet; "no user-facing change" is an acceptable answer, silence is not. The long-form guide, when it exists, grows out of this file.

### Backlog and roadmap — GitHub only

Decided 2026-09-12 from `github vs linear for project planning research 2026-09-11.md` (kept in `docs/design/`). One system, no sync, no roadmap file:

- **GitHub Issues is the backlog**, as before. **Issue types** (EPIC / Feature / Bug / Chore) replace the kind labels; **sub-issues** replace the hand-maintained EPIC checklists — an EPIC is a parent issue, its children are the ordered work, and "where are we" is the parent's progress bar.
- **A Projects v2 board with a Roadmap view** is the roadmap. `ROADMAP.md` does not exist in this repo; it was never opened in the last one.
- **Milestones mark releases** (v0.1, v0.2 …), nothing finer.
- Issue titles stay one plain sentence of what a user can do afterwards; bodies open with *What changes*.
- Issue and project **writes happen where they work** — Claude Code with the GitHub MCP or `gh`; chat and Cowork sessions read, triage and draft, and hand writes off if a write fails.
- Revisit only if collaborators, a second repo, or more than a couple of hundred open issues appear.

## Working on the app

Four seats, as in the previous app, because the split worked; what changes is that every instruction file points at this document and `CLAUDE.md` and restates nothing. Each seat's instructions live in `docs/design/seats/` — the canonical copy, pasted into that seat's claude.ai project; the Developer's are `CLAUDE.md`.

| Seat | Where | Model | Does | Never does |
|---|---|---|---|---|
| **Architect** | claude.ai project, rarely | Opus | Decides. Edits this document and adds a dated line to the decision log below; files the issues the decision creates. A session that changes neither the doc nor the board produced nothing. | Writes Claude Code prompts or code. |
| **Manager** | claude.ai project | Sonnet | Picks the next sub-issue in the active EPIC, writes the scoped Claude Code prompt **as a comment on the issue**, reviews the pull request, writes the Done note with both gates answered. Ben merges; the merge closes the issue. | Makes product decisions; touches this document. |
| **Developer** | Claude Code in the repo | Sonnet | Implements the Manager's prompt on a branch and opens the pull request. `CLAUDE.md` tells it to fetch the issue with `gh` first — the prompt comes with it — and read the design-doc sections it cites, so "work on issue 145" typed directly also works for quick fixes. | Edits governance docs or the board. |
| **Tutor** | claude.ai project, read-only | Sonnet | Explains the running code to Ben, citing file and line, from files read this session. Surfaces questions to the Architect. | Writes code, files issues, explains from memory. |

Fable-class models are not needed: the deciding is in this document, and the rest is building against it.

**Rules that survive from the previous app**, each paid for once already:

- Issue state comes from GitHub every session, never from memory.
- One sub-issue per session, one commit; more than about five rounds means stop and re-scope.
- Every Done note answers two gates aloud: *what happened to the stored schema* (nothing / additive with a default / migration written and tested on a populated database, naming the revision and its fixture) and *what changed in `docs/user/README.md`* (the bullet, or "no user-facing change"). Silence is not an answer.
- One write channel for docs: the filesystem, committed by Ben. Issues and comments go through GitHub; writes happen where they work.
- Cowork for bulk mechanical work — a repo setup, a docs pass, a backlog restructure — roughly monthly, not daily.

**Decisions are logged, not filed.** There are no ADR files. A decision is an edit to the section it changes plus one dated line below, so the document stays the only source of truth and nothing overrules anything.

### Decision log

- 2026-09-10 — Rebuild from scratch; Postgres; effective-date view; clean start; owner_id everywhere.
- 2026-09-10 — Non-ledger rows archive, never delete.
- 2026-09-10 — Pools are an optional `pool_id` on any category; draws follow the chain.
- 2026-09-10 — Balance checks replace reconciliation; nothing locks.
- 2026-09-11 — The pay screen is front-end orchestration over one transaction and one earmark batch; the backend never learns a paycheque happened.
- 2026-09-11 — Ready to assign is the only headline number; "safe to spend" is dropped.
- 2026-09-12 — Backlog and roadmap stay on GitHub (issues, sub-issues, Projects board); no roadmap file, no Linear.
- 2026-09-12 — Four seats kept; ADR files replaced by this log.
- 2026-09-13 — Seat instructions live in `docs/design/seats/`; the Manager's Claude Code prompt is a comment on the issue; the Developer works on a branch and opens a pull request the Manager reviews.
- 2026-09-14 — Nothing can be archived until its table exists, so the archive dates are a mixin every non-ledger table is born with, not a retrofit issue; archiving is built once against it (#11 rescoped). The opening balance becomes a real ledger line written with the account, and summing valuations as if they were lines is deleted. Payees and the protected Me move into Foundation as a minimal table (the payee behaviour in #27 is unchanged). First-run defaults come from one idempotent seed step at start, never from inserts in migrations. Schema: migration on `account` and `category` (archived_on, created_on on category, partial unique indexes); new `payee` table; FK on the transaction header.

- 2026-09-17 — The on-budget floor stops clamping: going below your floor shows as negative on-budget money instead of being held at zero beside a separate "tracked debt" figure, and spending that passes the floor stays fully categorisable instead of being refused. Mechanism: `budget_cents` on an account line is the line's own cents when its account was on-budget at write time and 0 otherwise — a pure function of the line, so there is no write-order dependence and the integrity check's settings-drift finding now fires only on a real budget-side change. **Deletes:** the `max()` in the on-budget-money formula, `tracked_debt_cents`, the second budget-cents formula on the opening adjustment, `payments_reduce_tracked_first` (#32 — with no clamped slice there is nothing to eat first), and the floor as a second budget boundary. Schema: nothing; existing `budget_cents` are brought forward by the integrity page's per-row re-save. User guide: the transaction and account bullets lose the refusal case.
- 2026-09-17 — A wallet cannot dispense more than it holds and a card at its limit is declined, so a balance past `credit_limit_cents` now warns — on the save that caused it, and as a standing note on the account page while the balance at the picker date is past it. Mechanism: the existing terms field gets its v1 consumer; minimum balance is `−credit_limit_cents`, null stays silent, 0 means no credit, and the account form pre-fills 0 for the cash-side types. Warns and never blocks, through the advisory-notes list that already carries the predates-a-check note. The floor may not be set below `−credit_limit_cents` — a settings-surface block. **Deletes:** nothing; it is the principled replacement for the accidental tripwire the clamp used to provide. Schema: nothing. User guide: a bullet under Accounts.

- 2026-09-17 — The backend test suite stops running against the app's own database and gets the populated-database migration harness #15 was supposed to leave behind. Today `test_upgrade_head_is_a_noop_against_a_populated_database` runs `alembic upgrade head` against a database already at head, which is a no-op by definition and proves nothing; `test_startup_check` renames `alembic_version` out of the way and `test_migrations` commits real rows, both relying on a `finally` to undo it — and a database left without `alembic_version` makes the next boot report "fresh database" and replay every migration over populated data. Mechanism: a throwaway database the suite creates and drops, a `conftest.py` guard that aborts if the resolved test URL is the app's, and a harness parametrised over revisions that takes a database to each revision's `down_revision`, loads that revision's raw-SQL fixture, upgrades, and asserts the data survived. **Deletes:** the head-to-head no-op test, and the pretence that `downgrade()` is a supported path — recovery is the pre-migrate `pg_dump`, stated as such in `CLAUDE.md`. Conventions land in `CLAUDE.md`; the Done-note schema gate now names the revision and its fixture. Schema: nothing. User guide: no user-facing change.

- 2026-09-21 — Ready to assign still counts overspent categories, and now admits it: the headline reads "Ready to assign $1,000.00 (includes −$500.00 in overspent categories)" instead of leaving the user to wonder why the number went *up* when they overspent. Mechanism: the one ready-to-assign helper is untouched — still the plain difference, still no second `max()` — and a second read-only helper sums the negative category balances at the picker date, for display only. **Deletes:** the open question in *Still to figure out*, and with it the YNAB-style exclusion, which would have put a `max()` back into the formula the 2026-09-17 decision took one out of. Schema: nothing. User guide: a bullet explaining the parenthetical.
- 2026-09-21 — A column ships in the revision of the issue that gives it a surface, so nobody inherits a table of fields that do nothing. A field earns its place by being written or read back through a surface a person uses — a form control and its display count; an API field with no client and no rule behind it does not. **Deletes:** `goal.income_stream_id` from #20 (it arrives with #21, where `income_stream` exists for the FK to point at, instead of shipping as a bare nullable integer). Exceptions, both narrow: the shared `NonLedger` mixin is born with every non-ledger table (2026-09-14), and the debt terms block — `annual_rate`, `compounding_rule`, `statement_close_day`, `grace_days`, `term_end`, `amortization_end` — is grandfathered under a `watch` issue (#96): it is API-only today, and if #31 does not give it a form in EPIC 5 it is deleted rather than kept for later. `credit_limit_cents` is already wired. Schema: nothing built changes. Convention lands in `CLAUDE.md`. User guide: no user-facing change.
- 2026-09-21 — EPIC 2 contains only what EPIC 2 can build. Binding a goal to a named pay (#21) needs `income_stream`, so it moves to EPIC 3 behind #23; the page-and-nav naming pass (#34) comes *before* the category page it names, so it moves to EPIC 2 as its first item. **Deletes:** nothing; no issue is closed or rescoped beyond #20's schema line. Schema: nothing. User guide: no user-facing change.
- 2026-09-21 — Every page gets the name it will keep, and the menu groups them by what you are doing rather than by what the data is: **Record** (Pay, Quick add, Ledger, Balance checks), **Assign** (Categories, Accounts), **Plan** (Outlook, Pay history), **Review** (Spending, Emergency fund, Goals, Growth, Net worth, Debt, Unusual spending), with Settings and Data check below. Group names render as section headers, so the menu teaches the three tempos. Mechanism: a name table in *UI conventions*; a new surface is named against it when its issue is filed, and page names stop being provisional. "Home" is reserved as a name only — no page, a decision parked last in EPIC 6 (#98) rather than a build, and a written limit that it may link into the groups and never become a fifth place to do the work. **Deletes:** "dashboard", named once and never defined; "quick mode", renamed *Quick add* because it is a page and not a mode; and one of the two spending reports — *spending by domain* and *spending by need level* read the same outflow lines and become one **Spending** page with a grouping control. Schema: nothing. User guide: no user-facing change yet; the names land in the guide as each page is built.
- 2026-09-21 — EPIC 2 is complete, and the sections it built now read the way the app behaves. In plain words: covering an overspend takes only what that transaction is short by and skips a pool archived that day; a gain on a linked account splits over positive balances only, each share rounding toward zero with the leftover cents to the largest; a deposit may fund less than the transfer and never more; the Investment-timing note is five years, not “a few”; and removing a goal archives it, with its next due date and per-period amount read at display time rather than stored. Mechanism: no code changes — these are the choices made in #16–#22 and reviewed on their pull requests, written into Pools, Goals, Linked categories, Need levels and the seed bullet so the next seat reads them here instead of in a merged diff. First-run defaults are identified by `seeded_key`, per-row provenance on the non-ledger mixin, never by name. The goal row, the pool pill and the drift note are named as the category’s and the account’s rows on their list pages, which is what the settled name table already meant. **Deletes:** the implied category and account detail pages, which were never named and are not built; and the free pass on `category_line.need_level` — stored since EPIC 1 with no control and no reader, it is now watched by #106 and gets a control in EPIC 6 or is deleted, on the same terms as the debt terms block. Schema: nothing. User guide: no change — the bullets written with #16–#22 already say all of it.
- 2026-09-21 — A named pay states one anchor payday, the pay screen is three issues rather than one, and the menu arrives before the first page that needs a route. In plain words: you tell the app the next payday you know about and it counts forward from there; the Pay screen is built as a screen that records, then the goal-driven pre-fills, then Short by; and "record now" appears on the goal's row and on Pay, not on a new page. Mechanism: the anchor rolls forward by the cadence at read time, the way a recurring bill's due date already does — recording a pay never advances it, so the backend still never learns a paycheque happened. The Commitment goal’s percentage-of-net flavour and its pay binding are one control on one form and ship together in #21. `transaction.income_stream_id` ships with the pay screen that sets it, not with #23 — a column ships with its surface (2026-09-21). **Deletes:** the implied "what's due" page, which was never named and would have been a second place to record; and #24 as an eleven-block single issue. Schema: additive — the anchor date and the deductions list on `income_stream` (#23), the pay binding and the percentage amount on `goal` (#21), `transaction.income_stream_id` (the pay screen). User guide: the Pay screen section fills in as each issue lands.
- 2026-09-22 — Archiving a category no longer hides its money: whatever it holds, or whatever it is short, moves to Ready to assign on the archive date, and the save says how much. Mechanism: one earmark line with a new source, *archive sweep*, dated on `archived_on` and exempt from the rule that an archive date must follow every row pointing at the entity; each child archived with its parent is swept on its own. It is an ordinary move written once — unarchiving leaves it, and money goes back by hand. Accounts keep the warning, because emptying one would take a transaction the app does not write on its own. **Deletes:** the non-zero-balance warning for categories. Schema: additive — one new earmark source value. User guide: the archiving bullet under Categories.
- 2026-09-22 — Payees and Domains, already built with no nav slot, get one each: both land in **Assign**, beside Categories and Accounts, as standalone pages reached from the menu — not folded into pickers-only, so they're easily reachable for dogfooding, and not put under Settings, which would misfile them as config and mean moving them later if either grows a money view (spend per payee, spend per domain) the way Accounts already has one. Mechanism: two new rows in the UI conventions page-name table; no new page-placement rule beyond the existing Accounts exception, which the reasoning now explicitly covers. Unblocks #97. **Deletes:** nothing. Schema: none. User guide: no change yet — the two pages get their bullets when #97 ships the menu.
- 2026-09-22 — A bonus, a tax refund or one gig payment is planned by recording it dated the day you expect it, with no named pay; named pays are only for income that repeats. Mechanism: nothing new — a future-dated income transaction with no link is already the plan, and is edited when the money lands. A named pay exists so goals can bind to it, and nothing binds to a pay that comes once, so every named pay has a repeating cadence and "due by next payday" (#21) never needs a no-next-payday case. The cadence list shared by streams and goals stays as it is: a "once" value would have given goals a second way to say a Target with a date, and giving it to streams alone would have split the one list in two. Pay history shows named pays only, so a one-off never appears there. **Deletes:** "one-off" as a kind of named pay, in Income streams and in the Vision. Schema: nothing. User guide: no change — recording a future-dated income with no named pay already works; the Pay screen section, when written, says named pays are for income that repeats. Answers #115.
- 2026-09-22 — A bonus or refund can be split on the Pay screen like a paycheque: Pay offers *One-off income* beside the named pays. Mechanism: the same screen writing the same transaction and batch with no named-pay link — nothing starts pre-filled, the header shows the date alone, the goal blocks are hidden because nothing binds to a one-off, and the *Everything else* hint reads last calendar month's actual since there is no pay period. The quick path is unchanged: a positive transaction in the Ledger, assigned by hand. **Deletes:** nothing — it adds an entry point to an existing screen, not a mechanism. Schema: nothing; the link on the transaction is already optional. User guide: a bullet in the Pay screen section when it ships.
- 2026-09-23 — Reopening the one-off Pay screen on a date you've already recorded a one-off for no longer offers to catch the duplicate, offer "Set actual," or offer "Delete this pay." All three only work for a named pay, whose `income_stream_id` and anchor payday let the screen find the transaction it wrote before; a one-off has neither. Mechanism: none added. The broken duplicate-guard/delete code at that entry point is removed rather than patched with a heuristic match or a new marker field — a marker would be a second identity mechanism for something Income streams already keeps deliberately identity-less. A recorded one-off is corrected the same way as any transaction: edit it in the Ledger. **Deletes:** the false parity claim that Set actual, the duplicate guard and Delete this pay "work as it does for a named pay" on the one-off entry point. Schema: nothing. User guide: the Pay screen bullet, when written, says a one-off is corrected in the Ledger, not reopened on Pay. Answers #122.
- 2026-09-24 — When the real paycheque lands, you re-open the pay you recorded ahead of time, correct it to the stub — gross, deductions or just the net — and place the difference, on the same screen and in the same transaction; no second transaction is written. Mechanism: a pay's earmark batch is saved whole by one call that replaces every pay-batch line for a transaction in one database transaction, and Record, re-opening and Delete this pay (saving it empty) all use it, so a failure never leaves half a batch. The re-opened screen fills its rows from the recorded batch, one per category, in the block the category belongs to today — goals are context only, since "due by next payday" already counts this pay's money — and *One-off this period* comes back empty because nothing distinguishes its lines. The income → deductions and income → ready to assign lines are recomputed from block 3 on every save and never shown as rows. The backend still never learns a paycheque happened: it only replaces the lines pointing at a transaction. **Deletes:** Set actual (never built — correcting block 3 does its job and also covers deductions); writing pay-batch lines one at a time through the general move path; the separate delete-batch call. Schema: nothing — one endpoint, no column. User guide: the Pay screen section gains "re-open a recorded pay to correct it to your stub and place the difference". Answers #125; supersedes #25.

## Still to figure out

- Registered-account rules the app could know about (TFSA/RRSP/FHSA contribution room) — a field on the terms block for a report, or nothing.
- Whether a split member who is also a user of the app (multi-user mode) should see the mirrored transaction.
