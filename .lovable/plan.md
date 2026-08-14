# Cashback distribution + real-money Cash Out / Cash In

## What already exists (verified in the database)

- Cashback is already three-sided in `purchase_voucher`: `sale_cashback` (credit supplier), `upline` (parent reseller of a subreseller) and `admin` (shop admin), all written to `sale_commissions` with a rate snapshot, source ledger, sale id and timestamp, and each paid out as its own immutable `credit_ledger` entry.
- The admin share already reads `ecosystems.admin_sale_commission_percent` falling back to `platform_settings.default_admin_sale_commission_percent`.
- Cashback only fires inside a settled purchase transaction, and refunds already reverse it.
- `platform_settings` is the single Super Admin-owned settings row; `credit_packages` holds the **purchase** price of credits (PHP per credit bundle), which is a separate thing from a cash-**out** valuation.

So Part A is mostly a rate-model and settings change, not new machinery.

## Ambiguities and the assumptions I will use (correct me if wrong)

1. **Mapping your example onto the existing roles.** "Subreseller 20% / Reseller 10%" maps to: subreseller = cashback on credits they supplied, reseller = upline commission on their subreseller's chain. Admin = remainder.
2. **Admin remainder is computed per sale**, as `100 − (cashback % actually applied) − (upline % actually applied)`, floored at 0. On a direct customer purchase funded by a reseller with no subreseller in the chain, the admin therefore gets `100 − 10 = 90%`, not 70%. A single fixed admin percentage cannot be correct for every chain shape, so the remainder is derived per transaction.
3. **Who owns the cashback rates.** Today an Admin can edit their own shop rates. You asked for Super Admin control. I will make the Super Admin set platform defaults **and** a hard ceiling; shop admins may still set their own rates but never above the ceiling and never so the total exceeds 100%. Say the word if Admins should lose rate control entirely.
4. **Cash-out valuation is a new, separate setting** from `credit_packages` (the buy-in price). Stored as a pair (credits, PHP) so "1,000 credits = PHP 1,000" is expressible exactly.
5. **Cash-out debits credits at request time into a reserve**, not at approval. Rejection/cancellation returns them with a reversal entry. This is the only way to prevent a member spending credits they have already asked to withdraw. Balance never goes negative and nothing is silently consumed.

## Part A — cashback distribution

- New Super Admin settings: default cashback % for subreseller, reseller/upline, and a read-only computed "Admin remainder" preview.
- New DB validation function rejecting any rate set (platform or shop) where `cashback + upline > 100`.
- `admin_sale_commission_rate_for` replaced by a per-sale remainder calculation inside `purchase_voucher`: after the cashback and upline rows are written for a sale, the admin row is `100 − applied%` of the same basis.
- Existing `sale_commissions` rows, ledger entries and reversals are untouched.

## Part B — Cash Out / Withdrawal

New table `withdrawal_requests` (immutable-by-trigger, append-only status history):
requester, ecosystem, gross credits, **rate snapshot** (credits + PHP per unit), gross PHP, fee % snapshot, fee PHP, net payout, payment mode (`physical_cash` | `ewallet` | `bank`), account name, account number, notes, status, unique reference ID, reserve ledger id, release/refund ledger id, reviewer id + name + decision reason + timestamps.

- RPCs: `request_withdrawal` (any active member with sufficient balance; reserves credits atomically), `review_withdrawal` (**Super Admin only**, server-enforced), with `for update` locking and a status guard so an already-decided request can never be processed twice.
- Statuses: `pending → approved → released` (successful) or `pending/approved → rejected`, plus requester `cancelled` while still pending. Rejection/cancellation refunds the reserve.
- Member UI (Customer / Subreseller / Reseller / Admin, in Wallet): live conversion preview from current settings, fee line, net payout, 48-hour disclosure, and a Facebook contact button rendered **only when** the Super Admin has configured one.
- Super Admin review screen: requester + ecosystem, gross credits, rate snapshot, gross PHP, fee % and amount, net payout, payment details, notes, timestamps, and the requester's recent transaction history.

## Part C — Cash In

- New table `payment_methods` (name, type, instructions, account name, account number, active, notes, sort order) — Super Admin CRUD, everyone else read-only and active-only.
- New table `cash_in_requests`: amount PHP, credits at snapshot rate, selected method **snapshot** (name/type/account details copied in), reference, proof note, status, reviewer, timestamps.
- Submitting a request creates **no credits**. Only Super Admin approval issues them, reusing the existing platform issuance path so supply accounting stays correct.
- Member Cash In screen always loads active methods live from the database.

## Part D — Real-money safety

- Real-money records live in their own tables, never mixed into `credit_ledger`; the credit side is linked by ledger id.
- Unique human-readable reference per request (`WD-…`, `CI-…`) plus a unique constraint.
- Update triggers block edits to financial columns and to already-decided rows.
- No hard-coded rates anywhere: every amount is derived from a snapshot column or the live settings row.
- Approval RPCs re-check `is_super_admin()` server-side and record operator + target identity via the existing audit log.

## Part E — Super Admin settings

One "Money" settings area: credit-to-cash valuation, withdrawal fee % (default 1), cashback percentages with the live admin-remainder preview, payment methods CRUD, and the existing Facebook contact fields surfaced here too.

## Part F — Testing

SQL proofs (`supabase/tests/cashout-cashin.sql`) plus Vitest suites covering: the 10/20/70 example, changed rates, rate-sum validation, no cashback on cancelled/refunded sales, valuation 1,000=PHP1,000 and a changed valuation, 1% and changed fee, pending-request snapshot immunity to settings changes, all four roles can request, non-Super-Admin approval rejected, zero/negative/over-balance rejected, double-approval prevented, payment method CRUD + active filtering, Facebook contact only when configured, and full regression of wallet/voucher/issuance/profile flows. Typecheck + production build must pass before publishing.
