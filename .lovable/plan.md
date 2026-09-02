# Universe Shop architecture — second validation report (design only, nothing changed)

Verified against the live schema and function bodies this session. No code, schema, data or settings were modified.

## 1. Confirmed architecture (one sentence per pillar)

- Shop kind stays the single switch: `ecosystems.shop_kind` gains a third value `universe` (legacy rows migrate `legacy → universe`; `subscription` = New Generation, untouched).
- One Universe wallet per member = the existing `credit_accounts` row with `ecosystem_id NULL` (`ensure_global_wallet`). Universe shops never own member wallets again.
- Sales in a Universe shop debit the buyer's global wallet, but every sale row still carries `ecosystem_id` = the selling shop, so cashback, points, audit and reports keep working per shop.
- Products stay ecosystem-owned. A new `shop_seller_authorizations` link (shop → member) is what makes a member an "authorized Universe seller"; the storefront is that member's public profile plus their curated product list.
- Platform fee is additive and snapshotted per product at publish and per order at creation; it is a separate ledger entry to a platform fee table, never part of the cashback pool.
- All Cash-on-Hand protection uses the ledger pattern the system already uses everywhere for holds: an immediate debit with `entry_kind` `*_hold`, a pointer on the order (`reserve_ledger_id`), and an offsetting `*_return` credit or a settlement transfer. No new "held" column, no escrow account.

## 2. Existing components reusable as-is

- `credit_accounts` / `credit_ledger` / `apply_credit_entry` / `block_ledger_mutation` / `track_credit_lots` (already isolates the NULL-ecosystem lot pool via `coalesce(ecosystem_id, nil-uuid)`).
- `ensure_global_wallet`, `new_tx_id`, `audit_logs`, `log_operator_action`, `notify_member`, financial notification triggers.
- `guard_shop_kind_ledger` (returns early for NULL ecosystem; blocks shop transfers on `subscription`).
- Cashback engine: `member_cashback_rate`, `cashback_chain`, `sale_commissions`, `reverse_sale_commission`, `admin_sale_commission_rate_for`, `voucher_discount_percent_for`.
- Rewards: `points_accounts` (NOT NULL ecosystem = already shop-scoped), `apply_points_entry`, `set_points_rule`, `reverse_sale_points`, `reward_products`, `reward_redemptions`.
- Retail: `retail_products` (`published`, `active`, `archived`, `public_visible`), `retail_order_items` price snapshot, `retail_catalog_templates`, `retail_product_ratings`, all `components/retail/*`, `store-settings-card.tsx`, `RETAIL_VISIBLE` flag and its 8 usages.
- Public read RPCs `list_public_shops`, `public_shop_overview/products/reviews` and the `/shop/$slug` route (already hierarchy-free).
- Universe shell, `member-directory.tsx` search pattern, `universe.u.$handle.tsx`, `search_universe_members`.
- Withdrawal hold pattern (`request_withdrawal` → `withdrawal_hold` debit; `cancel_withdrawal`/`review_withdrawal` → `withdrawal_return` credit; `reserve_ledger_id/refund_ledger_id/settlement_ledger_id`) as the template for every new reservation.
- Fee bookkeeping pattern: `shop_transfer_fees` row + `platformNetEarnings()` + `super-earnings-panel.tsx`.
- Signup: `handle_new_user` global path, `landingForMemberships`, `/start-shop` shell, ShopFinder for New Generation.

## 3. Components requiring modification

| Component | Change |
|---|---|
| `ecosystems.shop_kind` CHECK | add `'universe'` |
| `purchase_voucher`, `purchase_voucher_with_points` | wallet resolution: if selling shop is `universe` → buyer's global wallet, no membership requirement; keep everything else |
| `retail_place_order`, `retail_review_order`, `cancel_retail_order` | same wallet branch; add seller_id, fee/delivery snapshot, collector/delivery fields, new statuses (later phase) |
| `transfer_credits` | resolve wallet by context: Universe context → global wallet, recipient = any Universe member; New Generation context unchanged |
| `transfer_credits_between_shops` | refuse when either side is `universe` (global wallet is no longer "in transit" but the destination itself) |
| `guard_shop_kind_ledger` | add: `universe` shops may not receive shop-scoped wallet rows for members (only sale/fee rows carry ecosystem_id) — see §20 |
| `member_shop_wallets`, `my_shop_wallets`, `ensure_membership_wallets` trigger | skip wallet creation for `universe` memberships; expose the global wallet in wallet centre |
| `list_public_shops`, `public_shop_products` | include `universe` kind, respect seller curation |
| `create_review_shop` / new `create_universe_shop` | branch: Universe shop creation has no review period, no Shop ID, no subscription rows |
| `src/lib/auth.ts` `loadAuthContext`, `session.ts` | add a "Universe context" (ecosystemId null → global wallet), landing rule for `universe` members |
| `src/lib/navigation.ts`, `features.ts` | `RETAIL_VISIBLE` → true (gated by `store_retail_enabled` + `published` per product, which already exists) |
| `super-earnings-panel.tsx`, `role-earnings.ts` | add "Universe platform fees" line |
| Copy in `guide.tsx`, `universe.shops.tsx`, `index.tsx`, wallet pages | terminology (phase 9) |

