# Universe Loan Pool — peer-funded Universe Loans

Universe Loans stop being a Super Admin decision and become a peer-funded facility: members put coins into a Loan Pool, those coins fund loan applications, and the interest collected is split between the platform owner and the funders. Shop Loans (admin / reseller / subreseller) stay exactly as they are today — same rules, same restricted coins, same screens.

## What people will see

**Loan Pool (new Universe tab)**
- Pool totals: total pool balance, my contribution, my available (unallocated) funds, my funds locked in active loans, my interest earned.
- Contribute coins from the Universe wallet, withdraw back any funds that are not allocated.
- A list of loan applications open for funding: borrower name/handle, amount requested, amount still needed, term, interest, status. A funder enters an amount and commits it.

**Universe Loan application (rebuilt)**
- Amount, term (3 / 6 / 12 months), valid ID upload (existing private ID store), then a preview showing interest, platform fee, total repayment, monthly payment and the full month-by-month schedule before confirming.
- Statuses: Pending ID Review → Pending Funding → Partially Funded → Fully Funded → Active → Paid / Early Paid / Cancelled.
- After full funding the loan releases automatically: the platform fee is deducted, and the remaining coins land as **normal unrestricted Universe coins** (transferable, withdrawable, spendable anywhere). No first-month interest deduction.
- Borrower view: schedule, paid vs remaining, platform fee, payment and refund history, "Pay early" action.

**Super Admin**
- Settings: Universe Loan interest rate, allowed terms, interest-share split (default 50% owner / 50% contributors, must total 100%), loan platform fee (default 2%).
- Oversight report of all Universe Loans with borrower, funders, principal, interest, fees, payments, status. **No approve button** for individual Universe Loans.
- Uploaded IDs viewable in the admin views, as today.

## Money rules

- Interest model: flat/add-on interest, `interest = principal x monthly_rate x months`, split into equal monthly payments — simple, auditable, and matches the "automatically calculated monthly payment" requirement.
- Each loan snapshots rate, term, fee % and the interest split at the moment it becomes fully funded; later setting changes never touch it.
- Funders' coins leave their wallet at contribution time into pool ledger entries; committing to a loan moves funds from *available* to *allocated* under a row lock, so the same coins can never fund two loans.
- If a loan is cancelled before release, every allocation returns to the funder's available pool funds.
- Repayments split principal / interest per the schedule. Interest collected is split by the snapshotted percentages; the contributor portion is distributed pro-rata to each funder's actually released principal.
- Early payoff recomputes interest to only the elapsed months; interest already collected beyond that is refunded to the borrower and clawed back from the corresponding owner/contributor interest credits, all as explicit reversal entries.
- No wallet movement without a matching ledger row; every pool/loan movement goes through the existing `credit_ledger` + `apply_credit_entry` pattern.

## Technical section

**New tables** (public schema, GRANTs + RLS in the same migration):
- `loan_pool_accounts` — one per member: contributed, available, allocated, interest_earned.
- `loan_pool_ledger` — contribution / withdrawal / allocation / release / return / interest entries.
- `universe_loans` — borrower, amount, term_months, status, snapshots (interest %, fee %, owner/contributor split), funded_amount, released_at, principal/interest outstanding, id_document_path.
- `universe_loan_schedule` — per-period due date, principal, interest, paid amounts.
- `universe_loan_fundings` — loan x funder x amount, released principal, interest earned.
- `universe_loan_payments` — payments, refunds, adjustments.
- `platform_settings` additions: `universe_loan_interest_percent`, `universe_loan_terms`, `universe_loan_owner_share_percent`, `universe_loan_contributor_share_percent`, `universe_loan_platform_fee_percent`.

**New RPCs** (SECURITY DEFINER, row-locked, idempotent by client token where they move money): `universe_loan_settings`, `set_universe_loan_settings`, `loan_pool_contribute`, `loan_pool_withdraw`, `my_loan_pool`, `open_universe_loan_applications`, `apply_universe_loan`, `fund_universe_loan` (auto-releases on reaching 100%), `repay_universe_loan`, `payoff_universe_loan`, `my_universe_loans`, `my_funded_loans`, `super_universe_loans`.

**Frontend**: `src/lib/universe-loans.ts` + `loan-pool.ts` (calculation helpers mirroring the SQL, unit-tested), routes `/universe/loan-pool` and reworked `/universe/loans`, components under `src/components/wallet/`, Super Admin settings card + report on `super.settings` / `super.loans`. Nav entries in `universe-shell.tsx`.

**Untouched**: `coin_loans` and every Shop Loan RPC, `guard_restricted_coins`, shop-loan security reserve, wallet/earnings/spending logic, the Android workflow.

## Assumptions

1. Flat add-on interest (not reducing balance) — say the word if you want amortised interest instead.
2. "Eligible member" = any Universe member with coins; no separate approval to become a contributor.
3. Borrowers may not fund their own loan.
4. Monthly due dates run from the release date; no late fees or penalties are introduced (none exist today).
5. Existing `coin_loans` rows remain Shop Loans; nothing is migrated into the new tables.
