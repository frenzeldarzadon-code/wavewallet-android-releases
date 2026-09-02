# Legacy → Universe Shop transition: inspection report (no changes made)

Inspection only. Nothing was modified: no code, schema, RPCs, data, or settings.

## 0. Headline findings (read these first)

1. **"Legacy Shop" is not one shop.** `ecosystems.shop_kind` is the single source of truth (`legacy` | `subscription`). There are **4 legacy shops** (Sagada Wave One-Stop-Shop 38 members / ₱54,840 coins, Lenas Giga Surf 8 / ₱22,504, Guesang GigaFlex 4 / ₱10,000, DEMO — Preview Shop 4 / ₱0, frozen test) and **2 New Generation shops** (SW DEMO 6541876, One Wave PH 3201846). Six users already hold wallets in 2–3 legacy shops (one holds 42,890 + 21,251 + 9,967). The plan must say whether all legacy shops become Universe shops, or only Sagada Wave.
2. **A global "Universe wallet" already exists in the schema.** `credit_accounts.ecosystem_id` is nullable; `ensure_global_wallet(uid)` creates a per-user row with `ecosystem_id = NULL` (unique on `user_id, coalesce(ecosystem_id, zero-uuid)`). Today it is only a transit wallet for shop-to-shop transfers and the target for shop-less Super Admin issuance (1 row, 1,000 coins). Consolidating legacy balances into it is a ledger move, not a schema change.
3. **Purchases are membership-gated in the database, not just the UI.** `purchase_voucher` requires `profiles.ecosystem_id` and active membership in the product's ecosystem; `retail_place_order` raises "Join this shop before ordering". `transfer_credits` raises "Your account is not part of a shop". These RPCs are what prevent buying without joining.
4. **Cashback follows credit provenance, keyed per shop.** `credit_lots` / `credit_lot_consumptions` are per `(user, ecosystem)`; `cashback_chain`, `member_cashback_rate` read rates from `ecosystem_memberships` per shop. A single Universe wallet breaks the assumption "the coins spent in shop X were loaded in shop X". This is the biggest design decision, not a code detail.
5. **There is no per-sale platform fee today.** Cashback split is `subreseller + parent upline + admin remainder = 100%`, with `admin_share = 100 − parent_total`. Platform earnings are only cash-out fee %, cash-in fee % (0), and the flat 5-coin shop transfer fee. Your spec's example (20/10/69/1) conflicts with your own additive pricing model (fee on top of seller's cut): under the additive model the seller's cut still splits 20/10/70 and the platform fee is a separate 1% line. Please confirm which.
6. **Retail lifecycle is far shorter than the spec.** `retail_orders.status` is only `pending | approved | rejected | cancelled`; no processing/delivered/confirm-receipt/settlement, no delivery fee, no commissions on retail. Retail is hidden by `RETAIL_VISIBLE = false` but fully wired (175 products in Sagada Wave, DB + RPCs + UI intact).
7. **Points are strictly shop-scoped already** (`points_accounts.ecosystem_id NOT NULL`, ratio `ecosystems.credits_per_point`, rule version snapshotted per earn). Rewards can stay shop-specific with no change if Universe sales still record a `voucher_sales.ecosystem_id`.
8. **Signup already supports zero-shop entry.** `/` signup without a Shop ID → `handle_new_user` global path (`profiles.ecosystem_id = NULL`) → `/universe`. Shop ID is only mandatory on the "join" path and on `/join/$slug` (legacy slug links). Making Universe the default is mostly UI ordering/copy, not backend.

## 1. What exists today (map)

