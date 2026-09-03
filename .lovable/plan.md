# Retail Phase 1 — Inspection Report (no changes made)

Everything below was verified this turn by reading the code, the live database schema, function bodies, policies, triggers and row counts. Nothing was modified.

## Headline findings

1. Retail is fully hidden behind `RETAIL_VISIBLE = false` (src/lib/features.ts). Backend, tables, RPCs, routes and UI are intact and dormant.
2. Live data is effectively empty: 0 shops with retail enabled, 0 orders, 0 ratings, 0 retail ledger rows. Only 175 unpublished starter-catalog drafts exist (all in Sagada Wave One-Stop-Shop, a Universe shop). Schema changes are therefore cheap and carry no data-migration risk.
3. Two financial defects exist in the dormant code and must be fixed before any activation:
   - `retail_place_order` looks up the buyer wallet as `credit_accounts where ecosystem_id = shop` (shop-scoped). For a Universe shop this is the zeroed legacy wallet, and the `guard_shop_kind_ledger` trigger would reject the debit anyway. Coin payment in Universe shops fails safely today (no leakage), but it does not work.
   - `retail_review_order(approve)` never credits anyone. The buyer's held coins are debited at order time and, on approval, simply disappear: no ledger credit to the seller/admin, no fee, no cashback. Coins would be burned.
4. Everything else (cart maths, stock reserve/restore, order numbers, notifications, audit rows, admin/customer UI, store settings, public storefront listing, ratings) is reusable as-is or with small edits.

## (a) Current Retail map

Tables
- `retail_products`: id, ecosystem_id, name, description, image_path, price, stock, sold_count, active, archived, public_visible, published, category, brand, variant, size_label, unit, wholesale_price, wholesale_min_qty, sku, barcode, template_id. CHECKs: price >= 0, stock >= 0.
- `retail_orders`: order_no (unique), ecosystem_id, customer_id, customer_name, status (CHECK pending|approved|rejected|cancelled), fulfillment (pickup|delivery), delivery_address, delivery_notes, payment_method (cash|credit), total, credit_hold_tx, credit_released, decided_by/at, decision_note, notified_at.
- `retail_order_items`: order_id, product_id, product_name, unit_price, quantity, line_total.
- `retail_product_ratings`: per order+product, rating, comment.
- `retail_catalog_templates`: shared PH starter catalog (Super Admin managed, world-readable).
- `ecosystems` flags: store_voucher_enabled, store_retail_enabled, retail_cash_enabled, retail_credit_enabled, retail_pickup_enabled, retail_delivery_enabled, public_storefront_enabled, contact_email.

RPCs (all SECURITY DEFINER)
- `retail_place_order(eco, items, fulfillment, payment, address, notes)`: requires membership; checks store flags and `operations_frozen`; reserves stock row-by-row with `FOR UPDATE`; writes items at `price` (wholesale_price is ignored); for coin payment debits shop wallet with reason "Retail order hold", entry_kind default `general`; notifies admins; audit row.
- `retail_review_order(order, approve, note)`: admin/super only; approve bumps sold_count and marks approved; reject restores stock and refunds the hold with a new ledger credit.
- `cancel_retail_order(order)`: customer, pending only; restores stock + refunds hold.
- `list_retail_products`, `my_retail_orders`, `list_retail_orders`, `rate_retail_product`, `shop_store_settings`, `update_store_settings` (seeds catalog on first enable, enforces at least one payment method), `seed_retail_catalog`, `public_shop_products` (public storefront, kind = retail|voucher).

UI
- Admin: `/admin/retail` (StoreSettingsCard + RetailProductsCard: catalog filters, draft/publish/archive, price, wholesale, stock, image), `/admin/orders` (RetailOrdersPanel: approve/reject with note, resend email).
- Buyer: `/app/store`, `/reseller/store` (RetailStoreView: cart, pickup/delivery, cash/coins, my orders, cancel, rate).
- Public: `/shop/$slug` Retail tab.
- Server fn: `retail-notify.functions.ts` emails the shop contact.
- Pure helpers + vitest: cart maths, checkoutProblem, filterProducts, enabledStores, orderTone.

