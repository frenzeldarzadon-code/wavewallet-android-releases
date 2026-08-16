# Subscription Shops, Public Guide & 5-Day Review Shops — final architecture plan (no code changes yet)

## Verified current state

- 4 shops exist (Sagada Wave, DEMO — Preview Shop `is_test`, Lenas Giga Surf, Guesang GigaFlex). All become **Legacy**; none is migrated.
- Subscriptions today: one global plan in `platform_settings` + per-shop `plan_name`/`plan_price`/`current_period_end`, manual GCash requests (`subscription_requests`, `submit_subscription_request`, `review_subscription_request`, `expire_stale_subscriptions`, `subscription_ok`, `my_operational_status`, `require_operational`). No plan catalog, no allocation concept.
- Per-shop freeze already exists and is server-enforced (`operations_frozen`, `set_ecosystem_freeze`, `require_operational`) — expiry reuses it.
- Cash In/Out already has `admin` (internal 1:1) and `superadmin` (fees) paths; listeners are destination-aware; verification is already Super-Admin-only and central.
- Coins/cashback/points/vouchers are `ecosystem_id`-scoped, so both shop types share them unchanged.
- Cross-shop transfers exist and work (`transfer_credits_between_shops`, 5-coin fee) — kept for Legacy, blocked for Subscription.

## Confirmed rules

1. **Cross-shop transfers**: Legacy↔Legacy unchanged; rejected server-side inside the RPC whenever either side is a Subscription Shop, and hidden in the wallet UI.
2. **Allocation**: minted once at activation. Renewal extends time only. Upgrade mints only `new − previous` allocation (never negative). No cap, no auto-refill; full allocation history retained.
3. **Wording everywhere**: subscription expense ≠ cashflow allocation ≠ coin balance ≠ profit. Never "pay ₱50 and get ₱1,000". Starter presented as a legitimate fit for small, low-movement WiFi voucher shops.
4. **Upgrade proration (30-day month)**: `old daily = old monthly price / 30`; `unused = old daily × exact days remaining`; `first-month due = new price − unused`, floored at 0. Money only; coin allocation untouched. Shown to the Admin before payment and recorded in the audit row.
5. **Super Admin is private**: removed from the demo role enum client- and server-side; never appears in the public guide, role selectors, or Q&A answers.
6. **Sign-up required before creating any shop.** Only the public Guide is anonymous.
7. **The 5-day review shop is a simulated demo shop** with configurable seed (default 1,000 Demo Coins) in a fully separate namespace — never the real ledger.

## Stages

**Stage 0 — Super Admin out of demo.** Remove `super_admin` from `DEMO_ROLES` (`src/lib/demo.ts`), the zod enum in `src/lib/demo.functions.ts`, and `DemoRole`/provisioning in `src/lib/demo.server.ts`.

**Stage 1 — Shop kind + review flag.** Add `ecosystems.shop_kind` enum (`legacy` | `subscription`), default `subscription`, backfill existing rows to `legacy`; add `is_review` + `review_ends_at`. Every real-money RPC gains a guard: `is_review` shops cannot reach real credit/points/withdrawal/cash-in paths at all.

**Stage 2 — Plan catalog.** `subscription_plans` (name, description, WiFi use case, business size, reseller suitability, upgrade guidance, monthly price, coin allocation, billing period, recommended, active, display order). Seeded Starter ₱50/1,000, Basic ₱100/2,500, Standard ₱150/5,000, Advanced ₱200/10,000, Large Deployment configurable/500,000. Super-Admin-only CRUD RPCs + Super Admin plans card. Active plans readable by `anon` (the guide needs them); writes Super Admin only.

**Stage 3 — Subscription lifecycle & payments.** `shop_subscriptions` (plan, state REVIEW / ACTIVE / EXPIRING_SOON / EXPIRED / FROZEN / REACTIVATED / CLOSED, period start/end, review end) and `subscription_events` audit (shop, previous/new plan, amount, allocation, additional allocation, proration inputs and result, payment reference, verification status, dates, transaction id, actor). Payments recorded as `SUBSCRIPTION_PAYMENT` — never a wallet credit, Cash In, Cash Out or transfer. Allocation posts once as a non-earning `subscription_allocation` credit-ledger entry (no cashback, no points). No manual "Add Cashflow".

**Stage 4 — Enforcement (server-side).** Expiry job → EXPIRED + existing `operations_frozen`, so all money RPCs refuse. 7-day reminder from `current_period_end`, cleared by verified payment. Cross-shop guard. `superadmin` cash-out rejected for Subscription Shops in `request_withdrawal`/settlement and hidden in UI. Freeze/expiry/purge never touch the member's global account or other memberships. No backdated entries for frozen periods.

