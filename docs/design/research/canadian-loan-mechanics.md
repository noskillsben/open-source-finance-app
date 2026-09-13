> Research carried over from the previous app (2026-09-01). References to ADR numbers in the text are to that app's records and no longer apply; treat the Recommendations section as inputs a report will need, not a build list.

# How Consumer Debt Products Work in Canada: A Mechanics Reference for a Debt-Payoff Engine

> Research compiled 2026-09-01. **Consumed by ADR-041** (debt terms and product profiles) and
> ADR-040 Amendment A1. Reference material, not a decision — the ADRs decide what the app does with
> this; where they disagree with this file, the ADR wins and this file is context. The Recommendations
> section below is the researcher's, not the Architect's: ADR-041 D3 collapses its "three engines" to
> two plus a variant, and its Stage 3 legal payment allocation was rejected (ADR-041 D4).

## TL;DR
- **Canadian mechanics differ from the US in three ways that will break a naïve engine:** (1) fixed-rate mortgage interest is compounded **semi-annually, not in advance** (Interest Act), so the monthly rate is `(1 + annual/2)^(1/6) − 1`, not `annual/12`; (2) the credit-card grace period is a **statement-level, pay-in-full condition** governed by federal regulation (SOR/2009-257 s.3), **not** a per-purchase rolling window; and (3) payments above the minimum on a credit card must, by law, go to the **highest-rate balance first or pro-rata** (Bank Act s.627.35).
- **Your proposed "per-purchase FIFO 30-day grace" credit-card model is inaccurate** on four counts: the grace period is conditional (not automatic), statement-level (not per-purchase), minimum 21 days after the statement closing date (not a fixed 30), and payment allocation is rate-ordered by law (not FIFO). Model it as: grace applies to a whole cycle's purchases only if the full statement balance is paid by the due date; otherwise interest accrues from each purchase's posting date using average-daily-balance × daily periodic rate.
- **Model each product family by its accrual/compounding rule and its prepayment treatment:** credit cards & lines of credit = daily accrual, revolving; installment/car loans = simple interest on declining balance, usually open (penalty-free prepayment); mortgages = semi-annual compounding, closed with IRD/3-months'-interest penalties; BNPL/carrier plans = mostly 0% fixed schedules where "pay extra" is often disallowed but "pay off in full" is always allowed.

## Key Findings

1. **Credit-card grace period is conditional and statement-level.** Under the Credit Business Practices Regulations (SOR/2009-257, s.3) and the Bank Act Financial Consumer Protection Framework, a federally regulated issuer must give a minimum 21-day interest-free period after the statement closing date, and may not charge interest on a cycle's purchases **only if the borrower pays the full outstanding statement balance by the due date**. If the full balance is not paid, interest on purchases accrues from the transaction/posting date. There is no per-purchase or FIFO logic anywhere in the rule.
2. **Credit-card interest = average daily balance × daily periodic rate (APR/365), accrued daily, typically compounding.** Cash advances and balance transfers get **no** grace period — interest runs from day one, often at a higher rate.
3. **Payment allocation above the minimum is legally mandated** (Bank Act s.627.35): highest-interest-rate balance first, or pro-rata across balances. The issuer chooses which of the two, but cannot do worst-for-consumer ordering on the excess.
4. **Minimum payments: Quebec is now 5%** of the balance for all cards (fully phased in August 1, 2025 under Bill 134); elsewhere in Canada the minimum is typically a flat amount plus interest and fees, or the greater of a small dollar amount and a percentage of the balance (commonly around 3%).
5. **Personal loans and lines of credit accrue interest daily on the outstanding/declining balance.** Installment loans are simple-interest, usually monthly-compounded, and normally **open** (prepayable without penalty at the major banks). LOCs are revolving with interest-only minimums; extra payments hit principal immediately.
6. **HELOCs are capped at 65% LTV standalone (80% combined) under OSFI B-20;** interest-only minimums, variable prime-based, daily accrual. "Readvanceable"/Combined Loan Plan mechanics changed at the end of lenders' 2023 fiscal year so re-advancing above 65% LTV is restricted.
7. **Car loans are simple-interest, amortized, usually monthly-compounded, fixed-rate, and typically open** (penalty-free prepayment); terms typically range 48–84 months (up to 96 on select vehicles). Admin/doc fees and tax are commonly rolled into principal (so you pay interest on them). Watch for subprime "buy-here-pay-here" precomputed interest.
8. **Mortgages: term ≠ amortization.** Fixed rates compound semi-annually (Interest Act); variable rates typically compound monthly and can hit a **trigger rate**. Closed mortgages carry prepayment privileges (10–20% lump sum + payment increases) and penalties (variable = 3 months' interest; fixed = greater of 3 months' interest or IRD).
9. **BNPL "Pay-in-4" (Klarna, Sezzle, Afterpay) is 0% interest, 4 payments over ~6 weeks, with flat late fees;** longer Affirm/PayBright monthly plans are simple-interest (0%–~35% APR) and prepayable with interest rebate.
10. **Carrier device financing (Rogers/Bell/Telus) is 0% APR over 24 months, tied to service;** you generally **can lump-sum pay it off in full or on cancellation** (Rogers also allows extra lump sums any time) — confirming the structure you described.
11. **Retailer "deferred interest" plans (Flexiti, Fairstone) are a trap class:** interest accrues from purchase date during the promo and is charged **retroactively** at ~32–38% if not paid in full by the deadline. Separate "equal monthly no-interest" plans do not accrue retroactive interest. Admin fees are often financed into principal.
12. **Federal criminal interest rate cap dropped to 35% APR effective January 1, 2025** (from 60% effective annual rate ≈ 48% APR), which now bounds high-cost consumer credit; payday loans are separately capped at $14 per $100 borrowed.