| Area | Tables | Functions / RPCs | Frontend |
|---|---|---|---|
| Shop kind | `ecosystems.shop_kind`, `shop_code` (new-gen only), `slug`+`signup_token` (legacy links) | `find_shop_by_code`, `join_shop_by_code`, `shops_in_municipality`, `get_signup_ecosystem` | `lib/go-live.ts` (`isLegacyShop`/`isNewGenerationShop`), `lib/shop-status.ts`, `super.shops.tsx` filters |
| Membership | `ecosystem_memberships` (role, reseller_id, per-member rates, membership_state), `membership_applications`, `ecosystem_invitations`, `profiles.active_ecosystem_id` | `handle_new_user`, `auto_process_membership_application`, `switch_ecosystem`, `my_memberships`, `effective_uid`, `ensure_membership_wallets` (trigger-guaranteed wallet per membership) | `lib/session.ts` (`landingForMemberships`), `universe.shops.tsx`, `index.tsx` ShopFinder |
| Identity | `profiles` (global, unique `handle`), `member_social_links` | `search_universe_members`, `fetchUniverseProfile` | `universe.u.$handle.tsx` (name/handle/avatar/bio/posts only) |
| Universe | `social_posts`, `dm_*`, `social_follows/friendships` | `list_public_shops`, `public_shop_overview/products/reviews` (used by `/shop/$slug`, not Universe nav) | `universe.*.tsx`, `components/universe/*`. **No product discovery, no shop search inside Universe.** |
| Voucher products | `voucher_products` (ecosystem-owned, no seller user_id), `voucher_codes`, `voucher_imports`, `voucher_sales` (full price/commission snapshot) | `purchase_voucher`, `purchase_voucher_with_points`, `refund_voucher_sale`, `delete_voucher_*` | `admin.vouchers.tsx`, `admin.products.tsx`, `app.shop.tsx`, portal |
| Retail | `retail_products` (price, wholesale, stock, published, public_visible, category text), `retail_orders`, `retail_order_items` (name/price snapshot), `retail_catalog_templates`, `retail_product_ratings` | `retail_place_order`, `retail_review_order`, `cancel_retail_order`, `list_retail_*`, `seed_retail_catalog` | `components/retail/*`, `store-settings-card.tsx`, `admin.retail.tsx`, `app.store.tsx`, `shop.$slug.tsx` |
| Wallets / ledger | `credit_accounts` (stored balance, `ecosystem_id` nullable), `credit_ledger` (immutable via `block_ledger_mutation`, `entry_kind` free text), `credit_lots`, `credit_lot_consumptions`, `credit_transfer_reversals` | `apply_credit_entry` (BEFORE INSERT, FOR UPDATE), `track_credit_lots`, `transfer_credits(_in_shop)`, `transfer_credits_between_shops`, `reverse_credit_transfer`, `ensure_global_wallet` | `components/wallet/wallet-center.tsx`, `lib/wallet.ts` (21 RPCs) |
| Holds | Points: `points_ledger.entry_type hold/release/claim`, `points_accounts.held`. Credits: no generic hold kind; reserve/settle/refund ledger pointers on `withdrawal_requests`, `credit_purchase_orders`, `retail_orders.credit_hold_tx` (actually a full debit refunded on reject) | `apply_points_entry`, `cancel_withdrawal`, `cancel_retail_order` | — |
| Cashback | rates: `platform_settings.cashback_*`, `ecosystems.default_*_percent`, `ecosystem_memberships.sale_commission_percent`; audit: `sale_commissions (kind sale_cashback/upline/admin)` | `member_cashback_rate`, `cashback_chain`, `cashback_split_preview`, `admin_sale_commission_rate_for`, `reverse_sale_commission` | `cashback-rate-dialog.tsx`, earnings panels |
| Rewards | `points_accounts`, `points_ledger`, `reward_products`, `reward_redemptions`, `ecosystems.credits_per_point` | `apply_points_entry`, `set_points_rule`, `reverse_sale_points` | `app.rewards.tsx`, `admin.rewards.tsx` |
| Payments | `payment_methods` (shop or platform scope), `cash_in_requests`, `verified_payments`, `withdrawal_requests` (fee snapshot) | cash-in matching suite, withdrawal RPCs | money/* components |
| Platform earnings | `shop_transfer_fees`, `withdrawal_requests.fee_*`, `cash_in_requests.fee_*`, `platform_credit_issuances` (supply, not revenue) | `earnings_history`, `platformNetEarnings()` | `super-earnings-panel.tsx` |

## 2. What blocks the Legacy → Universe concept today

- `purchase_voucher`, `retail_place_order`, `transfer_credits` all require shop membership / `profiles.ecosystem_id`.
- Products are owned by an ecosystem; there is no seller identity on a product, so "visit a seller's profile and see their products" has no data path. Sellers today = shop admins (resellers only resell voucher codes from the shop's inventory, they do not own products).
- Cashback lots and rates are per shop; a portable wallet needs a provenance rule for coins that cross shops.
- Universe has member search only; no shop/product search, no storefront linked from Universe. `/shop/$slug` public storefront exists but is legacy-slug based and gated by `public_storefront_enabled`.
- `landingForMemberships` sends single-shop members straight into their shop console; Universe-first entry means changing the landing rule for legacy members.

## 3. New Generation isolation (what must not move)

Distinguisher: `shop_kind = 'subscription'` + `shop_code`. Existing guards already keyed on it: `guard_shop_kind_ledger` trigger on `credit_ledger`, `isNewGenerationShop()`, `shop-status.ts`, `subscription-shops.ts`. Everything in this plan should branch on `shop_kind` at the RPC level so new-gen wallets, memberships, Shop ID joining and transaction isolation are untouched. **No new-gen change appears technically necessary.** One risk: `transfer_credits_between_shops` already lets a member move coins new-gen → global → new-gen; if legacy wallets consolidate into the global wallet, that transit wallet must not become a leak path between new-gen shops and Universe without the fee rules you intend.

## 4. Universe shops (multiple public shops per member)

Exists: `create_review_shop` (`/start-shop`) already lets a signed-in member create a shop, but it always creates `shop_kind='subscription'` with review period/subscription. Shop type toggles exist (`store_voucher_enabled`, `store_retail_enabled`). Missing: a "Universe shop" kind (a third `shop_kind` value or a new flag), creation flow without subscription/Shop ID, and ownership of several public shops per profile (memberships already allow several admin roles per user, so the data model supports it).

## 5. Public seller discovery — reuse assessment

Reusable: `list_public_shops` / `public_shop_*` RPCs (already hide members, wallets, hierarchy), `shop.$slug.tsx` storefront, `member-directory.tsx` search pattern, `retail_products.public_visible`, `RatingStars`, `universe.u.$handle.tsx` (identity only, no roles exposed — matches the "no hierarchy" rule). Missing: product search RPC across shops, seller → products link on profile, category ordering/colors (`retail_products` has no `sort_order`/color), vacation mode (only blunt `store_retail_enabled` toggle), Universe nav entries.

## 6. Universe wallet — migration feasibility

- Balances are stored columns kept in sync by triggers; ledger is immutable. A consolidation = one debit row per legacy shop wallet + one credit row on the global wallet, same `tx_id`, new `entry_kind` (e.g. `universe_consolidation`). Historical rows stay untouched; `balance_after` chain remains valid per account. This is safe and reversible by the same mechanism.
- Must decide first: (a) which shops consolidate (Sagada only vs all legacy), (b) what happens to `credit_lots.remaining` (provenance) on consolidated coins — copy lots to `ecosystem_id NULL`, or treat consolidated coins as "no lineage" (like the existing customer→upline reset rule), (c) demo/test shop excluded, (d) withdrawal holds and pending cash-ins in flight are blockers (same pattern as `ecosystem_cleanup_check`).
- `points_accounts` cannot go global (NOT NULL) — fine, rewards stay per shop.
- `guard_shop_kind_ledger` and `transfer_credits` need to accept `ecosystem_id NULL` for Universe spending.

## 7. Cashback for Universe sales

`cashback_chain(_source, _ecosystem_id)` and `sale_commissions` are per selling shop. If a Universe sale still records `voucher_sales.ecosystem_id` = the seller's shop and the buyer's upline within that shop, the engine works unchanged. What breaks: buyers who are not members of the seller's shop have no upline there → 100% to admin (this matches the customer→upline lineage reset rule already in memory). Provenance-based cashback (FIFO lots) needs the decision in §6(b). No redesign of the hierarchy is needed.

## 8. Rewards

Fully shop-specific already; enable/disable = `credits_per_point` (a "disabled" state is not explicit — a `rewards_enabled` flag would be new). Points earn once per `sale_id`; unchanged for Universe sales as long as the sale is attributed to the seller's shop.

## 9–10. Platform fee and two-way pricing

Reusable: `platform_settings` row pattern (add `universe_platform_fee_percent`), `voucher_sales` snapshot columns, `retail_order_items.unit_price` snapshot. New: `seller_cut`, `platform_fee_percent_at_publish`, `platform_fee_amount`, `retail_price` columns on `retail_products` (and voucher products if voucher shops use the model), a pure pricing helper in `src/lib` (enter either side), and a Super Admin earnings line "Universe platform fees". Protecting the seller's cut = snapshot fee % per product at publish; recompute retail price on republish only.

## 11–12. Cash on Hand + fee hold

No credit hold primitive exists; retail "hold" today is a real debit refunded later. Safest path mirrors `withdrawal_requests`: `reserve_ledger_id` (debit seller's global wallet for the fee at order acceptance, entry_kind `platform_fee_hold`), `settlement_ledger_id`/`refund_ledger_id` on settlement/cancel; a `held` column on `credit_accounts` (like points) would be a cleaner, larger change. The availability rule (available coins ≥ fee) must live inside the order RPC and in `list_retail_products`-style output for the UI.

## 13–14. Delivery and settlement

Missing entirely: delivery fee type/value on `ecosystems`, order-level snapshot (`delivery_fee_type`, `delivery_fee_amount`), and statuses `accepted → processing → delivered/picked_up → confirmed → settled`. The status CHECK constraint and `retail_review_order` need to grow; existing `pending/approved/rejected/cancelled` rows must map cleanly (`approved` ≈ accepted).

## 15. Signup dependencies

- `/` (`index.tsx`): Shop ID required only on the "join" signup path; global path exists. Post-signup: `/universe`.
- `/join/$slug`: legacy slug signup binds the account to that shop via `ecosystem_slug` metadata → `handle_new_user` self-join path → `membership_applications` → `auto_process_membership_application`.
- `/invite`: operator invites (`admin_invitations`), unaffected.
- `landingForMemberships`: 1 shop → shop console, 0 → Universe. Universe-first for legacy members means changing this rule for `shop_kind='legacy'` only.

## 16. Terminology classification

- KEEP: "Universe", "@handle", "Shop ID" (new-gen context), Omada/portal wording, cash-in/cash-out wording.
- MODIFY: `guide.tsx` "Legacy shops and Subscription shops" card; `universe.shops.tsx` "Join a shop with its 7-digit Shop ID" empty state; `index.tsx` signup copy ("Enter the operator's 7-digit Shop ID"); wallet-center / reseller.wallet / admin.wallets "per shop" copy; `shop-transfer-card.tsx` transit wording.
- REMOVE (after migration): legacy slug signup links (`admin.signup-link.tsx`, `/join/$slug`) for Universe shops; "Legacy Shop" filter label in `super.shops.tsx` / `super.subscriptions.tsx` if renamed to "Universe Shop".
- NEW GENERATION ONLY: "Coins stay inside the shop… isolated" copy, Shop ID join flow, subscription/Go Live cards, `guard_shop_kind_ledger` messaging.
- HISTORICAL / DATABASE — DO NOT DELETE: `shop_kind='legacy'` value, `slug`, `signup_token`, all `credit_ledger` / `voucher_sales` / `sale_commissions` rows and their `ecosystem_id`, `commission_rate_for` (retired, returns 0 but keeps history), per-shop `credit_accounts` rows after consolidation (zero balance, keep for `balance_after` chain).

## 17. Conflicts between the spec and the implementation

1. Singular "Legacy Shop" vs 4 legacy shops (§0.1).
2. Cashback example 20/10/69/1 vs additive fee model and current 100%-split engine (§0.5).
3. "Seller profile shows products" vs products owned by ecosystems with no seller identity; resellers own nothing.
4. "One portable wallet" vs provenance-based cashback lots per shop.
5. Retail is feature-flagged off; Sagada Wave has 175 products in it, so switching `RETAIL_VISIBLE` on exposes real data immediately.
6. `create_review_shop` always creates a subscription (new-gen) shop; "create a Universe shop" needs a distinct kind.

## 18. Recommended implementation order and effort

Rough Lovable effort (credits are approximate build-session sizes):

1. Decisions + design memo (which shops, provenance rule, fee model) — small (≈5–10).
2. Schema additions only, no data moves: third `shop_kind`/flag, pricing columns, delivery settings, order statuses, fee hold pointers, `platform_settings` fee — medium (≈20–30).
3. Universe wallet enablement: `transfer_credits`, `purchase_voucher`, `retail_place_order`, `guard_shop_kind_ledger` accept the global wallet for Universe shops; consolidation RPC written and dry-run on the test shop — large (≈40–60).
4. Two-way pricing + platform fee earnings line — medium (≈20–30).
5. Retail lifecycle, delivery fee snapshot, Cash on Hand fee hold — large (≈40–60).
6. Universe discovery: shop/product search RPCs, seller storefront on profile, ordering/colors/vacation — large (≈40–60).
7. Signup/landing changes + Universe-first routing for legacy members — small/medium (≈10–20).
8. Consolidation run on real legacy shops + reconciliation report — medium (≈15–25).
9. Cleanup/terminology pass per §16 — medium (≈15–25).

Nothing in this report has been applied. Approving this plan only means "proceed to item 1 (decisions)"; no code or data changes until each phase is separately confirmed.