Visibility gates (product reaches a buyer only when all true): `active AND published AND NOT archived` plus membership, or `public_visible AND ecosystem.public_storefront_enabled` for the public path; store must have `store_retail_enabled`.

## (b) Reusable as-is

- All tables and the stock reserve/restore pattern (row lock, CHECK stock >= 0).
- Order numbering, audit and notification calls, decision notes, `set_updated_at` triggers.
- `wallet_id_for(user, eco)` already returns the global wallet for Universe shops and the shop wallet for New Generation; `guard_shop_kind_ledger` already blocks cross-wallet writes. These are the isolation primitives to reuse; Retail just is not calling them yet.
- `shop_seller_authorizations` + `cashback_chain(seller, eco)` + `sale_commissions` bookkeeping (voucher engine) for seller attribution.
- Withdrawal hold pattern (`reserve_ledger_id`, `settlement_ledger_id`, `refund_ledger_id`, entry_kind `withdrawal_hold`) as the template for Cash-on-Hand reserves.
- Admin and buyer UI shells, catalog filters, image pipeline, pure cart helpers and their tests.

## (c) Missing or obsolete

Missing
- Seller/admin credit on approval (coins currently vanish).
- Universe wallet routing in `retail_place_order` / refunds (uses shop-scoped lookup).
- Membership-free ordering for Universe shops (`has_membership` hard requirement; voucher engine already allows it).
- Seller attribution (`seller_id`) and authorization check.
- Fee, seller cut, cashback rule and their snapshots.
- Retail-specific `entry_kind` values (rows land as `general`, so earnings/reporting cannot classify them).
- `subscription_ok` / `frozen_at` checks (voucher path checks both; retail only checks `operations_frozen`).
- SQL tests: none under supabase/tests mention retail. Retention purge does not cover `retail_orders`.
- Reviews on public storefront (ratings RLS is members-only; acceptable, but note it).

Obsolete / misleading
- `wholesale_price` / `wholesale_min_qty` are editable but never applied at order time. Either implement tiering or hide the fields.
- "Not enough coins in this shop's wallet" copy and `retail_credit_enabled` label "Accept shop coins" (Universe shops use the global wallet).
- The 175 seeded drafts in Sagada Wave were created by an earlier toggle; harmless, but they were seeded with `price = default_price`, not a seller cut.

## (d) Exact DB changes eventually needed (all additive)

retail_products
- `seller_cut numeric(14,2) not null default 0` (canonical), keep `price` as the derived retail price for display/back-compat.
- `cashback_mode text check in ('disabled','percent','fixed') default 'disabled'`, `cashback_value numeric(14,2) default 0`.

retail_orders
- `seller_id uuid null` (storefront seller, Universe only), `fee_percent numeric(6,3)`, `fee_total`, `seller_cut_total`, `cashback_total` (all snapshotted), `wallet_account_id uuid` (which wallet was debited), `hold_ledger_id`, `settlement_ledger_id`, `refund_ledger_id` (mirrors withdrawal pattern; replaces free-text `credit_hold_tx`).
- Later phases: `delivery_fee`, `delivery_fee_mode`, `delivery_fee_value`, `collector_id`, `collector_reserve_ledger_id`, `delivery_person_id`, plus status expansion (see m).

retail_order_items
- `seller_cut`, `fee_percent`, `fee_amount`, `cashback_mode`, `cashback_value`, `cashback_amount` per line (snapshot).

