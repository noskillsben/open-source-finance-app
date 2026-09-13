> Research carried over from the previous app (2026-09-02). Its recommendations assume a three-tier need scale; this app has four (need / should / nice to have / want).

# Research Report: Designing a Savings Engine for bens_finance_app

## TL;DR
- **Part A (what to compute):** Adopt a tiered emergency-fund model driven by the app's existing need/nice-to-have/want spending tiers (cushion = N months of "needs," with "needs + nice-to-have" as a comfort variant), plus a retirement engine built on three interchangeable rules (10–15% savings rate, age-based salary multiples, and a 25×/4% target from desired income) using a user-adjustable real return (~3–5% real / 4–7% nominal), and a goal-sequencing "waterfall" (emergency starter → capture employer match → high-interest debt → full cushion → long-term goals).
- **Part B (how peers do it):** The dominant industry pattern — proven by YNAB and Actual Budget — is a hard structural split: **contributions** are on-budget→off-budget transfers that consume a budget category, while **market growth** is an uncategorized balance-adjustment/reconciliation transaction that touches only the account balance and net worth, never the budget. No mainstream budgeting app automatically splits a goal into "saved vs earned," and only forecasting-first tools (PocketSmith, Quicken Lifetime Planner, Empower) do genuine long-term projection.
- **Recommendation:** Model goals against **budget-category contributions** (not live account balance) by default, record investment gain/loss as an **off-budget adjustment** (not an income/expense category), derive the cushion goal from spending tiers automatically, and pair the debt engine and savings engine through a shared lump-sum allocator that ranks by after-tax guaranteed return vs expected market return.

---

## Key Findings

1. **Emergency-fund sizing has a settled formula and a settled expense definition.** The industry-standard calculation is `Fund = Essential Monthly Expenses × Months of Coverage`, months set by risk (3 stable dual-income → 6 single/variable → 9–12 self-employed). The expense base is consistently **essential (needs) only** — housing, utilities, groceries, insurance, transportation, minimum debt payments — explicitly **excluding** discretionary spending. This maps directly onto the app's need/nice-to-have/want tiers and can be auto-derived, which almost no competitor does.
2. **Retirement rules of thumb are well-defined but assumption-laden.** Save 10–15% of gross; Fidelity's age multiples (1× by 30 … 10× by 67); the 25×/4% nest-egg target; 70–80% replacement rate. Capture the full employer match first (guaranteed ~50–100% return). Project with future-value-of-annuity math at ~4–7% nominal / ~3–5% real. The 4% rule and salary multiples are genuinely contested and must be flagged, not presented as guarantees.
3. **Debt-vs-savings is an after-tax-guaranteed-vs-expected-return comparison** with a threshold band (>~7–10% pay debt, <~5% invest, 5–8% split). This is exactly the logic the app's planned lump-sum allocator should encode.
4. **YNAB and Actual Budget both structurally separate contributions from growth** — the single most important precedent for this ADR. Contributions consume a category; growth is an uncategorized off-budget adjustment.
5. **Two clear white-space opportunities:** (a) an automatic "months of expenses covered" cushion metric (no peer computes it natively), and (b) an integrated lump-sum optimizer that splits a windfall across debt payoff and investment contributions.

---

## PART A — Personal-finance planning rules for savings

### 1. Emergency fund / cushion sizing

**The standard rule** is 3–6 months of expenses, with the near-universal calculation `Emergency Fund = Essential Monthly Expenses × Months of Coverage`. Months are risk-adjusted:
- **3 months:** stable dual income, strong job security, low debt.
- **6 months:** single income, variable/commission income, dependents.
- **9–12 months:** self-employed, volatile industry, sole homeowner.

The Consumer Financial Protection Bureau attaches no dollar figure and declines to prescribe a fixed number, advising instead: "The amount you need to have in an emergency savings fund depends on your situation. Think about the most common kind of unexpected expenses you've had in the past and how much they cost." One empirical anchor for a *minimum* buffer: researchers at the Federal Reserve Bank of St. Louis and Universidad Diego Portales identified roughly **$2,467** as the point beyond which each additional dollar of emergency savings stops significantly lowering low-income households' risk of financial hardship — useful as a floor for a "starter cushion."