## 4. Components genuinely new

- `shop_seller_authorizations` table + RPCs (`authorize_seller`, `revoke_seller`, `my_seller_shops`).
- `seller_storefronts` (per seller settings: colors, vacation mode, vacation exceptions) and `seller_storefront_items` (curated product order/visibility per seller).
- `platform_fee_ledger` table (per-order fee snapshot: percent, amount, hold/settle/return ledger ids) — the retail analogue of `shop_transfer_fees`.
- `retail_products` pricing columns: `seller_cut`, `platform_fee_percent_snapshot`, `platform_fee_amount`, `retail_price`, `cashback_mode` (`percent|fixed|disabled`), `cashback_value`.
- `retail_orders` columns: `seller_id`, `collector_id`, `delivery_person_id`, `delivery_mode` (`self|assigned`), `delivery_fee`, `delivery_fee_collector_share`, `delivery_fee_delivery_share`, `platform_fee_percent`, `platform_fee_amount`, `seller_cut_total`, `collector_reserve_ledger_id`, `seller_fee_hold_ledger_id`, settlement pointers, confirmation timestamps.
- `universe_wallet_consolidations` table + `consolidate_legacy_wallet(_user, _ecosystem, _dry_run)` RPC.
- Discovery RPCs: `search_universe_shops`, `search_universe_products`, `sellers_for_shop`, `seller_storefront(handle)`.
- Frontend: Universe search page, seller storefront route (`/universe/u/$handle/shop`), seller storefront editor, Universe shop creation wizard, order collector/delivery assignment UI, pure pricing helper `src/lib/universe-pricing.ts` with tests.

## 5. Proposed DB changes (summary, no migration yet)

Additive only — no column drops, no row deletes:
1. `ALTER` `shop_kind` CHECK to include `universe`; data update `legacy → universe` for the 4 legacy shops (including DEMO — Preview Shop, `is_review=false` so the ledger guard does not block it).
2. New tables listed in §4, each with GRANTs + RLS (seller sees own authorizations/storefront; public SELECT limited to published, non-vacation items through RPCs).
3. New nullable columns on `retail_products`, `retail_orders` (defaults keep existing rows valid).
4. New `entry_kind` values (free text today, so no constraint change): `universe_consolidation_out/in`, `cash_on_hand_reserve`, `cash_on_hand_return`, `cash_on_hand_settle`, `platform_fee_hold`, `platform_fee_return`, `platform_fee_settle`, `delivery_fee_payout`, `retail_cashback`.
5. `points_accounts` unchanged (shop-scoped by design).

## 6. Proposed RPC/function changes — see §3/§4. Every money-moving RPC stays `SECURITY DEFINER`, validates caller via `effective_uid()`/`assert_actor_active()`, and branches on `shop_kind` at the top.

## 7. Proposed frontend changes — see §3/§4. Nothing in New Generation consoles changes except shared components reading the new wallet context.

## 8. Universe wallet architecture

- Wallet = `credit_accounts (user_id, ecosystem_id NULL)`. Balance stored, ledger immutable, lots FIFO within the NULL pool — all already true.
- Wallet resolution rule (server-side helper `wallet_for(_user, _ecosystem)`): `subscription` shop → shop wallet (unchanged); `universe` shop or no shop → global wallet.
- Points remain `(user, shop)`; a Universe buyer earns points in the selling shop's points account (auto-created), which also keeps rewards shop-specific with zero change to the rules engine. Flag: a buyer who never joined the shop will still get a `points_accounts` row there — acceptable? (§24-4)

## 9. Legacy consolidation strategy