Ledger
- New `entry_kind` values: `retail_hold`, `retail_refund`, `retail_settlement`, `retail_fee`, `retail_cashback` (later `retail_coh_reserve`, `retail_delivery_fee`). No CHECK exists on entry_kind today, so this is convention plus tests.
- `sale_commissions.sale_id` is FK to `voucher_sales`; retail cannot reuse it. Add a small `retail_commissions` table (order_id, recipient_id, kind, percent, amount, ledger_id) or make `sale_id` nullable and add `retail_order_id`. Recommended: separate table, zero risk to the voucher engine.

Settings
- Platform fee percent: one column on `platform_settings` (global rule, consistent with "credit rules are global").
- `retail_orders` added to `run_retention_purge` (12-month rule) or explicitly excluded as financial history.

## (e) Exact RPC/function changes

- `retail_place_order`: replace membership gate with `is_universe_shop` branch (Universe: any active member, optional `_seller_id` validated against `shop_seller_authorizations`; New Generation: membership required, seller rejected); resolve wallet via `wallet_id_for`; add `subscription_ok` and `frozen_at` checks; compute per-line seller_cut/fee/cashback snapshots from the current platform fee; write `entry_kind='retail_hold'`; store `hold_ledger_id`.
- `retail_review_order(approve)`: settle the hold: credit seller cut to the shop admin's wallet (via `wallet_id_for`), fee to the platform earnings path, cashback to recipients (see h), all in one transaction with `entry_kind` set and `settlement_ledger_id` recorded. Use `effective_uid()` consistently with the rest of the codebase.
- `cancel_retail_order` / reject path: refund via `wallet_id_for`, `entry_kind='retail_refund'`.
- `list_retail_products` / `public_shop_products`: return `price` (derived) only; never expose `seller_cut` publicly.
- New: `retail_price_preview(seller_cut)` (or pure TS helper mirrored in SQL) so UI and DB agree on rounding.
- Later: `retail_assign_collector`, `retail_advance_status`, `retail_confirm_receipt`, `retail_settle`.

## (f) Exact UI changes

- Product form: two linked inputs "Seller's cut" and "Retail price"; editing either recalculates the other using the live platform fee; show "Platform fee x% = y". Cashback mode/value inputs. Hide or implement wholesale fields.
- Store settings: rename "Accept shop coins" to "Accept WaveWallet coins"; hint text per shop kind.
- Buyer store: balance already comes from `wallet_view` (correct wallet). Show fee-inclusive price only; checkout summary shows total and cashback earned (if buyer-facing) or nothing about fees.
- Universe entry point: retail tab on seller storefronts (`/universe/u/$handle`) reusing `RetailStoreView` with `seller_id` passed through; Universe discovery cards can show "Retail" badge.
- Admin orders: show seller cut / fee / cashback breakdown on each order; "Settled" indicator.
- Flip `RETAIL_VISIBLE` last, after backend phases pass tests.

## (g) Pricing implementation and rounding

- Canonical stored value: `seller_cut` (2 dp). `retail_price = round_half_up(seller_cut * (1 + fee/100), 2)`.
- When the seller types a retail price: `seller_cut = round(retail / (1 + fee/100), 2)`, then re-derive retail from that cut and show it (may differ by 1 centavo; the UI states "adjusted to keep your cut exact").
- Order snapshot per line: `unit_price = derived retail`, `line_total = unit_price * qty`, `seller_cut_line = seller_cut * qty`, `fee_line = line_total - seller_cut_line`. Fee absorbs all rounding, so seller cut is always exact and totals always reconcile (hold = settlement + fee + cashback).
- Fee changes later never touch stored `seller_cut`; only new orders pick up the new percent. Display price recomputes live from cut + current fee.
- Use `numeric(14,2)` and Postgres `round(x, 2)` (half away from zero); TS `round2` in retail.ts uses Math.round (half up for positives) — same result for positive amounts, keep both and test equality on edge cases (0.005 boundaries, qty x price).
- Assumption to confirm at approval: the platform fee is platform (Super Admin) revenue, alongside cash-out fees and the 5-coin shop transfer fee.

