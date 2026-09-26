# History replay

A development tool (DESIGN.md § Working on the app → *History replay*). It plays a recorded money history into a **fresh** database through the same HTTP calls the screens make, then asks the running app whether it agrees with the source. It is not a feature, not an import, and nothing in the app imports it.

- **Public API only.** No SQL, no endpoint of its own. If a scenario can't be expressed through the screens' calls, that is a finding about the app.
- **The check is what the app reports.** The tool never recomputes a balance; it compares the app's balance checks, final balances and integrity check with what the scenario says.
- **Personal data is never committed.** `sample.json` is fictional. Real scenarios, converters and exports go in `frontend/replay/private/`, which is gitignored.

## Run it

Start the stack against an empty database, then in the browser console on http://localhost:5173:

```js
const sim = await import('/replay/replay.js')
await sim.setup({ scenario: '/replay/sample.json' })  // accounts, payees, categories, named pays, goals
await sim.run({ until: '2026-08-31' })                // events up to a date (inclusive), or…
await sim.run({ stopBefore: ['pay'] })                // …stop before the next pay and do it on its screen
sim.skip()                                            // mark the event you just did by hand as done
await sim.run()                                       // carry on to the end
await sim.report()                                    // balances vs the source, integrity check
```

A private scenario is the same with its own URL: `/replay/private/scenario.json`.

- `setup()` refuses a database that already has transactions (`{ force: true }` overrides). It creates only what is missing, by name; a seeded default with the same name (Groceries, Rent…) is updated, not duplicated.
- `run()` takes `until` (a date), `stopBefore` (a list of event kinds), `max` (a count) and `quiet`. It stops on the first error and leaves progress where it was.
- Progress is the number of events done plus the scenario URL, kept in `localStorage`, so a run resumes after a page reload. `reset()` sets it back to zero; it does not empty the database.
- `report()` passes when `allMatch` is true, `integrityFindings` is 0 and `errors` is empty. It also returns Ready to assign and the overspent total at the scenario's `as_of` date, for a person to read. Balance-check mismatches are collected while `run()` goes, so a page reload between `run()` and `report()` forgets them.

## Scenario format

One JSON file: `name`, `start`, `as_of`, `setup`, `events`, `expected_final_balances`. Dates are `YYYY-MM-DD`, money is integer cents (dollars appear nowhere), and every entity is referred to **by name**, matched case-insensitively.

- `start`: the picker date setup runs on; it becomes `created_on` of everything setup creates that has no date of its own.
- `as_of`: the date `report()` reads balances at.

### `setup`

All lists are optional and are created in the order written, so a pool or parent comes before the categories that name it.

| Key | Entries |
|---|---|
| `domains` | names |
| `payees` | names |
| `accounts` | `name`, `type`, `on_budget`, `opening_cents`, and optionally `created_on`, `floor_cents`, `credit_limit_cents` |
| `categories` | `name`, and optionally `parent`, `pool`, `domain`, `need_level` |
| `income_streams` (named pays) | `name`, `payee`, `cadence`, `cadence_weeks`, `anchor_payday`, `expected_gross_cents`, `expected_net_low_cents`, `expected_net_high_cents`, `income_category`, `destination_account`, `deductions: [{ category, amount_cents }]` |
| `goals` | `category`, `name`, `kind`, and the fields that kind needs (`amount_cents`, `cadence`, `cadence_weeks`, `target_date`, `level_cents`), optionally `income_stream` to bind it to a named pay |
| `archive_seed_categories`, `archive_seed_domains` | names of seeded defaults to archive on `start` |

### `events`

A list, in the order they were entered. Every event has `kind` and `date`. Progress counts events by position, so don't reorder a file mid-run.

- **`transaction`**: `payee`, `memo`, `account_lines: [{ account, cents }]`, `category_lines: [{ category, cents }]`. Signed cents; direction is the sign. Category lines must sum to the budget movement, as on the Ledger form. Optional `bill: { category, due_on }` links it to a recurring bill and one of its due dates, as "record now" does.
- **`move`**: `from`, `to` (a category name, or `null` for Ready to assign), `cents` (positive).
- **`pay`**: recorded the way the Pay screen does, one transaction then the whole batch. `income_stream`, `payee`, `account`, `income_category`, `gross_cents`, `net_cents`, `deductions: [{ category, amount_cents }]` (`gross_cents` minus the deductions must equal `net_cents`), and `distribution: [{ category, cents }]`, where a negative amount is a cover. Add `"one_off": true` (and drop `income_stream`) for a pay with no named pay. What is left over stays in Ready to assign, and is printed.
- **`reopen_pay`**: re-opens the earlier `pay` event for `income_stream` on `payday` and corrects it to the stub, on the Pay screen's same two calls: `gross_cents` and `deductions`. The account, income category and `distribution` carry over unless the event gives its own `distribution`.
- **`balance_check`**: `account`, `stated_cents`, and `expected_diff_cents`, the difference the source found. If the app finds another, `run()` prints `MISMATCH` and `report()` fails.

### `expected_final_balances`

`{ "Account name": cents }`: what each account's balance should be at `as_of`, taken from the source.

## The sample

`sample.json` is a fictional five weeks: a chequing account, a credit card and a tracking (off-budget) brokerage account. It covers a named pay recorded, then re-opened and corrected to the stub; a phone bill paid through its link; a grocery shop that draws on a pool; a transfer that crosses the budget boundary; a card payment; and a balance check that finds a $12.50 difference. On a fresh database `report()` shows every balance matching and no integrity findings.
