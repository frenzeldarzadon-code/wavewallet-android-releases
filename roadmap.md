# Roadmap

- [x] Universe hamburger → Friends (Friends / Find Friends / Following) — `/universe/friends`
- [x] Messages → Online people section (reuse member_presence via `universe_online_members`)
- [x] Retail order chat linked into Messages (existing `dm_threads.kind='order'`, labelled via `dm_order_chat_context`)
- [x] Typecheck, lint, unit tests
- [ ] Demo-authenticated browser walkthrough (blocked: browser auth signed out; SQL console is `supabase_read_only_user` with no RPC execute)
- [x] Remove Universe post audience system (composer selector + backend visibility filtering); all posts public in Universe; NG isolation untouched
- [x] Retire per-shop post hiding: feed/RLS/visibility helpers ignore `social_post_shop_hides`; hide RPC refuses; UI controls removed. Verified via rolled-back simulation of 7 demo/test accounts (all saw the same posts despite a hide record).
- [x] Universe → Friends → 4th subtab "Friend Requests" (incoming Accept/Decline + sent requests), pending badge on Requests tab and on the Friends menu item; friend-request alert now opens that tab.

- [x] Universe → My Wallet: Cash In / Cash Out / Gift reconnected to existing money flows (`wallet_scope=universe`, global wallet, 1% platform fee, Super Admin review/release). Test: `supabase/tests/universe-wallet-cash-in-out.sql`.
- [x] Payment listener redesign: listener devices capture ALL supported payment notifications (no per-account pairing); receipt vs notification ≥2 independent matches; duplicate-credited receipt → disapproved; blurry/mismatch → manual review; Super Admin UI wording; tests

- [x] Cash In sender/receiver semantics + full receipt/notification extraction: receiver-side notifications without a payer number no longer block approval; payer-name identity signal now links events; semantic SQL test passes (rolled back).

- [x] Listener source detection + Super Admin source blocklist (read all notifications, channel/category capture, detected-sources card with Block/Unblock, audited rules)

- [x] Consolidated final audit of payment listener + Cash In: receiving-account gate test fixed & passing (9/9); older suites (no-pairing, two-signal, payment-first, semantics) aligned with final rules (receipt read first, receiver evidence required, credited duplicates refused at submission); provider-neutral Super Admin/go-live wording; typecheck + 1,422 unit tests pass. Not published.

- [ ] Admin Cancel Order before customer receipt (retail): new RPC `admin_cancel_retail_order(_order_id, _reason)` reusing `retail_refund_hold` (idempotent hold refund), stock restore, COD hold release via `retail_cod_cancel_internal`, notification to customer; allowed for status=pending or approved with fulfillment_status in (accepted, preparing, ready, out_for_delivery, delivered); refused once fulfillment_status='completed' (customer received) or already rejected/cancelled/closed. Record decided_by/decided_at/decision_note + previous status. Block `retail_update_fulfillment` on cancelled orders. UI: Cancel Order + confirm dialog in `retail-orders-panel.tsx`; customer wording "The shop cancelled this order" in `retail.ts`. Tests: SQL per stage (new/prepare/ready/in delivery/delivered/completed) + cancelled→delivered/completed blocked.
  Investigation so far: `cancel_retail_order` is customer-only + pending-only; `retail_review_order` settles credit orders at approval (settlement/cashback ledger rows exist post-approval, so `retail_refund_hold` returns null once `settlement_ledger_id` is set → post-approval refund needs reversal entries of settlement + cashback, not a hold refund); need to read `retail_update_fulfillment`, `retail_cod_seller_cancel`, `retail_cod_cancel_internal`, `retail_orders_guard` next.

## Points from actual net spend (Universe)
- [x] Voucher purchase points from buyer_charge; credits_basis = net
- [x] Universe retail orders award points at settlement, idempotent
- [x] Reversals remove exactly awarded points
- [x] Tests (supabase/tests/points-net-spend.sql)

## Centralized My Wallet + Coin Loans
- [x] Coin loan settings in Super Admin money/platform settings (enabled, base 1000, 3x multiplier, 2% monthly, first-month-upfront)
- [x] `coin_loans` / `coin_loan_entries` + restricted portion on `credit_accounts`; RLS, grants, integrity constraint
- [x] Server-side restriction guard on every ledger debit (transfers/gifts/cash out blocked; affiliated purchases allowed)
- [x] Auto limit = greater of base and multiplier x free balance, computed server-side
- [x] Upfront first-month interest, manual approval above the limit, one active loan, idempotent monthly accrual
- [x] Top-up repayment priority via ledger trigger
- [x] Loan section in Universe → My Wallet; Super Admin settings + approval queue
- [x] Legacy /app, /app/money, /reseller/wallet, /reseller/money, /admin/wallet redirect to /universe/wallet (NG shops keep their isolated screen)
- [x] Tests: `src/lib/coin-loans.test.ts`, `supabase/tests/coin-loans.sql` (rolled back), typecheck, 1479 unit tests
- [x] Daily scheduled interest run (`coin-loan-interest`, 02:20)

## Mobile usability
- [x] Universe mobile menu uses a viewport-bound scroll area with safe-area padding, keeping Sign out reachable.
- [x] Universe voucher checkout keeps its confirmation actions visible above the mobile keyboard.