## (h) Cashback integration

Current engine: on a Universe voucher sale, `cashback_chain(seller, shop)` yields recipients (storefront seller, upline) with percents from `member_cashback_rate`; the shop admin receives the remainder; entries are `sale_commission`/`upline_commission` ledger rows tied to `sale_commissions`.

Open financial question (genuine ambiguity, blocking only the cashback phase):
- Option A — buyer rebate: cashback (percent or fixed per unit) is returned to the buyer's wallet on settlement, funded from the seller cut.
- Option B — seller commission: cashback is the amount carved out of the seller cut and distributed through the existing `cashback_chain` to the storefront seller / upline, remainder to the shop admin.
Safest integration for either: snapshot mode+value+amount per line at order time, pay only at settlement (approval), never at hold, record rows in `retail_commissions` (not `sale_commissions`), reversals as new ledger rows. Option B reuses `cashback_chain` unchanged; Option A needs no chain at all. Fixed-amount cashback must be capped at the seller cut per line.

## (i) Wallet interaction (target)

- Hold: debit `wallet_id_for(buyer, shop)` -> global wallet for Universe, shop wallet for New Generation. `apply_credit_entry` already enforces non-negative balance.
- Settlement on approval: credit admin via `wallet_id_for(admin, shop)`; fee to platform; cashback per (h). All entries share one `tx_id`, `ecosystem_id = shop`, so `guard_shop_kind_ledger` validates them.
- Reject/cancel: single refund entry of the full hold, `reverses_ledger_id = hold_ledger_id`.
- Cash orders: no ledger movement at all until Cash-on-Hand phase.
- Earnings: retail settlement must be included in `admin_shop_margin`/`earnings_history` only as the admin's retained share (memory rule); requires `entry_kind` classification, hence the new kinds.

## (j) New Generation isolation safeguards

- Never look up `credit_accounts` by `ecosystem_id` directly in retail code; always `wallet_id_for`.
- `guard_shop_kind_ledger` remains the hard backstop: Universe shop rows on a shop wallet and New Generation rows on the global wallet both raise.
- Universe-only features (seller_id, membership-free ordering, storefront tab) gated by `is_universe_shop` in SQL, not the client.
- New Generation retail keeps membership requirement and shop wallet; Wallet Center history filter (`is_universe_shop`) already excludes their entries.
- SQL tests assert both branches (see o).

## (k) Future Cash-on-Hand architecture (inspect only)

Smallest safe design, mirroring `withdrawal_requests`:
- On seller acceptance of a cash order with a collector: debit collector's global wallet by order total, `entry_kind='retail_coh_reserve'`, store `collector_reserve_ledger_id`. Collector must be an active Universe member (no shop membership); insufficient balance fails the assignment.
- Collector is the buyer's counterparty for cash; on end-to-end confirmation (buyer received + collector confirms cash received + seller confirms), the reserve is consumed: seller cut to admin, fee to platform, cashback per (h), delivery fee per (l). Collector keeps the physical cash.
- No collector assigned: seller is implicitly the collector; no reserve (seller receives cash directly), only fee/cashback bookkeeping at settlement (fee debited from seller wallet or netted from a future payout — this needs a rule; flag for that phase).
- Cancellation before settlement refunds the reserve in full (`retail_refund`, reverses reserve). Disputes: freeze via existing shop freeze; corrections as reversal entries only.
- New columns on `retail_orders` only; no new tables beyond an optional `retail_order_events` log.

## (l) Future delivery architecture (inspect only)

- Shop-level settings: `delivery_fee_mode` (fixed|percent), `delivery_fee_value`; snapshot `delivery_fee` on the order.
- `delivery_person_id` nullable, any active Universe member; may equal `collector_id`.
- At settlement: 90% delivery person / 10% collector; if no delivery person (self-arranged), 100% to seller; if delivery person exists but no collector, the 10% falls to the seller (assumption; confirm in that phase).
- Delivery fee is part of the buyer's total and of the hold/reserve.