**How "expenses" is defined — the key design point.** The consensus is that the cushion covers **essential expenses (needs) only**, not full lifestyle spending. Include housing, utilities, groceries, insurance, transportation, and minimum debt payments; **exclude** discretionary items (subscriptions, dining out, gym, entertainment, vacations) because they are paused in a real emergency. As one calculator puts it: "An emergency fund covers needs, not wants… Only count rent, utilities, groceries, insurance, and required debt minimums." Calculating from expenses (not income) matters: a household earning $120,000 with $6,000/month in essential spending needs $18,000–$36,000, not a figure scaled to income.

**Mapping onto the app's need / nice-to-have / want tiers:**
- **Primary cushion target = N months of "needs"** (essential-only), N defaulting to 3 for low-risk profiles and 6 for higher-risk ones.
- **Comfort/enhanced cushion = N months of "needs + nice-to-have"** — a defensible richer target since some "nice-to-have" spending is sticky. This gives the user a low/high band.
- **"Wants" excluded by default;** including full spending overstates the target and runs against consensus practice.
- Because the app already computes a rolling 3-month median/average by tier, the cushion target can be **derived automatically** rather than hand-entered — a genuine differentiator.

**Rebuilding after a draw.** Advice is consistent: the fund is meant to be tapped and replenished; after a draw, resume contributions until fully rebuilt, treating the rebuild as a priority "bill." The fund should also be periodically revised upward with inflation and life changes (e.g., a new child).

**Where to hold it (liquidity vs yield, generic terms).** Keep it liquid and low-risk — a high-yield savings or money-market vehicle, separate from everyday spending, and explicitly **not in equities**. The framing is "insurance against having to sell investments at the worst time," not an investment. Beyond ~12 months of cushion, additional cash is generally better invested for growth (an opportunity-cost ceiling).

### 2. Retirement savings

**Rules of thumb the engine should support (offer several; they cross-check each other):**

