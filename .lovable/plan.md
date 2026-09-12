# Centralized My Wallet + Coin Loans

Findings first, then the build plan. Nothing is implemented yet.

## A. Every wallet surface today

| Where | What it does |
| --- | --- |
| `/universe/wallet` | Wallet Center, `scope="universe"` — the one global Universe coin balance, history, member-to-member coin sending |
| `/app` (customer) | Same Wallet Center, `scope="shop"` — per-shop balances, in-shop sending, shop-to-shop moves, points, history |
| `/reseller/wallet` | Same component + seller totals (wholesale discount, cashback) |
| `/admin/wallet` | Same component, admin framing |
| `/app/money`, `/reseller/money`, `/admin/money` | Cash In / Cash Out page (`money-page.tsx`) — already embedded inside Wallet Center too |
| `/admin/wallets` | Admin tool over *other members*' wallets: load credits, adjust, reverse transfers, per-member ledger |
| `/admin/transactions`, `/reseller/earnings`, `/admin/reports` | Reporting views on the same ledger |
| `/app/history`, `/app/transfer`, `/reseller/history`, `/reseller/transfer` | Already redirect into Wallet Center |

So one component (`wallet-center.tsx`, 786 lines) is already mounted at four routes; the duplication is in **navigation and routing**, not in logic.

## B. What consolidates, what stays

Consolidate into a single **Universe → My Wallet**:
- Personal balances (global Universe wallet + each shop wallet listed as sections), history, points, send coins, shop-to-shop transfer, Cash In / Cash Out. Admin/Reseller/Subreseller all land on the same screen.
- `/app`, `/reseller/wallet`, `/admin/wallet`, `/app/money`, `/reseller/money`, `/admin/money` become redirects to `/universe/wallet` (old links keep working, nothing deleted).
- Wallet Center gains a scope of "all my wallets": global Universe balance plus New Generation shop wallets shown as separate, clearly-labelled sections — NG wallets stay financially isolated, only the *screen* is shared.

