# Using the app — point-form guide

One bullet per thing you can do, in the order you'd meet it. Kept current as the app is built: every closed issue that changes what a user can do adds or edits a bullet here. Long-form pages grow out of this file when there is enough to say.

## Getting started

- Run `docker compose up --build` and open http://localhost:5173.
- Pick a date with the "Show as of" control in the header to see every balance as it stood that day — it also becomes the default date on the account form until you change it again.

## Accounts

- Add an account: give it a name, a type (Cash, Chequing, Savings, Credit card, Line of credit, Mortgage, Payment plan, Loan, Investment, or Asset), whether it's on-budget or tracking, an on-budget floor (for overdraft or budgeting with credit), and an opening balance dated whenever you like. It shows up right away in the account list with its type, side, and balance.
- Edit an account: click it in the account list to change its name, type, on-budget/tracking side, or floor, and save. Only transactions recorded after the change use the new setting — nothing already recorded is touched. Renaming to a name already in use is refused.

## Categories and goals

## Recording money

- Record a transaction: give it a date and a memo, then list which accounts it touched (signed amounts) and which categories it was for (signed amounts). Category lines can be left off entirely — the money just arrives unassigned. The app only refuses to save when the category lines don't add up to what the account lines moved on-budget; everything else is recorded as entered. Add a category by name from the same screen.
- Pick a payee for a transaction — who it went to or came from — by searching for it in a searchable list, or leave it blank if you don't know. If the payee doesn't exist yet, add it by name right from the same box.
- Fix a mistake: click any transaction in the list to open it in the same form, change anything, and save — every balance shown for every date reflects the correction right away. Delete it from the same form if it shouldn't exist at all (you'll be asked to confirm). The one line you can't delete this way is an account's opening-balance adjustment; that's fixed with a balance check or backfill instead.

## Pay screen

## Splits

## Balance checks

## Reports
