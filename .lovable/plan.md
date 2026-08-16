# Cash In / Cash Out / Listener — Implementation Review (no code changes yet)

Verified against the live database and current source. Findings below are confirmed by
reads, not assumed. There are blocking questions at the end: implementation should not
start until they are answered.

## 1. What exists today

**Cash Out (one path only).** `request_withdrawal` debits the requester's wallet with a
`withdrawal_hold` ledger entry for the requested credits, records gross/fee/net in pesos
using platform `withdrawal_fee_percent`, and creates a pending `withdrawal_requests` row.
Only the platform owner can decide it (`review_withdrawal`: approve / reject / release).
Reject writes a `withdrawal_return` credit entry. Release removes the credits permanently
(no counter-entry). The fee is recorded on the request, never deducted from the wallet.
There is exactly 1 withdrawal row in the database today.

This existing path already matches the approved SUPERADMIN_CASHOUT rules (deduct requested
amount only, fee recorded separately, credits leave circulation on release). There is no
ADMIN_CASHOUT path at all.

**Cash In.** `request_cash_in` creates a pending request; `try_auto_approve_cash_in` gates
approval on: rule enabled, reference present, screenshot present, reference never used
before, amount within the automatic limit, receiving number resolved, sender number
present, a linked accepted listener event from a non-revoked and currently-online device
with matching sender number and amount, and `receipt_check = 'matched'`. Otherwise the
request stays pending. `settle_cash_in_approval` books the credits once via
`platform_credit_issuances` keyed `cash_in:<id>`.

**Receiving number.** `cash_in_receiving_number(ecosystem, method)` returns the shop's
`ecosystems.cash_in_gcash_number`, falling back to `payment_methods.account_number`. There
is no explicit "which account was this paid to" field on the request. 3 shops have a number.

**Listener.** 2 devices exist, both with `ecosystem_id IS NULL` (platform / Super Admin
scope), 0 shop-scoped devices. `register_listener_device` and `revoke_listener_device` are
Super-Admin-only; RLS on `listener_devices` and `listener_events` is Super-Admin-only read.
Matching (`match_listener_event`, `link_cash_in_listener_event`) accepts a device when
`d.ecosystem_id IS NULL OR d.ecosystem_id = request.ecosystem_id`.

**Rules.** One row in `cash_in_auto_rules` (the platform row). `cash_in_auto_rule()` lets a
shop row fully override the platform row; there is no staging/activation concept.

## 2. Conflicts and risks found

1. **A Super Admin device can currently settle a shop-destined Cash In.** The
   `ecosystem_id IS NULL` branch makes the platform listener a wildcard across all shops.
   Once Admin listeners and two Cash In destinations exist, this becomes a real
   mis-credit path: money paid to the Super Admin GCash could satisfy a request meant for
   an Admin's GCash, and vice versa. Matching must become destination-aware, not
   ecosystem-wildcard.
2. **Requests do not record the destination account.** Nothing distinguishes "paid to the
   Admin's GCash" from "paid to the Super Admin GCash". Both the Admin-balance cap and
   the correct listener/rule selection depend on this. New column required.
3. **Multi-wallet ambiguity in Cash Out.** 4 users hold more than one wallet row
   (`credit_accounts` per membership), yet `request_withdrawal` picks the wallet with
   `where user_id = _subject` and no ecosystem filter. Adding a second Cash Out path on
   top of this will make the wrong-shop debit more likely and will corrupt per-shop cash
   flow reporting. This must be scoped to the acting ecosystem first.
4. **No Admin visibility policies.** `cash_in_requests` and `withdrawal_requests` are
   readable only by the owner and the Super Admin. ADMIN_CASHOUT review and Admin-GCash
   Cash In review are impossible without new shop-scoped RLS plus admin-authorised review
   functions (separate from the Super-Admin-only ones, which must stay as they are).
5. **Accounting definition gaps.** ADMIN_CASHOUT is an internal 1:1 transfer, so it must
   NOT create earnings, cashback, commission or platform fee rows, and must be excluded
   from "credits removed from circulation" reporting; SUPERADMIN_CASHOUT must be included.
   Both need distinct `entry_kind` values so `reports.ts` / `role-earnings.ts` /
   `platform-earnings.ts` keep classifying correctly rather than silently folding the new
   flow into `withdrawal_hold`.
6. **Concurrency.** The Admin-balance cap for Admin-GCash Cash In must be re-checked with
   a row lock at settlement time, not only at request time — otherwise two concurrent
   auto-approvals can exceed the Admin's available credits. Duplicate-reference and
   duplicate-event protection already exist (unique event_uid, nonce table, reference
   uniqueness check) and must be preserved as-is.
7. **Listener parsing limits.** The Android app only sees notification text: amount,
   sender name and sometimes a masked sender number; GCash does not expose the reference
   number in the notification, and the receiving account is implicit (the phone that
   received it). So the reference can only ever come from the typed value plus the
   screenshot OCR — the listener cannot verify it. Sender-number masking means some real
   payments will not carry a usable number and will correctly fall through to manual.