## Details

### 1. Credit cards

**Grace period — the single most important thing to get right, and where your model is wrong.**

The governing rule is the Credit Business Practices Regulations (SOR/2009-257), section 3, together with the Bank Act's Financial Consumer Protection Framework (in force June 30, 2022). The mechanics:

- **s.3(2):** the issuer cannot require the minimum payment sooner than **21 days after the last day of the billing cycle** (the statement closing date). This is the statutory floor for the grace period. Most issuers give 21–25 days; American Express often ~26–28.
- **s.3(4) (the key conditional), verbatim:** *"An institution may not charge interest on purchases of goods or services made on a credit card during a particular billing cycle if the borrower pays the outstanding balance owing on the credit card account in full on or before the due date."*

So the grace period is **conditional on paying the full statement balance by the due date**, and it applies to the **whole cycle's purchases as a block** — it is *not* granted per purchase and *not* a fixed rolling 30-day window per transaction.

**Two dates matter:** the *statement/closing date* (end of billing cycle) and the *due date* (≥21 days later). A purchase made early in a ~30-day cycle can enjoy up to ~51+ interest-free days (cycle length + grace); a purchase made on the last day of the cycle enjoys only the ~21-day grace. This variable window is a *consequence* of statement timing, not a per-purchase grace grant.