- **Savings rate:** Save 10–15% of gross income. Fidelity's published guidance ("Retirement guidelines") states: "we suggest aiming to save at least 15% of your pre-tax income (including any employer match) a year over the course of your working life."
- **Age-based salary multiples (Fidelity):** "save 1x your current income by age 30, 3x by 40, 6x by 50, 8x by 60, and 10x by age 67." Fidelity explicitly derives these assuming "a 15% savings rate, a 1.5% constant real wage growth, a retirement age of 67 and a planning age through 93," targeting 45% of pre-retirement income replaced from savings (the rest from Social Security/other). Treat as a "gut check," not a verdict.
- **Replacement-rate approach:** Target 70–80% of pre-retirement income (Fidelity's own savings-sourced target is ~45%; other tools use 50% at 65 / 40% at 70).
- **The 4% rule / Rule of 25 (turning income into a nest-egg target):** Nest egg = desired annual income from savings ÷ withdrawal rate. At 4%, income × 25; at 3.5%, income × ~28.6. Credited to William Bengen (1994), based on a 30-year horizon simulated on US historical returns.

**Employer match:** Generic rule — "capture the full match first." It is a guaranteed ~50–100% instant return that beats every other step, including high-interest debt payoff. Model a match as a first-priority, capped contribution.

**The projection math (future value of an annuity).** For level periodic contributions plus a starting balance:
`FV = PV·(1+r)^n + PMT·[((1+r)^n − 1) / r]`
where r is the per-period return, n the number of periods, PMT the periodic contribution. Worked industry examples: $500/month at 6% for 30 years ≈ $500,000; over long horizons, contributions are often only ~30% of the final balance, the rest being compounding.

**Assumed return rates commonly used in planning tools.** Nominal ~4–7% is standard; some use higher long-run equity averages (~10% nominal for 100% stock). Fidelity's benchmark work assumes ~5.5% average annual return after fees. Inflation is commonly assumed ~3–3.5% (the EBSA Lifetime Income Illustration guidance uses 7% return / 3% inflation). This implies **real returns of ~3–5%**. The engine should let the user choose nominal-vs-real and set the rate; defaulting to a real return (~3–4%) keeps outputs in today's dollars and is more honest.

**What is contested or oversimplified (flag in-app):**
- The 4% rule was derived from US-only 20th-century data. In Wade Pfau's "An International Perspective on Safe Withdrawal Rates: The Demise of the 4% Rule?" (Journal of Financial Planning, Dec 2010), the 4% rate was safe in only 4 of the developed-country markets studied; and in April 2020 (ThinkAdvisor, "Wade Pfau: Pandemic Tears Up 4% Rule") he estimated a ~2.4% safe rate. Morningstar's forward-looking research has published starting safe rates slightly below 4%. Do not present 4% as a guarantee.
- Salary multiples embed assumptions (retire at 67, 15% savings, 1.5% real wage growth, planning to age 93) that may not fit the user.
- Single fixed-return projections ignore sequence-of-returns risk; Monte Carlo (as Empower/Quicken use) yields a probability, not a point estimate.

### 3. Big-ticket savings goals

**Home down payment (the main example).** Guidance clusters around saving **25–30% of purchase price** to cover everything: a 20% down payment (to avoid PMI), **closing costs of ~2–5%**, plus 1–5% miscellaneous/moving/reserve. Important counterpoint: the "20% down" norm is increasingly treated as outdated — conventional loans start at 3%, FHA 3.5%, and putting less down to buy sooner/preserve reserves is "financially defensible," with PMI (~0.5–1.5%/yr) cancelling at 20% equity. The engine should let the user pick a down-payment % and auto-add a closing-cost buffer.

**Other goals:** vehicle, wedding, sabbatical — same structure (target amount + date → required monthly contribution), all short-to-medium horizon.

**Time-horizon-based asset choice (critical rule).** Money needed within ~3–5 years should **not** be in equities — "too much volatility risk." Keep short-horizon goal money liquid/low-risk (HYSA, short-term Treasuries). Design rule: **a goal's target date should drive a suggested "cash vs invested" classification**, and the app should warn if an equity-linked tracking account backs a <3–5 year goal.

**Goal sequencing / priority waterfalls.** The major frameworks and where they agree/disagree:

- **r/personalfinance "Prime Directive" flowchart:** (0) budget/essentials → (1) small starter emergency fund (~$1,000 or 1 month) → (2) capture full employer match → (3) pay off high-interest debt → (4) full 3–6 month emergency fund → (5) tax-advantaged retirement (and other goals). Explicitly places match **before** high-interest debt because the match is a risk-free, higher return.
- **Money Guy "Financial Order of Operations" (9 steps):** places the **full** emergency fund later, after deductibles/match/high-interest debt; agrees match beats debt.
- **Dave Ramsey Baby Steps:** (1) $1,000 starter → (2) all non-mortgage debt via **debt snowball** (smallest balance first, ignoring interest rate) → (3) 3–6 months expenses → (4) 15% to retirement → (5) college → (6) pay off mortgage → (7) build wealth/give. Ramsey **disagrees** with the others: it defers retirement (even the match) until consumer debt is cleared, and orders debt by balance not interest rate.
- **"Pay yourself first":** automate savings/investment contributions before discretionary spending — a behavioral rule, not a goal ordering.
- **50/30/20 rule:** 50% needs / 30% wants / 20% savings-and-debt-repayment — a budgeting split, useful as a sanity ceiling on how much can flow to goals.

**Where they disagree (the two live debates):**
1. **Match vs high-interest debt first:** most (r/pf, Money Guy, planners) say capture match first; Ramsey says clear debt first.
2. **Debt ordering:** avalanche (highest interest first — mathematically optimal) vs snowball (smallest balance first — behaviorally motivating). Design implication: support **both** and let the user choose.

### 4. The debt-vs-savings interaction

**The core principle** is to compare the **guaranteed, after-tax return of debt payoff** against the **expected (uncertain) market return**. Paying off an 18–20% credit card is a guaranteed risk-free return equal to that rate; few investments match it.

**The threshold planners use:**
- Above ~7–10% interest → pay down debt first (guaranteed return wins).
- Below ~5% → lean toward investing (long-run market returns historically higher).
- 5–8% middle ground → split, revisit periodically.
- Fidelity adds a nuance: because market returns aren't guaranteed, it builds in a margin of safety — recommending investing over debt payoff only if investing has ≥~70% chance of beating the guaranteed debt return.
- Bogleheads frames the correct comparison precisely: a fixed-rate loan payoff is a guaranteed, zero-risk return, so compare it to a **comparable-duration, credit-risk-free bond yield**, on an after-tax basis (Treasury if the alternative is tax-advantaged; muni if taxable).

**Prerequisites** always cited before either: cover minimum payments and hold at least a small cash buffer so a shock doesn't create new high-interest debt.

**Splitting a lump sum (e.g., a bonus).** The standard treatment applies the waterfall to the windfall: top up the starter cushion if needed → capture any unused match room → throw the rest at highest-interest debt → then split remaining between longer-term goals/investing. This is exactly the behavior the app wants: **a lump-sum allocator that can simultaneously fund a debt-payoff plan and a tracking-investment contribution**, ranked by the after-tax-guaranteed-vs-expected-return logic above.

---

## PART B — How budgeting apps model long-term savings and tracking accounts

### Cross-app comparison

| App | How contributions are recorded | How growth/value change is recorded | Growth counts toward goal? | Cushion / months-of-expenses support | Retirement projection |
|---|---|---|---|---|---|
| **YNAB** | Transfer from on-budget account to off-budget **tracking account**; the on-budget side needs a category (funds leaving the budget) | Reconcile the tracking account → enter true balance → YNAB auto-inserts a **"Reconciliation Balance Adjustment"**; tracking accounts don't affect the budget | No (goals/targets track category funding; growth lives only in net worth) | Via a **Savings Balance target** ("hold X") or **Monthly Savings Builder**; no automatic months-of-expenses computation. "Age of Money" is an adjacent metric | No |
| **Actual Budget** | Transfer on-budget → **off-budget** account; category assigned on the on-budget side only | **"Create reconciliation transaction"** button generates the balance-adjustment; off-budget transactions **"can't be categorized"** | No (off-budget txns can't be categorized; goal templates operate on categories) | Via goal templates (`#template $X`, `up to`, `schedule`, `by … spend from …`); no automatic months-of-expenses | No |
| **Firefly III** | **Piggy banks** tied to an asset account; money moved via transfers linked to the piggy bank | Value change = a transfer/deposit or manual balance edit on the asset account; piggy banks are a partition of an existing account balance | Partially — piggy bank is a slice of an account balance, so balance changes affect available room, but growth isn't auto-attributed | Manual (piggy bank target amount); no automatic months-of-expenses | No |
| **Monarch Money** | Assign an account to a **goal**; set target amount + planned monthly contribution; connected/manual accounts sync | Investment accounts sync holdings and market value; net-worth dashboard updates automatically | Yes — goals can be tied to **account balances**, so market movement moves goal progress | Savings goal with target + timeline; app calculates required monthly amount; no automatic months-of-expenses metric found | Limited (goal planning; one shared retirement goal) — not a full projection engine |
| **Lunch Money** | Manual or synced transactions; assets added as accounts | **End-of-month balance snapshot**; historical balances are editable; asset type determines net-worth sign | No dedicated goal-vs-growth split | Manual asset/account; no automatic months-of-expenses | No |
| **Copilot Money** | Transfers to investment/tracking accounts; investment accounts tracked | Investment accounts sync market value into net worth | Not a category-goal split (net-worth oriented) | Manual | No |
| **Quicken Simplifi** | On-budget spending plan; savings goals as planned set-asides | Investment accounts tracked separately | Goal is a planned-savings construct | Savings goals; no automatic months-of-expenses | **Yes — Retirement Planner**, projects up to 35 years; inputs include retirement age, contributions, return, and annual retirement income; separate pre/post-retirement return rates |
| **PocketSmith** | Budget events applied to account forecasts | Account balances updated; can enter an **interest/return value** on balances to model compounding | Forecast-based, not category-goal-based | Can model via forecast/scenarios; no dedicated months-of-expenses metric | **Yes — daily-resolution forecast up to 60 years** (plan-dependent: 6 months free / 10 yr / 30 yr / 60 yr), with what-if scenarios and compounding on balances |
| **Quicken Classic (Lifetime Planner)** | Uses linked account balances + contributions | Uses projected **average rate of return** (separate taxable vs tax-deferred, pre/post retirement); fixed-rate, not Monte Carlo | Projection-based | Not a budgeting-envelope cushion metric | **Yes — full deterministic Lifetime Planner**; inputs: income, savings/investment balances + return, inflation, living expenses, life events, tax rates, retirement age |
| **Empower (Personal Capital)** | Aggregates linked accounts | Uses actual aggregated holdings; **Monte Carlo (5,000 scenarios)** with forward-looking Morningstar assumptions | Projection-based (net worth + probability of success) | Emergency-fund calculator exists (separate); not an envelope cushion | **Yes — Retirement Planner (Monte Carlo)**; inputs: current portfolio, spending goal, retirement age, Social Security, major life events |
| **Tiller** | Spreadsheet-based; user-defined | User-defined formulas | User-defined | User-defined (fully custom) | User-defined (templates) |
| **Buckets** | Envelope transfers | Manual account balance | Category-based | Manual | No |
| **Mint (defunct 2024)** | Transfers; goals feature (historical) | Synced balances | Goals could link to accounts | "Goals" feature historically | No |

### 1. Contributions vs growth separation (the central finding)

The two most architecturally relevant peers — **YNAB and Actual Budget** — implement the same clean separation, and it is the pattern the ADR should weigh most heavily:

- **Contribution = an on-budget→off-budget transfer that leaves the budget and must carry a category on the on-budget side.** YNAB: "Your contributions to these accounts are considered transfers from your checking account (a budget account) to your investment account (a tracking account), so you'll need a category to categorize transactions where funds leave the budget." Actual: transfers between off-budget and on-budget accounts require you to "assign a category on the On Budget side of the transfer."
- **Growth = an uncategorized balance-adjustment transaction that never touches the budget.** YNAB: you reconcile the tracking account, answer "No" to the balance prompt, enter the true market value, and YNAB inserts an automatic **"Reconciliation Balance Adjustment."** "Tracking accounts do not affect your budget." Actual: the **"Create reconciliation transaction"** button "automatically brings the value of the asset in line with the new valuation," and off-budget "transactions… can't be categorized; they simply track balances over time."

**Does the growth adjustment get categorized to a gain/loss category?** For off-budget/tracking accounts, **no** — in both YNAB and Actual the adjustment is uncategorized because the account is off-budget. (Categorizing a market gain to an income category is what you'd do only if the investment account were on-budget, which neither app recommends for volatile investments.) Firefly III, being double-entry, can route interest/gains through a revenue account if the user models it that way, but that is manual.

**Does any app show "contributed X, market moved Y, total Z"?** **No mainstream budgeting app does this natively.** The closest is the structural separation above — the transfer history shows contributions and the reconciliation adjustments show growth, but the user must eyeball them; there is no built-in "saved vs earned" progress bar. This is a genuine gap and an opportunity for bens_finance_app to differentiate. Users work around it by (a) reconciling monthly and reading the adjustment line, or (b) exporting to a spreadsheet/Tiller.

### 2. Whether growth counts toward a savings goal — and how apps decide

The decision hinges on **what the goal is bound to**:
- **Goal bound to a budget category/envelope (YNAB targets, Actual goal templates):** only **contributions** count. Growth in an off-budget account is invisible to the target. This is the envelope-budgeting-native model.
- **Goal bound to an account balance (Monarch "assign an account to a goal"):** **growth does count**, because progress is read from the live account balance — contributions and market movement together.

This is the single clearest fork for the ADR: **category-linked goals track contributions only; account-linked goals track balance (contributions + growth).**

### 3. Modeling the emergency fund / cushion

- **YNAB:** a **Savings Balance target** ("save this amount over time and maintain the balance by replenishing any money spent — use it for down payment, emergency fund…") or a **Monthly Savings Builder** ("contribute this amount every month… use it for stocking up your emergency fund"). It's a plain amount or monthly amount, **not** a computed months-of-expenses figure.
- **Actual/others:** plain-amount targets.
- **Automatic "months of expenses covered":** essentially **no** mainstream budgeting app computes this automatically. YNAB's **"Age of Money"** is adjacent (how many days old your spent dollars are) but is not a cushion-coverage ratio. **This is white space** — bens_finance_app already has the rolling tiered-spend data to compute "your cushion currently covers X.X months of needs," which no peer does natively.

### 4. Reconciling accounts whose balance changes without transactions

The universal pattern is the **adjustment/reconciliation transaction**:
- YNAB inserts a "Reconciliation Balance Adjustment"; Actual creates a "reconciliation transaction"; Lunch Money takes an **editable end-of-month balance snapshot**.
- **Does the adjustment hit income/expense?** On off-budget accounts, no — it only moves the balance and net worth. This keeps spurious "income" out of the budget when markets rise and spurious "expense" out when they fall. Lunch Money uses account **type** to decide net-worth sign (assets add, liabilities subtract).
- **Net-worth reporting consequence:** off-budget accounts are included in net worth but excluded from budget "available funds." Actual: "Off budget accounts are included in the net worth report" but "don't affect the budget." This cleanly separates "spendable money" from "wealth."

### 5. Retirement / long-term projection inside a finance product

Genuine projection is the domain of **forecasting-first** tools, not envelope budgeters:
- **PocketSmith:** deterministic daily forecast up to 60 years (`Projected Balance = Current Balance + Σ Planned Income − Σ Planned Expenses`), with what-if scenarios and the ability to apply an interest/return rate to balances for compounding. Inputs: recurring budgets, account balances, return rate.
- **Quicken Classic Lifetime Planner:** full deterministic model. Inputs: income/salary, savings & investment balances with **projected return rates (separate taxable vs tax-deferred, pre- vs post-retirement)**, inflation, living expenses, life events, tax rates, retirement age. It uses **fixed rates, not Monte Carlo** (a known limitation users cite).
- **Quicken Simplifi Retirement Planner:** projects up to 35 years; inputs include retirement age, contributions, return, and an annual retirement-income field (offsetting income like Social Security/pension).
- **Empower (Personal Capital) Retirement Planner:** per Empower's disclosed methodology, the planner runs **5,000 Monte Carlo scenarios** using "Morningstar's 'unconditional very-long-term' assumptions," and "still reduce[s] assumed performance by 1% to be conservative and also use[s] a base inflation rate of 3.5% for expenses," plus an assumed ~1% fee, returning a low/medium/high probability of success. Inputs: aggregated portfolio, spending goal, retirement age, Social Security, life events.

Common inputs across all: **contribution rate, assumed return, retirement age, target retirement income/spending, inflation.** These are exactly the fields a bens_finance_app retirement engine would need.

### 6. Debt-payoff planning paired with savings

- **YNAB** has a **Loan Planner** ("make a plan to pay down debt by calculating time and interest saved") and Monthly Debt Payment targets, sitting alongside its savings targets — but it does **not** automatically allocate a lump sum across debt and savings simultaneously.
- **Ramsey-style tools** implement the **snowball**; avalanche is the interest-optimal alternative. Most budgeting apps let you track a payoff plan but treat debt and savings as parallel manual tracks.
- **No mainstream budgeting app offers an integrated lump-sum optimizer** that splits a windfall between debt payoff and an investment contribution using the after-tax-return-vs-expected-return logic. This is the second clear differentiation opportunity, and it aligns with the app's stated intent to pair lump-sum debt plans with tracking-account contributions.

---

## Patterns worth adopting vs anti-patterns

**Worth adopting:**
1. **Structural contribution/growth split (YNAB/Actual):** record contributions as category-consuming transfers; record growth as an off-budget, uncategorized balance adjustment. Battle-tested; keeps market noise out of the budget.
2. **Off-budget for volatile assets; on-budget for cash cushion:** investments/pension/home value off-budget (net worth only); emergency cash on-budget (spendable).
3. **Two target archetypes:** a "hold/maintain a balance" target (emergency fund, replenishable) and a "reach amount by date" target (down payment, wedding) that back-computes the monthly contribution. Both exist in YNAB and are proven.
4. **Adjustment/reconciliation transaction as the universal balance-update primitive** for accounts that change without transactions.
5. **Time-horizon → asset-class guardrail:** warn when a <3–5-year goal is backed by an equity-linked account.
6. **Forecasting inputs standardization:** contribution rate, assumed return (nominal or real), retirement age, target income, inflation — the shared vocabulary of every projection tool.

**Anti-patterns to avoid:**
1. **Categorizing market gains/losses as income/expense on-budget** — pollutes the budget with volatility and inflates "income" in up months. Every serious app avoids this for investments.
2. **Binding an emergency-fund goal to a volatile account balance** — a market drop would falsely show the cushion "shrinking" below target.
3. **Single fixed-return point estimates presented as certainty** — Quicken's fixed-rate model is criticized for exactly this; at minimum show a range or sensitivity, ideally flag sequence-of-returns risk.
4. **Presenting the 4% rule / salary multiples as guarantees** — they are contested (Pfau, Morningstar) and assumption-laden.
5. **Requiring manual entry of the cushion target** when the app already has tiered spending data to derive it.
6. **Conflating "saved vs earned"** in a single progress number without letting the user see the split — the gap users complain about.

---

## Recommendations (staged, with change-triggering thresholds)

**Stage 1 — Core data model (do first).**
- Represent investment/tracking accounts as **off-budget**; record contributions as on-budget→off-budget transfers that consume a budget category, and record value changes as **uncategorized off-budget balance adjustments** (the YNAB/Actual pattern). Do **not** make investment gain/loss a budget income/expense category. *Change trigger:* only revisit if you decide to fully support on-budget brokerage cash-flow accounting, which is out of scope for envelope budgeting.
- Default savings goals to **category-linked (contributions-only) progress**. Add an **optional account-linked goal mode** (Monarch-style) for investment goals where the user wants growth to count. Where an account-linked goal is used, surface the **"contributed X, market moved Y, total Z"** split — the feature no competitor offers.

**Stage 2 — Cushion engine.**
- Auto-derive the emergency-fund target from the existing tiered spend data: **default = N × (rolling median "needs")**, with N defaulting to 3 (low-risk) or 6 (higher-risk based on user-declared income stability/dependents), and a **"needs + nice-to-have" comfort band** as the upper bound.
- Compute and display a live **"months of expenses covered"** metric. Model the cushion as a "maintain a balance / replenish when drawn" target, held in a non-volatile account. Auto-reprioritize contributions to refill a drawn cushion before resuming other goals (overridable).

**Stage 3 — Retirement/projection engine.**
- Ship a **deterministic FV-of-annuity projector** first (PocketSmith/Quicken-style), inputs: contribution rate, assumed return (default a **real ~3–4%**, user-adjustable, nominal/real toggle), retirement age, target retirement income, inflation. Offer all three target methods (15% rate, salary multiples, 25×/4%) and cross-display them. Always show a **range/sensitivity**, and label the 4% rule and salary multiples as contested. *Change trigger:* add **Monte Carlo** (Empower-style) once you have reliable return/volatility assumptions and users request probability-of-success outputs.

**Stage 4 — Debt/savings integration (the shared allocator).**
- Build a **lump-sum allocator** shared by the debt and savings engines that ranks each candidate dollar by **after-tax guaranteed return (debt rate) vs expected market return**, using a configurable threshold band (**pay debt >8%, invest <5%, split 5–8%** as defaults). Support both **avalanche and snowball** for the debt side.
- Implement a **configurable goal-sequencing waterfall**, defaulting to the r/personalfinance ordering (starter cushion → capture match → high-interest debt → full cushion → long-term goals), with a **Ramsey-style toggle** (debt-first, snowball, defer match). *Change trigger:* if user testing shows people abandon the default ordering, expose the sequence as a drag-to-reorder list.

---

## Caveats
- **Part A** sources are heavily practitioner/calculator content; the strongest primary anchors are Fidelity (salary multiples, 15% rate, debt-vs-invest 70% rule), the CFPB (no fixed emergency number), Bogleheads (loan-vs-bond comparison), and Bengen/Pfau/Morningstar (4% rule and its critiques). Pfau's international study spanned developed-country markets over ~109 years; the "4 of 14 countries" and "2.4% (2020)" figures come from his 2010 Journal of Financial Planning paper and April 2020 ThinkAdvisor remarks respectively. Country-specific account rules were deliberately excluded per scope.
- **Part B:** YNAB's own support pages render via JavaScript and could not be fetched as full text; YNAB claims are anchored in first-party ynab.com/blog pages plus retrievable support-page metadata and one corroborating third party for the exact "Reconciliation Balance Adjustment" behavior. Actual Budget docs were fully verifiable. Neither app's docs contain a verbatim "growth does/doesn't count toward a goal" sentence — that conclusion is a well-supported inference from their off-budget/categorization rules, not a direct quote.
- App feature sets change; Monarch, Copilot, and Simplifi in particular iterate quickly, and some capabilities (e.g., Monarch's retirement/goal features, Simplifi's Retirement Planner) are recent additions. Verify current behavior before implementation.
- Copilot, Tiller, Buckets, and Mint (historical) coverage is thinner than YNAB/Actual/PocketSmith/Quicken/Empower; treat those rows as directional.
- This is design research, not personalised financial advice.