**Stage 5 — Simulated review environment (separate ledger namespace).** New `demo_*` tables (`demo_wallets`, `demo_ledger`, `demo_vouchers`, `demo_orders`, `demo_members`) scoped to the review shop and its creator. Demo Coins live only here; no real `credit_accounts`, `credit_ledger`, `points_ledger`, GCash, withdrawal or cash-in row is ever written. The review shop mirrors the live navigation and Admin/Reseller/Subreseller/Customer workflows (voucher catalog and purchase, coin movement, cashback, points, transaction history, plan screens) with a persistent REVIEW badge. 5-day countdown visible. On expiry: freeze demo actions and show "a subscription is required to activate this shop" — never a silent conversion. On successful subscription: shop configuration is preserved, `is_review` clears, real wallets/ledger start empty and the plan allocation is minted; **demo balances are discarded, never carried into the real ledger**.

**Stage 6 — Public Guide (`/guide`, no login, stable canonical URL).** Polished, mobile-first, WaveWallet-branded marketing/education page: Hero, How It Works, WiFi Voucher Ecosystem, Revolving Cashflow, Plans comparison, Reseller/Subreseller benefits, Cashback (100 → 5/2; 500 → 25/10), Points (10 Coins = 1 Point), Cash In/Out, renewal + 7-day reminder, freeze on expiry, shop-specific coins and the cross-shop restriction, Legacy vs Subscription at a high level, printed-voucher vs digital-coin comparison stated as reduced reconciliation and receivable exposure (never "eliminates risk"), FAQ, Ask-a-Question form, Share button (no Facebook login), and a "Create your shop" CTA that routes to sign-up. Full OG/Twitter metadata with a generated hero image so Facebook previews well. Marketing visuals generated for WiFi/wallet/voucher/reseller themes.

**Stage 7 — Guide content management (CMS-style, Super Admin only).** `guide_sections` (key, heading, body markdown, image, display order, published) and `guide_faqs` (question, answer, order, published) plus `guide_questions` (visitor submissions: rate-limited, moderated; only approved+answered rows are publicly readable; answers render in a distinct "Answered by WaveWallet Support" box with no Super Admin identity, contact or profile exposed unless a separate public-support setting is enabled). Page content is read from these tables, so text, FAQ, plan descriptions, images and announcements change without a deploy and the shareable URL never changes. A Super-Admin-only editor manages them; future assistant-directed corrections update rows through the same authorized path and never touch financial logic. Public reads use narrow `TO anon` SELECT policies on published rows only.

**Stage 8 — Guide tab inside the app.** The same content renders in an in-app Guide/Help tab available to the Admin and appropriate members during review and after activation, plus contextual "(i)" help on relevant screens and a global Show Guide / Hide Guide toggle persisted per user. Hiding guide text never disables any financial or security control.

## Isolation strategy

Wallets, ledger, vouchers, cashback, points, discounts, reseller hierarchy, GCash listener and verification stay untouched. New rules are added guards keyed on `shop_kind = 'subscription'` or `is_review`; no existing branch is rewritten, so Legacy shops keep today's exact code path. Demo activity lives in its own tables, so no simulated row can ever appear in a real financial report.

## Migration safety

Additive only: new tables, new columns with backfill, new RPCs. No drops, no data deletion, no rewriting of existing ledger rows. `subscription_requests` remains the Legacy path.

## Final decisions on the open points (no blockers remain)

- **One active review shop per member**, enforced server-side; Super Admin can see every review shop.
- **Expired review shops are kept, frozen, and their slug stays reserved** — never deleted or auto-reused; any later cleanup happens through an explicit policy.
- `/guide` is the only anonymous area; every shop-creation path requires Universe sign-up/login first.
- Demo ledger is fully separate, seeded at a configurable 1,000 Demo Coins, and no demo balance can ever become real Coins.
- On subscription, the demo ledger is discarded/reset and the real shop starts with the plan allocation minted exactly once.
- Super Admin never appears in the public guide or any role selector.
- Everything affecting real money — allocation, proration, freeze, cross-shop, cash out — is fully specified; no remaining financial ambiguity.


## Tests before publish

Legacy regression (voucher purchase, coin transfer, cashback, points, cash in/out, listener, ledger, cross-shop transfer still works) plus: plan CRUD, single activation allocation, renewal without re-mint, upgrade difference, proration arithmetic, expiry → freeze → renewal, cross-shop rejection for subscription shops, Super-Admin-cashout rejection, review shop cannot write any real financial table, review expiry freeze, review → paid conversion discards demo coins and mints the real allocation once, guide/FAQ/question permissions (anon read published only, Super Admin write). Full written report before any publish.