## 3. Proposed changes (once questions are resolved)

**Schema (additive only, no backfill of financial values).**
- `cash_in_requests`: `destination` (`admin_gcash` | `superadmin_gcash`), `destination_number`,
  `destination_ecosystem_id`, `admin_balance_cap_php` snapshot. Existing rows default to
  the behaviour they were approved under so history is untouched.
- `withdrawal_requests`: `cashout_path` (`admin` | `superadmin`), defaulted to `superadmin`
  for all existing rows; `ecosystem_id` already present; `account_id` for the exact wallet
  debited; `settlement_ledger_id` for the Admin credit leg.
- `listener_devices`: `owner_role` / explicit `scope`, plus `receiving_number` so a device
  is bound to the account it watches. Existing 2 platform devices are updated to
  `scope = 'platform'` only — never unpaired, never re-keyed, secret untouched.
- New `cash_in_verification_configs` (staged rows + one `active_at`/`activated_by` row per
  scope) so adding options cannot change live behaviour. Defaults seeded to today's rules:
  Layer 1 = amount + sender number, Layer 2 = submitted reference + screenshot reference.
- New ledger `entry_kind`s: `admin_cashout_debit`, `admin_cashout_credit`,
  `superadmin_cashout_hold` (alias of existing `withdrawal_hold` semantics, kept for
  backward compatibility rather than renamed).

**Functions.**
- `request_cash_in` gains a destination argument; for `admin_gcash` it caps the amount at
  the Admin's available credits at request time. Keep the current signature working.
- `settle_cash_in_approval` re-locks the Admin wallet and re-checks the cap for
  `admin_gcash`; on failure the request stays pending with a clear reason.
- Matching (`match_listener_event`, `link_cash_in_listener_event`) selects candidate
  devices by destination + receiving number instead of the ecosystem wildcard.
- New `request_admin_cashout` / `review_admin_cashout` (shop-admin authorised, zero fee,
  atomic debit + credit inside the same shop). Existing `request_withdrawal` /
  `review_withdrawal` keep their exact current behaviour for the Super Admin path.
- `register_listener_device` extended so a shop Admin may register only within their own
  shop; Super Admin registration and the existing devices are unchanged.

**UI.** Cash In destination selector with live Admin cap; Admin cash-out queue; Admin
listener card mirroring the Super Admin card but shop-scoped; staged-vs-active verification
configuration screen with explicit "Activate" step.

## 4. Migration safety

All migrations additive with defaults chosen so current behaviour is byte-for-byte
preserved: no recalculation of balances, no rewrite of existing ledger rows, no touching of
`listener_devices.secret_key_hash`, `status`, or pairing state. Rollout in this order:
1. Wallet-scoping fix for Cash Out (multi-wallet bug) — smallest, highest risk if skipped.
2. Additive schema + RLS + reporting classification, with no behaviour change.
3. Verification config staging (read-only surface, defaults = current active rules).
4. Destination-aware Cash In + Admin balance cap.
5. Destination-aware listener matching + Admin listener registration.
6. ADMIN_CASHOUT path.
7. UI surfaces last, each behind the corresponding backend step.

## 5. Tests

SQL: Admin cash-out is 1:1 and fee-free; Super Admin cash-out deducts only the requested
amount, records the fee separately and removes credits on release; Admin-GCash Cash In
blocked above the Admin's balance including the concurrent-approval race; Super-Admin-GCash
Cash In auto-approves when active rules permit and stays pending when they do not; a
platform listener event cannot settle an Admin-destined request and vice versa; duplicate
event and duplicate reference still blocked; tenant isolation for the new tables and
policies; staged config does not alter active behaviour until activated.
Vitest: destination/cap presentation helpers, fee display for the two paths, verification
config option rendering.

## 6. Questions that must be answered before implementation

1. **Admin cash-out reviewer.** Should ADMIN_CASHOUT be approved by the shop Admin
   (receiving side) only, or auto-settle on request? Anyone else in the chain?
2. **Existing wallet ambiguity.** Fixing Cash Out to be shop-scoped changes which wallet is
   debited for the 4 multi-shop members. Confirm the requester's *acting shop* wallet is
   the correct source.
3. **Super Admin Cash Out fee source.** Should the configurable 1% reuse the existing
   platform `withdrawal_fee_percent` (currently live) or a new separate setting?
4. **Fee unit.** Fee on the peso amount (as today) or on credits?
5. **Admin cap definition.** "Admin available credits" = the Admin's shop wallet balance
   only, or balance minus pending holds/other pending Cash Ins?
6. **Admin listener registration.** May an Admin self-register and pair their own device,
   or must the Super Admin issue the pairing secret for them?
7. **Verification config scope.** Per shop, per listener device, or per destination
   account? And may an Admin activate their own config, or only stage it for Super Admin
   activation?
8. **Shop cash flow reduction.** Confirm the reduction is booked at *release* (money
   actually paid out), consistent with the current withdrawal lifecycle, not at request.