**What happens when you carry a balance.** If you do not pay the full statement balance by the due date, interest is charged on the unpaid purchases **back to their transaction/posting date** (not from the statement or due date), and in the following cycle your **new purchases begin accruing interest immediately from posting date with no grace** — until you once again pay the entire outstanding balance in full, which restores the grace period for subsequent purchases. (Regulatory nuance FCAC states: the grace period on new purchases can technically still apply "even if you have an outstanding balance from the month before," because the statutory test keys on paying the *current* statement's full balance by the due date — but in practice, a borrower who is revolving debt is not paying the current balance in full, so new purchases do not get grace.)

**Interest calculation.** Canadian issuers use the **average daily balance method with a daily periodic rate**: daily rate = APR ÷ 365 (÷366 in a leap year); sum each day's balance across the cycle, divide by days in cycle to get the average daily balance; interest = average daily balance × daily rate × days in cycle. Interest is accrued daily and posted at cycle end; many issuers (e.g., TD) compound interest daily. Cash advances and balance transfers have **no grace period** and typically a higher rate (e.g., ~22–23% vs ~20% on purchases), with interest from the transaction date.

**Minimum payments.** Quebec: 5% of the outstanding balance for all cards as of August 1, 2025 (Bill 134, phased +0.5%/year from 2% since 2019; cards opened after August 2019 were at 5% from the start). Rest of Canada: typically a flat amount plus interest and fees, or the greater of a small dollar amount and a percentage of the balance (commonly around 3%). Federally regulated issuers must show the time-to-repay-at-minimum on statements. (A Bank of Canada staff working paper on Quebec's policy — Allen, Boutros & Guttman-Kenney, "Evaluating Credit Card Minimum Payment Restrictions" — found the policy increases minimum payments by ~75% and reduces revolving debt by ~26% in the long run, while persistently reducing credit access and increasing delinquencies but not defaults.)

**Payment allocation (Bank Act s.627.35).** For payments **above** the minimum, the issuer must either (a) apply the excess to the highest-interest-rate balance first, then descending, or (b) apply it pro-rata across balances in proportion to each balance. Example: a $1,000 purchase at 19.99% and a $250 cash advance at 21.99%, with a $1,200 payment — method (a): $250 to the cash advance then $950 to purchases; method (b): ~$960 to purchases and ~$240 to the cash advance. The minimum-payment portion itself can be allocated at the issuer's discretion.

**Fee types to model:** annual fee (recurring, conditional by card); cash-advance fee (per-event flat or ~3–5%); cash-advance interest (from day 1, higher rate, no grace); balance-transfer fee (% of amount) and promo rate (time-limited); foreign-currency conversion (~2.5% typical, on top of the network exchange rate); over-limit fee (conditional; cannot be charged if the over-limit is solely due to a hold); late-payment consequence (penalty/default rate, roughly 25–31% on some cards after missed payments); dishonoured/returned-payment fee; inactivity fees are rare on mainstream cards.

**Why your "per-purchase FIFO 30-day grace" model is inaccurate — flag list:**
- **Not per-purchase:** grace is a statement-level, all-or-nothing condition tied to paying the full statement balance.
- **Not a fixed 30 days:** the statutory floor is 21 days after the *statement closing date*; the effective interest-free span per purchase varies (~21 to ~51+ days) with cycle timing.
- **Not automatic:** it only applies if the full balance is paid by the due date; carrying a balance removes grace on new purchases (interest from posting date).
- **Not FIFO:** payment allocation is governed by s.627.35 (highest-rate-first or pro-rata), not first-in-first-out across purchases.
- **Retroactive interest:** once grace is lost, interest applies back to each purchase's transaction/posting date, not from the due date.

### 2. Bank loans — personal loans, lines of credit, HELOCs

**Personal installment loans.** Interest is simple interest calculated on the declining outstanding principal, typically compounded monthly; rates fixed or variable (variable = lender prime ± spread). Payment is a blended amortized amount: each payment covers accrued interest first, remainder reduces principal. Payment frequency options: monthly, semi-monthly, bi-weekly, accelerated bi-weekly (accelerated = half the monthly payment paid 26×/year ≈ 13 monthly payments, retiring principal faster). At the major banks these are usually **open** — RBC, for example, states fixed-rate personal loans can be prepaid at any time without penalty. Interest on a personal loan is charged on the whole borrowed principal from the day of advance (no grace period like a card).

**Unsecured lines of credit.** Revolving; interest accrues **daily** on the outstanding drawn balance (daily interest = balance × annual rate ÷ 365). Rate is variable, quoted as prime + spread. Minimum payment is typically **interest-only** (or interest plus 1–2% of principal at some lenders; e.g., Scotia's interest-only minimum is the greater of the interest portion or $50). Any payment above interest reduces principal and cuts subsequent daily interest immediately — mid-month payments help because accrual is daily. No grace period: interest runs from the day funds are drawn.

**HELOCs.** Revolving, secured by home equity, variable prime-based, daily interest accrual, interest-only minimum payments. OSFI Guideline B-20 caps a standalone HELOC at **65% of appraised value**, and total borrowing (mortgage + HELOC) at **80%** combined. A "readvanceable mortgage" (OSFI: Combined Loan Plan) bundles an amortizing mortgage with a HELOC whose available limit grows as mortgage principal is repaid. Under OSFI's B-20 advisory, *"any and all lending above the 65 percent LTV limit should be both amortizing and non-readvanceable. Principal payments applied to the segment above 65 percent should be matched by a reduction in the overall authorized limit, until this overall CLP authorized limit reduces to 65 percent LTV"* (effective at the end of lenders' 2023 fiscal year). Practically, principal payments above 65% permanently reduce the authorized limit rather than freeing re-borrowable room up to 80%. Uninsured HELOCs are subject to the B-20 stress test (qualify at the greater of contract rate + 2% or 5.25%).

**Prepayment.** Personal loans and LOCs at the major banks are generally open/prepayable without penalty; always model a per-agreement flag because some non-bank/subprime installment loans use precomputed interest or charge fees.

### 3. Car loans

**Interest.** Simple interest, amortized on the declining balance, usually compounded monthly (not semi-annually like mortgages), typically fixed-rate. Monthly payment computed by the standard amortization formula. Terms typically range 48–84 months (up to 96 on select vehicles); 60/72/84 are most common. New-vehicle depreciation of ~15–25% in year one and ~50–60% over five years means 84-month borrowers are often underwater for 3–4 years.

**Dealer vs bank financing.** Dealer routes the application to multiple lenders (banks, captive finance arms, credit unions) and earns a commission that can add ~1–2 points to the rate versus going direct; manufacturer-subsidized promo rates (e.g., low/0% financing) are sometimes below bank rates but often require forgoing a cash rebate.

**Fees.** Admin/documentation fees, PPSA registration, and sales tax are commonly financed into the loan principal — meaning interest is charged on them. Model these as one-time amounts capitalized into the opening principal.

**Prepayment.** The large majority of Canadian car loans from banks, credit unions, and major dealer lenders are **open** — extra payments go straight to principal and shorten the term (they don't reduce the next scheduled payment). Lump-sum payoff = remaining principal + interest accrued to the payoff date (+ any small admin fee per contract). **Exception to model:** some subprime/"buy-here-pay-here" contracts use precomputed interest (e.g., Rule of 78), where interest is front-loaded and early payoff saves less than a simple-interest calculation would predict.

**Negative equity / balloons.** Long terms plus fast depreciation frequently leave borrowers "underwater" (owe more than the car's value); negative equity is often rolled into the next loan. Balloon/residual structures exist mainly in leases and some manufacturer financing; if modeled, treat the balloon as a large final payment.

### 4. Mortgages

**Semi-annual compounding (the defining Canadian rule).** The Interest Act requires fixed-rate mortgage interest to be stated as compounded no more than **semi-annually, not in advance**. So a quoted 5.00% means 5.00% compounded twice a year. To get the periodic rate for payments:

- Effective monthly rate = `(1 + annual/2)^(1/6) − 1`. At 5.00% this is ≈ 0.4124% (vs 0.4167% for US-style monthly compounding); effective annual rate ≈ 5.0625%.
- General conversion to `n` payments/year: periodic rate = `(1 + annual/2)^(2/n) − 1`. For bi-weekly (n=26): `(1 + annual/2)^(2/26) − 1`.

Using `annual/12` (US convention) will **overstate** the effective rate and produce wrong payments/schedules for Canadian fixed-rate mortgages.

**Variable-rate mortgages** typically compound **monthly** and are priced as prime ± spread. Two sub-types: **fixed-payment variable** (payment stays constant; as prime rises, more of each payment goes to interest — and past the **trigger rate**, the payment no longer covers interest and the balance can grow via negative amortization) and **adjustable-payment variable** (payment moves with prime). The trigger rate is the rate at which the fixed payment covers interest only; a simple approximation is (payments/year × payment) ÷ balance.

**Term vs amortization.** The **amortization** is the full payoff horizon (e.g., 25 or 30 years); the **term** is the contract length (commonly 5 years) after which you **renew** at then-current rates. An engine must model these separately: interest/penalty math is term-scoped, payoff projections are amortization-scoped.

**Payment frequency & acceleration.** Options: monthly, semi-monthly, bi-weekly, weekly, and **accelerated** bi-weekly/weekly. Accelerated bi-weekly = monthly payment ÷ 2, paid 26×/year = 13 monthly-equivalents/year; the one extra monthly payment/year goes entirely to principal and can shorten a 25-year amortization by roughly 3–4 years. Regular (non-accelerated) bi-weekly just spreads the same annual total over 26 payments (minimal savings).

**Prepayment privileges (closed mortgages).** Typically an annual **lump-sum** allowance of 10%/15%/20% of the **original** principal, plus a **payment-increase** privilege of 10–100% (double-up). Privileges are usually **use-it-or-lose-it per calendar or anniversary year** and are measured on the original principal. Exceeding them triggers a penalty. Open mortgages allow unlimited penalty-free prepayment but carry higher rates. Prepayments reduce principal and shorten amortization; they do not lower the contractual scheduled payment. (Bank-specific examples: RBC closed ~10% once/12 months plus double-up; TD ~15%; CIBC/Scotia/BMO 10–20% by product — always per-contract.)

**Prepayment penalties.** Variable closed: usually **3 months' interest**. Fixed closed: the **greater of 3 months' interest or the Interest Rate Differential (IRD)**. IRD ≈ (contract rate − comparison rate) × balance × (months remaining ÷ 12). Big banks compute IRD off **posted** rates (often using the "discounted IRD" that subtracts your original discount), producing much larger penalties than monoline lenders that use a standard IRD; IRD can reach five figures when rates have fallen. Federally regulated lenders must disclose how the penalty is calculated and provide a toll-free line for an exact quote.

**Fees.** Appraisal, legal/closing, title insurance; **CMHC (or Sagen/Canada Guaranty) default insurance** for <20% down; discharge fee at payoff; assumption and porting fees. 2025 CMHC premium tiers (of the loan amount, added to principal and amortized), confirmed against CMHC's official table: **4.00%** at 5–9.99% down (95% LTV), **3.10%** at 10–14.99% (90% LTV), **2.80%** at 15–19.99% (85% LTV), with a **0.20% surcharge** for amortization beyond 25 years. Default insurance is available only up to a $1.5M price cap (raised December 15, 2024); the premium is PST-taxable in Ontario (8%), Quebec (9%), and Saskatchewan (6%), and that PST must be paid at closing (not financed).

**Stress test (B-20).** Borrowers must qualify at the greater of contract rate + 2% or 5.25%. This affects *qualification*, not the payment math itself, so model it as a gating check, not part of amortization.

**Renewal.** At term end, the balance renews for a new term at current rates; the stress test generally does not re-apply if staying with the same lender. Amortization continues from the current balance.

### 5. Buy-now-pay-later and payment plans

**Pay-in-4 (Klarna, Sezzle, Afterpay).** 0% interest, four installments every two weeks (first at checkout). Soft credit check to open (Klarna performs a "semi-hard" check on the first Pay-in-4 fulfillment in some markets). Missed payment → flat **late fee** (Afterpay caps late fees at 25% of order value or ~$8; Sezzle charges a fee after a couple of days and offers a paid reschedule; Klarna charges up to ~$7–$10 per late payment in Canada) plus account suspension; prolonged non-payment (~90–120 days) can go to collections. On-time Pay-in-4 activity is generally not reported to bureaus (so it doesn't build credit), though this is changing at some providers (Klarna began reporting some Pay-in-4 in 2025).

**Longer-term installment (Affirm; PayBright is now Affirm).** Fixed monthly payments over 3–48 months; **simple interest** on the balance, 0% (merchant-subsidized) up to ~35% APR based on credit. Affirm charges no late fees and **no prepayment penalty**; paying off early stops/rebates unearned interest — model early payoff as principal + interest accrued to date (a 12-month plan paid in 8 months costs ~8/12 of projected interest). Because the criminal-rate cap is now 35% APR, model that as the hard ceiling.

**Carrier device financing (Rogers/Bell/Telus).** 0% APR over **24 months**, financing the device price (+ tax, sometimes admin/PPSA costs) in equal monthly installments tied to an eligible service plan. Key mechanics matching what you described:
- You **can make lump-sum payments** and can pay the balance off **in full** early (required if you want to upgrade); Rogers explicitly allows lump-sum payments any time on the standard financing plan.
- On **cancellation of the line for any reason** (including non-payment, transfer, or moving to an ineligible plan), the **remaining device-financing balance becomes immediately payable**.
- Under the CRTC Wireless Code, device-financing plans are treated like device subsidies for early-cancellation purposes, with early-cancellation amounts reduced to zero within 24 months.
- Net for your engine: model as a 0% fixed 24-month schedule where the balance can be closed with a single lump sum at any time; whether *arbitrary partial acceleration* is allowed varies by carrier/plan (Rogers permits lump sums; treat "pay extra" as a per-carrier flag). Your description — "can't be paid down faster but can be closed with one lump-sum payment" — is a correct general model for the conservative case, though some carriers (Rogers) do allow extra lump sums.

**Retailer deferred-interest / equal-billing (Flexiti, Fairstone, Desjardins Accord D).** Two distinct sub-types you must model separately:
- **Deferred-interest ("don't pay for X months" / pay-in-full-by-deadline):** interest **accrues from the purchase date** during the promo at the account rate (currently ~31.99%–34.99% at Flexiti, up to ~37.99% at some retailers); if the balance is **not paid in full by the promo expiry** (or a payment is missed and the promo is cancelled), all that accrued interest is charged **retroactively from day one**. Model as: interest silently accruing on the full amount, waived only on full/on-time payoff.
- **Equal monthly, no-interest:** no interest accrues during the term; fixed monthly payments; missing a payment can cancel the promo and start interest at the account rate going forward.
- **Admin/setup fees** (e.g., Flexiti ~$99.95–$199.95 depending on term/merchant; not charged in Quebec) are typically **financed into the purchase principal**, and annual fees (~$24.99–$39.99) may apply. Fairstone deferred plans similarly accrue interest from the start of the promo and waive it only if paid in full by expiry (else ~31.99%). Note The Brick has stated a missed payment does not trigger retroactive interest from purchase date (a per-merchant exception worth a flag).

**Regulatory context.** BNPL is not yet comprehensively regulated federally in Canada (it largely sits outside the credit-card-specific rules), but the **criminal interest rate cap fell to 35% APR effective January 1, 2025** (Criminal Code s.347 via the Criminal Interest Rate Regulations; the prior 60% effective annual rate ≈ 48% APR), bounding high-cost installment and retailer credit. Payday loans are separately capped at $14 per $100 borrowed. Provincial cost-of-credit disclosure rules (and Quebec's consumer-credit regime, which bars deferred "no-payment" plans and imposes its own disclosure/annual-fee treatment) also apply.

## Compact reference table

| Product | Interest calc method | Compounding | Grace period | Typical fees | Prepayment |
|---|---|---|---|---|---|
| Credit card (purchases) | Average daily balance × daily rate (APR/365) | Daily (often compounds) | ≥21 days after statement close, **only if full statement paid**; else interest from posting date | Annual, cash-advance, balance-transfer, FX ~2.5%, over-limit, late/penalty rate | Anytime, no penalty (revolving) |
| Credit card (cash advance/BT) | Same, higher rate | Daily | **None** — interest from day 1 | Cash-advance/BT fee (flat or 3–5%) | Anytime |
| Personal installment loan | Simple interest, declining balance, amortized | Monthly (typical) | None (interest from advance) | Possible setup; insurance optional | Usually open (no penalty at big banks) |
| Unsecured line of credit | Balance × (rate/365), daily | Daily | None | Usually none; variable prime+spread | Anytime; extra payment cuts principal immediately |
| HELOC | Balance × (rate/365), daily, prime-based | Daily | None | Setup/appraisal; discharge | Anytime; readvance limited above 65% LTV |
| Car loan | Simple interest, declining balance, amortized | Monthly (typical) | None | Admin/doc/PPSA + tax financed into principal | Usually open; watch precomputed (subprime) |
| Mortgage (fixed) | Amortized; rate = `(1+annual/2)^(2/n)−1` | **Semi-annual** (Interest Act) | None | Appraisal, legal, CMHC (if <20% down), discharge | Privileges 10–20% lump + payment increase; penalty = greater of 3 mo interest or IRD |
| Mortgage (variable) | Amortized, prime-based | Monthly (typical) | None | Same as above | Penalty usually 3 months' interest; trigger-rate risk |
| BNPL Pay-in-4 | 0% (no interest) | n/a | n/a | Flat late fee (~$7–$10; Afterpay caps 25% of order) | Anytime, free |
| Affirm/PayBright monthly | Simple interest on balance | Monthly | n/a | No late/prepay fees (Affirm) | Free; interest rebated on early payoff |
| Carrier device financing | 0% | n/a | n/a | Possible admin/PPSA financed in | Lump-sum payoff anytime; full balance due on cancel |
| Retailer deferred interest (Flexiti/Fairstone) | Interest accrues from purchase date; **retroactive** if unpaid by deadline (~32–38%) | Per account terms | Promo period (not a grace period) | Admin fee (~$100–$200) financed in; annual fee | Pay in full before deadline to avoid all interest |
| Retailer equal-monthly no-interest | 0% during term | n/a | n/a | Admin/annual fees possible | Anytime |

## Recommendations

**Stage 1 — Build the accrual core correctly per family.** Implement three accrual engines: (a) **daily-accrual revolving** (credit cards, LOCs, HELOCs) using average-daily-balance × (APR/365); (b) **amortized simple-interest declining-balance** (personal loans, car loans) with a compounding-frequency parameter (default monthly); and (c) **mortgage amortization with a compounding-frequency switch** — semi-annual for fixed (`periodic = (1+annual/2)^(2/n)−1`), monthly for variable. Do **not** hardcode `annual/12`.

**Stage 2 — Model the credit-card grace period as a statement-level state machine, not a per-purchase timer.** State per cycle: `paidFullLastStatement` (boolean). If true and the current full statement balance is paid by the due date → no interest on that cycle's purchases. If false → accrue interest on purchases from posting date. Represent the due date as `statementCloseDate + graceDays` (default 21, configurable to 25/28). Cash advances/balance transfers: always accrue from transaction date, separate (higher) rate bucket. **Delete the FIFO 30-day per-purchase logic.**

**Stage 3 — Implement legal payment allocation.** For payments above the minimum on cards, offer both s.627.35 methods (highest-rate-first default; pro-rata option). For minimums, allocate per issuer default (highest-rate is a safe, consumer-favourable default). For Quebec users, set the minimum-payment floor to 5% of balance; elsewhere use "greater of ~$10 or ~3% + interest/fees" as a configurable jurisdiction rule.

**Stage 4 — Prepayment treatment flags per product.** Represent each debt with: `isOpen` (penalty-free prepayment), `penaltyModel` (none / 3-months-interest / greater-of-3mo-or-IRD / precomputed-Rule-of-78), and `extraPaymentEffect` (reducePrincipalShortenTerm — the correct default for Canadian loans/mortgages — vs reduceNextPayment). For mortgages add `annualLumpSumPct` (of original principal), `paymentIncreasePct`, privilege reset basis (calendar vs anniversary), and an IRD calculator (contract rate − comparison rate) × balance × months-remaining/12, with a posted-vs-contract-rate toggle.

**Stage 5 — BNPL/deferred-interest edge cases.** Model Pay-in-4 as a 0% fixed 4×bi-weekly schedule with a flat late fee. Model Affirm/monthly as simple-interest with free early payoff (interest to date). Model carrier financing as 0% 24-month with `lumpSumPayoffAllowed=true`, `arbitraryPartialAllowed=perCarrierFlag`, and `balanceDueOnCancel=true`. Model retailer **deferred-interest** plans with a hidden accruing-interest ledger that is waived only on full on-time payoff and otherwise charged retroactively at the account rate — this is the highest-risk mis-model if treated as true 0%.

**Benchmarks that should change the model:** if you add non-federally-regulated lenders (provincial credit unions, retailers), re-check grace/allocation rules (s.627.35 and SOR/2009-257 bind federally regulated institutions; provincial rules may differ). If any modeled APR approaches 35%, apply the criminal-rate ceiling. If Quebec's 5% rule spreads to other provinces, make the minimum-payment percentage a jurisdiction table rather than a constant.

## Caveats
- **Sources vary on the "carry a balance → lose all grace" framing.** The strict statutory test (SOR/2009-257 s.3(4)) conditions grace on paying the *current* full statement balance by the due date; FCAC notes the grace on new purchases can apply "even if you carried a balance from the prior month" if you now pay in full. In everyday revolving-debt use, however, new purchases effectively get no grace and interest runs from posting date. Model the conservative (no-grace-while-revolving) behaviour but expose the pay-in-full reset.
- **"Interest back to transaction date" is contractual/industry practice permitted by, not explicitly mandated by, federal regulation.** The regulation prohibits interest only when paid in full; the retroactive-to-posting-date mechanic comes from cardholder agreements (and is confirmed by FCAC/issuer disclosures). Some issuers date retroactive interest from the statement date rather than the transaction date — treat the start date as a per-issuer parameter.
- **Compounding on variable mortgages and LOCs is lender-specific** — variable mortgages may compound monthly or semi-annually; confirm per contract.
- **Rate figures cited (e.g., ~20% card APR, Flexiti 31.99–34.99%, CMHC tiers) are illustrative/point-in-time** and should be user-entered, not hardcoded.
- **Provincially regulated lenders (credit unions) and Quebec's consumer-credit regime** differ from the federal framework; several rules above (s.627.35 allocation, SOR/2009-257 grace) strictly bind only federally regulated institutions.
- **BNPL terms change frequently and vary by merchant/region;** treat provider fee/late-fee/credit-reporting specifics as configurable and verify against current provider T&Cs before relying on them.
- **The Cost of Borrowing (Banks) Regulations (SOR/2001-101) — a source many secondary articles still cite — was repealed effective June 29, 2022;** bank cost-of-borrowing disclosure now lives in the Financial Consumer Protection Framework Regulations (SOR/2021-181), while the substantive grace-period rule is in SOR/2009-257 s.3.