## (m) Future order state machine (do not implement yet)

```text
pending -> accepted -> preparing -> ready_for_pickup -> picked_up -> received -> settled
                               \-> out_for_delivery -> delivered -> received -> payment_received -> settled
pending|accepted|preparing -> cancelled (buyer/seller) | rejected (seller)
any pre-settled state       -> refunded (reversal entries)
```
Keep `approved` as an alias of `accepted` for compatibility. Add `retail_order_events` (order_id, from, to, actor, at, note) and a single `retail_advance_status` RPC that validates allowed transitions server-side. Terminal states: settled, rejected, cancelled, refunded.

## (n) RLS / security risks found

- Anon SELECT policy on `retail_products` returns the whole row: `wholesale_price`, `sku`, `barcode`, `stock` and later `seller_cut` would be public. Public reads should go through `public_shop_products` only, or the policy should be replaced by a column-limited view.
- `retail_review_order` and `update_store_settings` use `auth.uid()`; the rest of the app uses `effective_uid()` for impersonation. Harmless today, inconsistent for audit attribution.
- Admin product writes go straight to the table (RLS ALL). Fine, but fee/cut derivation must live in a trigger or RPC so a direct write cannot desync `price` from `seller_cut`.
- `retail_place_order` lacks `subscription_ok`/`frozen_at`; frozen shops (via `frozen_at`) could still take orders.
- `retail_product_ratings` readable by shop members only; public storefront cannot show them (acceptable).
- Ledger immutability triggers already protect retail hold/refund rows.

## (o) Testing strategy

- SQL tests (supabase/tests pattern, rolled back): Universe coin order debits global wallet and settles to admin; New Generation order debits shop wallet and never touches global; reject/cancel refunds exactly the hold; double review raises; stock never negative under concurrent orders; fee snapshot unchanged after platform fee change; rounding reconciliation `hold = cut + fee + cashback` for 50 randomized carts; seller authorization enforced; frozen/unsubscribed shop rejected.
- Vitest: pricing helpers (cut<->retail both directions, boundary rounding), cart maths already covered.
- Playwright: admin enables retail, sets cut, publishes; buyer orders with coins from a Universe storefront; admin approves; balances and history reflect it; New Generation console unchanged.
- `wallet_integrity_check` run before/after each SQL test.

## (p) Estimated Lovable credits by phase (conservative)

| Phase | Scope | Est. credits |
|---|---|---|
| R1 | Fix wallet routing via `wallet_id_for`, approval settlement to admin, retail entry_kinds, frozen/subscription checks, SQL tests | 6-9 |
| R2 | Additive pricing: seller_cut + platform fee setting, snapshots on order/items, product form linked inputs, rounding tests | 7-10 |
| R3 | Universe access: membership-free ordering, seller attribution + authorization, storefront retail tab, copy cleanup, hide/implement wholesale | 6-9 |
| R4 | Cashback per product (after the (h) decision), `retail_commissions`, settlement distribution, earnings classification | 7-11 |
| R5 | Security tightening: column-limited public reads, effective_uid consistency, retention coverage, flip `RETAIL_VISIBLE` | 3-5 |
| Later | Order state machine + events table | 8-12 |
| Later | Delivery fee + delivery person split | 6-9 |
| Later | Cash on Hand reserves + end-to-end settlement | 10-15 |

Cheapest safe path: R1 first (it only touches the two RPCs and adds tests), then R2, then R3. Nothing in R1-R3 changes Universe voucher, wallet, social, or New Generation behaviour; all changes are additive columns and retail-only functions.

## Open question before the cashback phase

Is retail cashback a buyer rebate (Option A) or a seller/upline commission paid through the existing cashback chain (Option B)? Phases R1-R3 do not depend on the answer.
