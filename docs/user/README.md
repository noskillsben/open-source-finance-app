# Using the app — point-form guide

One bullet per thing you can do, in the order you'd meet it. Kept current as the app is built: every closed issue that changes what a user can do adds or edits a bullet here. Long-form pages grow out of this file when there is enough to say.

## Getting started

- Run `docker compose up --build` and open http://localhost:5173.
- Pick a date with the "Show as of" control in the header to see every balance as it stood that day — it also becomes the default date on the account form until you change it again.
- The payee "Me" already exists the first time you open the app — no need to add it before recording a transfer between your own accounts.

## Accounts

- Add an account: give it a name, a type (Cash, Chequing, Savings, Credit card, Line of credit, Mortgage, Payment plan, Loan, Investment, or Asset), whether it's on-budget or tracking, an on-budget floor (for overdraft or budgeting with credit), and an opening balance dated whenever you like. It shows up right away in the account list with its type, side, and balance. An on-budget account that's below its floor shows *below your floor by $X.XX* under its name.
- Edit an account: click it in the account list to change its name, type, on-budget/tracking side, or floor, and save. Only transactions recorded after the change use the new setting — nothing already recorded is touched. Renaming to a name already in use is refused. If the account has a stated credit limit, the floor can't be set below it — you can't budget with credit the lender hasn't extended.
- Credit limit: state one on the account form (0 for a wallet or chequing account with no overdraft, a dollar amount for a card, line of credit or loan; leave it blank if you don't know it). A balance that goes past it — a wallet spending more than it holds, a card past its limit — gets a warning, never a block: on the transaction that caused it, and standing on the account page for as long as the balance stays past it, even if a later edit or backfill is what pushed it there.

## Categories and goals

## Recording money

- Record a transaction: give it a date and a memo, then list which accounts it touched (signed amounts) and which categories it was for (signed amounts). Category lines can be left off entirely — the money just arrives unassigned. The app only refuses to save when the category lines don't add up to what the account lines moved on-budget; everything else is recorded as entered, including spending that takes an account below its on-budget floor. Add a category by name from the same screen.
- Pick a payee for a transaction — who it went to or came from — by searching for it in a searchable list, or leave it blank if you don't know. If the payee doesn't exist yet, add it by name right from the same box.
- Fix a mistake: click any transaction in the list to open it in the same form, change anything, and save — every balance shown for every date reflects the correction right away. Delete it from the same form if it shouldn't exist at all (you'll be asked to confirm). The one line you can't delete this way is an account's opening-balance adjustment; that's fixed with a balance check or backfill instead.

## Pay screen

## Splits

## Balance checks

- Check balance (money accounts) or update value (assets and investments): from the account list, click "Check balance" / "Update value", type the real balance and a date, and optionally pick a category for the difference — otherwise it lands in ready to assign. If it already matches the ledger, nothing is recorded. Nothing ever locks: the account shows "balance checked <date>" (or "value updated <date>"), and if you later save a transaction dated on or before that check, the badge picks up an "N entries added since" count.
- Typed a check wrong? Click "Undo check" next to "balance checked <date>" to remove it and any adjustment it made — the account's balance goes back to what it was before, and you check again when you're ready. An account's opening balance can't be undone this way; fix it with a backfilled transaction instead.

## Integrity check

- Open the integrity check page any time to see any transaction whose category lines don't add up, or whose on-budget amount would come out differently if it were saved again under an account's current on-budget/tracking side. Nothing runs in the background and nothing is dev-only — it's a page like any other. Fix one row at a time with its "Re-save" button, which writes the transaction again through the normal save path; there's no "fix everything" button on purpose.

## Reports
