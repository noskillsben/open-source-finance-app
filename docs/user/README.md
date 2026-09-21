# Using the app — point-form guide

One bullet per thing you can do, in the order you'd meet it. Kept current as the app is built: every closed issue that changes what a user can do adds or edits a bullet here. Long-form pages grow out of this file when there is enough to say.

## Getting started

- Run `docker compose up --build` and open http://localhost:5173.
- Pick a date with the "Show as of" control in the header to see every balance as it stood that day — it also becomes the default date on every form (accounts and transactions), and the category and payee lists only show what existed that day, until you change it again.
- The payee "Me" already exists the first time you open the app — no need to add it before recording a transfer between your own accounts.
- A starter set of categories (Groceries, Dining out, Rent, Utilities, Transit, Health care, Clothing, Entertainment, Debt payments) and domains (Food, Housing, Transportation, Health, Lifestyle, Financial) is there the first time you open the app. Rename or archive any of them; they won't come back. If you already made a category or domain with one of those names, yours is kept and the starter one is skipped.

## Accounts

- Add an account: give it a name, a type (Cash, Chequing, Savings, Credit card, Line of credit, Mortgage, Payment plan, Loan, Investment, or Asset), whether it's on-budget or tracking, an on-budget floor (for overdraft or budgeting with credit), a credit limit, and an opening balance dated whenever you like. It shows up right away in the account list with its type, side, and balance. An on-budget account that's below its floor shows *below your floor by $X.XX* under its name.
- Edit an account: click it in the account list to change its name, type, on-budget/tracking side, or floor, and save. Only transactions recorded after the change use the new setting — nothing already recorded is touched. Renaming to a name already in use is refused. If the account has a stated credit limit, the floor can't be set below it — you can't budget with credit the lender hasn't extended.
- Credit limit: on the account form, state the limit your lender set. Cash, Chequing and Savings start at 0 (no credit); the credit and loan types start blank, meaning unknown — blank and 0 are different answers, and blank says nothing. A balance past the limit warns rather than blocks: on the transaction that caused it, and as a standing note under the account's name in the account list. A floor set below a stated limit is refused.
- Archive an account: click "Archive" on its row, confirm the date (it starts as the "Show as of" date), and save. Any warning — for example a balance that isn't zero on that date — is shown, but the account is archived regardless. It can't be archived on or before the date of a transaction that uses it. Tick "Show archived" above the list to see archived accounts and "Unarchive" one; that's refused if another account now has the same name.

## Categories and goals

- Add a category: give it a name and, if you like, the category it sits under, a domain, a default need level (need, should, nice to have or want) and a pool — the category it draws on when it overspends. Every category can be posted to, whether or not it has sub-categories underneath. Click "Edit" on a row to change any of these, including its name. A category can't be its own pool, directly or through a chain of pools, and can't sit under itself or one of its own sub-categories. A name already in use is refused, ignoring capital letters.
- Domains are a label for grouping categories in reports (Food might hold Groceries and Dining out). Add, rename or archive them in the Domains list under the categories; archived domains free up their name, and "Show archived" brings them back to unarchive.
- See your categories in the Categories list, with sub-categories indented under their parent, and each one's domain and need level beside it. Click "Archive" on a row to archive it as of the "Show as of" date; any warning is shown, but the category is archived regardless. Tick "Show archived" to see archived categories and "Unarchive" one; that's refused if another category now has the same name.
- Assign money to a category: the Categories page opens with "Ready to assign $X" — all the money in your on-budget accounts that no category holds yet, as of the "Show as of" date. Type an amount in a category's Move money box and press Add; that amount moves from ready to assign into the category, dated the "Show as of" date, and the category's Available column and the headline both update. Press Withdraw to move the amount back out of the category into ready to assign. To move money from one category into another, press "Move to another category", pick the other category from the searchable list, type the amount and press Move; ready to assign doesn't change. Moves never block: a category can go negative. Spending on a category that has money assigned leaves ready to assign alone. If a category has spent more than it holds, its Available shows negative and the headline adds "(includes -$X in overspent categories)": that money is still counted in ready to assign until you cover the overspend. An archived category can't be moved into or out of.
- Overspend from a pool: when a category has a pool and you record spending that is more than the category holds, the shortfall is covered from the pool automatically, then from the pool's own pool, and so on up the chain, and only what none of them can cover leaves the category negative. A pool never goes negative because of this. The transaction shows a note such as "Snacks: covered $40.00 from Food, then $20.00 from Household.", ready to assign doesn't change, and editing or deleting the transaction redoes or removes that cover. Changing a category's pool later doesn't touch cover already given. A category with a pool shows "+$X available if overspent" under its Available amount: what the pool chain could cover right now.

## Payees

- See your payees in the Payees list. Click "Archive" on a row to archive it as of the "Show as of" date (the payee "Me" can't be archived). Tick "Show archived" to see archived payees and "Unarchive" one; that's refused if another payee now has the same name.

## Recording money

- Record a transaction: give it a date and a memo, then list which accounts it touched (signed amounts) and which categories it was for (signed amounts). Category lines can be left off entirely — the money just arrives unassigned. The app only refuses to save when the category lines don't add up to what the account lines moved on-budget; everything else is recorded as entered, including spending that takes an account below its on-budget floor. Add a category by name from the same screen.
- Recording a transaction dated on or after an archived category, payee, or account's archive date doesn't block the save: it adds a note naming what was archived and when, and the record stands as entered. Nothing is unarchived for you.
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