Stays role-specific and where it is:
- `/admin/wallets` (managing other people's wallets, issuing/adjusting credits, reversals) — that is shop administration, not "my wallet".
- Earnings, reports, transactions, spending tracker.

## C. Existing coin architecture (verified)

- `credit_accounts (user_id, ecosystem_id, balance)`; `ecosystem_id IS NULL` = the one global Universe wallet (`ensure_global_wallet`).
- `credit_ledger` is authoritative; trigger `apply_credit_entry` recomputes and locks the balance and refuses negatives. `entry_kind` labels every movement (`cash_in`, `purchase`, `sale_commission`, …).
- Movement RPCs: `transfer_universe_coins` (global→global), `transfer_credits_in_shop`, `transfer_credits_between_shops`, `purchase_voucher`, `retail_place_order`, `settle_cash_in_approval` (the top-up credit point), `superadmin_issue_credits`.
- Affiliation truth: `ecosystem_memberships (user_id, ecosystem_id, role, membership_state='active')`; Universe purchases resolve the wallet via `retail_wallet_for` / `is_universe_shop`.
- Super Admin configuration lives in the single `platform_settings` row, read by `money_settings()` and written by `set_platform_money_settings`.
- `wallet_integrity_check` asserts balance == sum(ledger) — so loans must not create a parallel balance.

## D. Database changes for loans

New tables (additive, no destructive migration):
- `coin_loans` — borrower, principal, interest rate snapshot, first-month interest, amount released, total owed, outstanding, status (`pending`, `active`, `settled`, `rejected`), approval mode (auto/manual), approver, timestamps.
- `coin_loan_entries` — every loan event (release, interest accrual, repayment, write-off) with the `credit_ledger` row it corresponds to; unique key per (loan, period) so accrual is idempotent.
- `platform_settings` gains `loan_auto_limit_credits`, `loan_monthly_interest_percent`, `loan_first_month_interest_upfront` (boolean), `loans_enabled`. Exposed through `money_settings()`/`set_platform_money_settings` — no hard-coded numbers anywhere.
- New `credit_ledger.entry_kind` values: `loan_release`, `loan_repayment`, `loan_interest` (reporting only where no coins move).

New RPCs (all `SECURITY DEFINER`, all re-checking the caller):
`request_coin_loan`, `review_coin_loan` (Super Admin), `coin_loan_summary`, `repay_coin_loan` (manual early repayment), `accrue_coin_loan_interest` (scheduled, idempotent), plus a `my_coin_loans` read.

RLS: borrowers read only their own loans; Super Admin reads/writes all; nobody writes loan rows directly — all changes go through the RPCs.

## E. Enforcing the loaned-coin restriction

Recommended model: **one balance, a restricted portion.** `credit_accounts` gains `restricted_balance` maintained only by loan RPCs. Loan coins are credited to the normal global wallet (so `wallet_integrity_check` and all history stay correct), and the restricted amount records how much of it may not leave freely.

- Free (spendable anywhere / transferable) = `balance − restricted_balance`.
- Transfers (`transfer_universe_coins`, `transfer_credits_in_shop`, `transfer_credits_between_shops`), gifts and cash-out all require `amount <= free balance` — loaned coins can never leave to another user or to cash.
- Purchases from a shop where the buyer has an active `admin` / `reseller` / `subreseller` membership may consume restricted coins first, then free coins; the purchase RPC records how much was loan-funded.
- Purchases from any other shop require `amount <= free balance`.
- Enforced inside the RPCs and by a check constraint `restricted_balance <= balance`, so the UI can never bypass it.

## F. Interest and repayment-first top-ups

- Auto-approved loan (≤ configured limit): total owed = principal; released coins = principal − first month's interest. Request 1,000 at 2% → 980 credited, 1,000 owed.
- Manual loans above the limit release only after Super Admin approval, same accounting.
- Monthly accrual runs as a scheduled database job (pg_cron → RPC), never a client timer. It is keyed by loan + period month, so re-running it changes nothing.
- Top-up priority: `settle_cash_in_approval` credits the full amount as today, then immediately applies a `loan_repayment` debit for `min(credited, outstanding)`. Ledger shows both rows, so history reads clearly: "Cash in 1,000", "Loan repayment 600", balance +400. Repayment reduces `restricted_balance` first.

## G. Decisions to confirm

1. **Recurring interest** — after the first month, does an unpaid loan accrue another 2% each month on the outstanding amount (compounding until settled), or is the first month's interest the only charge?
2. **Loan restriction vs. later interest** — when interest accrues, does it increase the amount owed only, or also increase the restricted portion? (Proposal: owed only.)
3. **One loan at a time?** Or several concurrent loans up to the limit in total? (Proposal: one active loan per member; the auto limit applies to the total outstanding.)
4. **Subresellers included** — confirm subresellers may borrow on the same terms as Admins and Resellers.
5. **NG shop wallets** — should New Generation shop wallets also appear inside the centralized My Wallet as read-only sections, or stay only inside the shop console? (Proposal: show them, still isolated.)
6. **Loan coins and Cash Out** — confirm loaned coins can never be withdrawn as cash (proposal: never).
7. **Non-payment** — is there any due date / penalty / suspension, or does the loan simply stay outstanding and accrue?

## H. Step-by-step build (low risk)

1. Consolidation only, no money logic: extend Wallet Center to show global + shop wallets in one screen; point Universe nav at it; convert the role wallet/money routes to redirects. Verify every existing action still works.
2. Add loan settings to `platform_settings` and the Super Admin settings screen (limit, monthly rate, first-month behaviour, on/off). No behaviour change yet.
3. Add `coin_loans`, `coin_loan_entries`, `restricted_balance`, RLS and grants. Still inert.
4. Add `request_coin_loan` / `review_coin_loan` with release into the global wallet, and the Super Admin approval queue.
5. Add restriction enforcement to transfers, gifts, cash out, and to voucher/retail purchase RPCs, with loan-funded amounts recorded.
6. Add repayment: top-up priority inside `settle_cash_in_approval`, plus manual repay.
7. Add the scheduled idempotent interest accrual job.
8. My Wallet loan panel: request, status, outstanding, schedule, history.
9. SQL suites (rolled back) for every rule above plus unit tests; full typecheck and test run. No publishing.

Existing balances, ledger rows and history are never rewritten at any step.