- One RPC `consolidate_legacy_wallet(_user_id, _ecosystem_id, _dry_run boolean)`, Super Admin only, per (member, shop): locks both accounts, inserts `debit` on the shop wallet (`universe_consolidation_out`) and `credit` on the global wallet (`universe_consolidation_in`) with one `tx_id`, writes a `universe_wallet_consolidations` row (`UNIQUE (user_id, ecosystem_id)` = duplicate protection), audit log, notification. Dry run returns the plan without inserting.
- Lots: `track_credit_lots` will classify the incoming credit as `system` (actor = super admin path). Provenance therefore resets at consolidation — consistent with the existing "customer → upline lineage reset" rule; this must be an explicit approval (§24-2).
- Blockers per wallet (same style as `ecosystem_cleanup_check`): pending withdrawals, pending cash-ins, pending retail credit orders, frozen shop.
- Reconciliation: `sum(balance)` of legacy shop wallets before = `sum(global credits)` after, per user and total (today: 87,343.72 across 4 legacy shops, 1,000 already global); shop wallet rows remain at 0.00 for the `balance_after` chain.
- Reversibility: a mirrored `reverse_consolidation` RPC, allowed only while the global wallet still holds ≥ the consolidated amount and no Universe spend has occurred (same guard style as `freeze_credit_purchase_order`).
- Ordering: multi-shop users (6 today, one with 3 legacy wallets) are consolidated shop by shop; DEMO — Preview Shop (all zero balances) still gets rows for completeness.

## 10. Cashback attribution architecture

Verified fact that changes the design: today cashback is **provenance-based**, not seller-based. `purchase_voucher` reads `credit_lot_consumptions` for the buyer's debit and pays `cashback_chain(lot.source_user_id, shop)` — i.e. the reseller who *loaded* the coins earns, the shop admin takes the remainder, and there is no "sold by" parameter anywhere.

Under a portable wallet with provenance reset (§9) most lots become `system`, so the provenance path would pay 100% to the shop admin. To honour "seller storefront → seller earns", Universe sales need an explicit seller: `seller_id` on `voucher_sales`/`retail_orders`, set from the storefront the buyer used, validated against `shop_seller_authorizations`. The split then calls the **same** `cashback_chain(seller_id, selling_shop)` (seller's rate, parent upline remainder, admin remainder), so the hierarchy and rates are untouched. Buying directly from the shop page (no seller) → `cashback_chain` with no source → admin 100%, exactly like today's customer-loaded coins.
This is a change of attribution source (lot provenance → storefront seller) for Universe shops only. It must be approved explicitly (§24-1). New Generation keeps provenance attribution unchanged.

## 11. Product authorization / seller architecture

- `shop_seller_authorizations (ecosystem_id, seller_id, authorized_by, status, created_at, revoked_at)`; created automatically for existing active reseller/subreseller memberships of Universe shops (they are already "authorized according to existing shop rules"), manually thereafter by the shop admin.
- Seller never owns inventory: voucher codes are still consumed from `voucher_codes` of the shop; retail stock from `retail_products.stock`.
- Public surface exposes only: seller handle/name/avatar, shop name, products. Roles, `reseller_id`, rates never leave the DB (`sellers_for_shop` projects only identity columns, same discipline as `universe.u.$handle`).

## 12. Retail architecture

Unhide, do not rebuild: flip `RETAIL_VISIBLE`, keep `store_retail_enabled` per shop and `published/active/archived/public_visible` per product as the visibility gates. Sagada Wave's 175 products are `published`-gated already; verify before flipping (dry query, no change). Order status expansion deferred as instructed; the new columns in §4 are nullable so today's 4-state flow keeps working until the state machine is approved.

## 13. Retail cashback architecture

- Per product: `cashback_mode` + `cashback_value`; snapshot onto `retail_order_items` (`cashback_mode`, `cashback_value`, `cashback_amount`) at order creation; paid at settlement as `retail_cashback` credit with a `sale_commissions`-style audit row (new `retail_commissions` or widen `sale_commissions.sale_id` to allow order ids — recommend a separate table to keep the `voucher_sales` FK intact).
- Recipient: the order's `seller_id` (storefront seller) through `cashback_chain(seller_id, shop)` so upline/admin remainder rules still apply; no seller → nothing to distribute (seller-side amount stays with the shop admin as the sale itself). This reuses the hierarchy; it does not invent one. Needs approval (§24-1, §24-5).

## 14. Platform-fee architecture

- `platform_settings.universe_platform_fee_percent` (Super Admin RPC `set_universe_platform_fee`).
- Product publish: `retail_price = seller_cut + round(seller_cut × pct/100, 2)`; store all four values. Later fee changes never touch published rows; seller sees a "republish to apply new fee" hint.
- Order creation: copy `platform_fee_percent/amount` per item into `retail_order_items`; totals on `retail_orders`. Customer UI shows only `retail_price` and delivery fee.
- Settlement: debit the fee from the party holding the coin value (see §15) as `platform_fee_settle`, insert `platform_fee_ledger` row; Super Admin earnings panel sums that table. Open point: today fees leave circulation and are only counted in fee tables (no coins are credited to any platform account). Keep that pattern, or credit the Super Admin's global wallet? (§24-3)
- Voucher products in Universe shops: same additive model via `voucher_products.seller_cut`/`platform_fee_*` columns, or vouchers stay fee-free? (§24-6)

## 15. Cash-on-Hand reservation architecture

`retail_orders.credit_hold_tx` is **not** a hold: it is an immediate full debit at order time with no release path in `retail_place_order` (refund only on reject/cancel). It cannot represent a collector reservation. Recommended, existing-compatible mechanism:
- Reservation = immediate debit on the collector's global wallet, `entry_kind cash_on_hand_reserve`, id stored in `retail_orders.collector_reserve_ledger_id`. `apply_credit_entry` already rejects insufficient balance atomically (`FOR UPDATE`), giving the backend eligibility check (available ≥ full order amount) for free.
- Cancel/reject → `cash_on_hand_return` credit, `refund_ledger_id`.
- Settlement → the reserved value moves: collector debit already happened; credit seller `seller_cut_total` (+ delivery share), platform fee settles per §14, delivery shares per §18, all in one transaction with one `tx_id`.
- Seller-handles-everything orders (no collector): reservation is only the platform fee on the seller's global wallet (`platform_fee_hold`) — the seller cannot accept a cash order without ≥ fee available.

## 16. Collector architecture

- `retail_orders.collector_id` (any Universe member with a global wallet; no membership check), assigned by the seller via `assign_collector(order, member)`; the RPC performs the reservation of §15 and refuses if the collector's available balance < order total.
- Re-assignment = return old reservation, create new one, both audited.

## 17. Delivery-person architecture

- `retail_orders.delivery_person_id` (any Universe member) + `delivery_mode` (`self` | `assigned`), assigned by seller via `assign_delivery_person`. No reservation needed for the delivery person. Same member may be collector and delivery person; both columns are always filled independently.

## 18. Delivery-fee allocation architecture

- `ecosystems`/`seller_storefronts`: `delivery_fee_type` (`fixed|percent`), `delivery_fee_value`, `pickup_enabled`, `delivery_enabled` (the latter two exist as `retail_pickup_enabled/retail_delivery_enabled`).
- Snapshot on order: `delivery_fee`, `delivery_fee_collector_share` (10%), `delivery_fee_delivery_share` (90%), `delivery_fee_seller_share` (100% when `self`). Percentages as `platform_settings` values, not hard-coded.
- Paid at settlement as `delivery_fee_payout` credits to each party's global wallet; if one member holds both roles they receive both shares (sum = 100).

## 19. Confirmation/settlement architecture (recommendation only)

- Settlement is one RPC `settle_retail_order(order)`, idempotent via `settled_at IS NULL` check under row lock, writing every ledger row under one `tx_id`: collector reserve consumed → seller cut, platform fee settle, delivery shares, retail cashback via `cashback_chain`, points earn (`entry_type earn`, unique per sale id already enforced), audit rows.
- Pre-conditions (all server-checked): required confirmations present (`delivered_at`/`received_at`/`payment_received_at` as applicable), reservations still present, no prior settlement, order not cancelled.
- If the chain is incomplete nothing moves; reservations remain in place indefinitely until settle or cancel. State machine itself to be proposed separately.

## 20. New Generation isolation safeguards

Verified today: `guard_shop_kind_ledger` already blocks `shop_transfer_in/out` on `subscription` ecosystems, so New Generation coins cannot reach the global transit wallet; `transfer_credits_in_shop` restricts recipients to members of the same shop; `transfer_credits_between_shops` requires membership on both sides. Additions:
- Every new RPC starts with `if shop_kind <> 'universe' then raise` (or the reverse for legacy-only paths).
- `wallet_for()` never returns a `subscription` shop wallet for a Universe operation and never returns the global wallet for a `subscription` shop.
- Consolidation RPC hard-refuses `shop_kind = 'subscription'`.
- `transfer_credits_between_shops` refuses `universe` on either side, closing the only path that could mix global and shop wallets.
- Regression SQL tests under `supabase/tests/` for each guard (pattern already used, e.g. `shop-switch-authorization.sql`).
No New Generation behaviour change is required.

## 21. Signup architecture

Minimum change: `index.tsx` makes "Sign up → Universe" the default (global `handle_new_user` path already exists), moves Shop ID entry under "Join a New Generation shop"; `landingForMemberships` treats `universe` memberships as Universe-first (land on `/universe`, shop consoles reachable from My Shops); `/join/$slug` keeps working for New Generation only and redirects Universe-shop slugs to the shop's Universe storefront. `handle_new_user` unchanged.

## 22. Cleanup plan (last phase, only after everything above is live)

KEEP: Universe, @handle, Shop ID (New Generation), Omada/portal, cash-in/out wording. MODIFY: guide "Legacy vs Subscription" card, wallet "per shop" copy, `universe.shops.tsx` empty state, `index.tsx` signup copy, transit wording in `shop-transfer-card.tsx`. REMOVE when proven unused: `admin.signup-link.tsx` for Universe shops, "Legacy Shop" filter labels in `super.shops.tsx`/`super.subscriptions.tsx`, `isLegacyShop` helper. NEW GENERATION ONLY: isolation copy, Shop ID join, Go Live/subscription cards. HISTORICAL — NEVER DELETE: `shop_kind='legacy'` history in audit rows, `slug`, `signup_token`, all ledger/sales/commission rows, zeroed shop wallet rows, retired `commission_rate_for`.

## 23. Risks

- Attribution switch (provenance → storefront seller) changes who earns on Universe sales; without explicit sign-off resellers may see different cashback than today.
- Consolidation resets lot provenance; any unspent reseller-sourced lots stop earning for that reseller.
- Unhiding retail exposes 175 real products; publication flags must be audited first.
- Settlement RPC size: many ledger rows in one transaction — must be tested for the insufficient-balance abort path (whole transaction rolls back, which is the desired behaviour).
- `auth.ts` reads `profiles.ecosystem_id`, not `active_ecosystem_id`; the Universe context must be added carefully or multi-shop legacy users may land in the wrong wallet view.
- Any new public RPC must project identity columns only; a single careless `select *` leaks hierarchy.

## 24. Conflicts / ambiguities needing human approval before implementation

1. **Cashback attribution source.** Existing = coin provenance (who loaded the coins). Spec = selling shop rules + storefront seller. Approve: Universe sales attribute to the storefront `seller_id`; direct shop-page sales → admin remainder only; New Generation unchanged.
2. **Provenance on consolidation.** Consolidated coins become `system` lots (no reseller lineage). Approve or require lot copying (more complex, and cross-shop lineage is meaningless after §24-1).
3. **Where platform fee coins go.** Existing fees leave circulation and are counted in fee tables. Approve same pattern for Universe platform fees, or credit Super Admin's global wallet.
4. **Points for non-member buyers.** A Universe buyer earns points in the selling shop's points account without membership. Approve, or restrict points to members.
5. **Retail cashback recipient.** Storefront seller through `cashback_chain`; no seller → no cashback distribution. Approve.
6. **Voucher products in Universe shops.** Apply the additive platform fee to vouchers too, or retail only.
7. **Collector settlement meaning.** On settlement the collector's reserved coins are transferred to the seller (collector keeps the physical cash). If instead the collector hands cash to the seller and the reserve is merely released, say so — the ledger design differs.
8. **Delivery share percentages** (10/90) stored in `platform_settings` and editable by Super Admin, or fixed.
9. **DEMO — Preview Shop** becomes a public Universe shop; confirm it should be discoverable, or set `public_storefront_enabled=false` on it.

## 25. Recommended implementation phases

1. Approvals for §24 + pricing/tests helper (pure TS, no schema).
2. Schema: `universe` kind, seller authorizations, storefront tables, pricing/cashback columns, fee ledger, consolidation table (all additive).
3. Wallet context: `wallet_for()`, branch `purchase_voucher*`, `transfer_credits`, `transfer_credits_between_shops` refusal, session/auth Universe context, isolation SQL tests.
4. Consolidation RPC + dry run on DEMO — Preview Shop, reconciliation report, then real shops (separate approval).
5. Seller authorizations + storefront editor + discovery RPCs/pages.
6. Retail unhide + additive pricing + platform fee snapshot + retail cashback columns (still 4-state orders).
7. Cash on Hand: collector/delivery assignment, reservations, delivery fee snapshot.
8. State machine proposal → approval → settlement RPC.
9. Signup/landing Universe-first.
10. Cleanup/terminology.

## 26. Estimated Lovable credits by phase (rough)

1: 5–10 · 2: 20–30 · 3: 35–50 · 4: 20–30 · 5: 45–65 · 6: 30–45 · 7: 35–50 · 8: 40–60 · 9: 10–20 · 10: 15–25.

Approving this report approves the architecture direction only; every phase (and each §24 item) still needs its own go-ahead before any change is made.
