# Subscription Shops — architecture plan (approved decisions applied, no code changes yet)

## What I verified in the current system

- 4 shops exist today (Sagada Wave, DEMO — Preview Shop `is_test`, Lenas Giga Surf, Guesang GigaFlex). All become **Legacy**; none is migrated.
- Subscription today = one global plan in `platform_settings` + per-shop `plan_name`/`plan_price`/`current_period_end` with manual GCash requests (`subscription_requests`, `submit_subscription_request`, `review_subscription_request`, `expire_stale_subscriptions`, `subscription_ok`, `my_operational_status`, `require_operational`). No plan catalog, no allocation concept.
- Per-shop freeze already exists and is enforced server-side (`operations_frozen`, `set_ecosystem_freeze`, `require_operational`) — expiry reuses it.
- Cash In/Out already has dual paths (`admin` internal 1:1, `superadmin` with fees); listeners are destination-aware; verification rules are already Super-Admin-only and central.
- Coins/cashback/points/vouchers are already `ecosystem_id`-scoped, so both shop types share them unchanged.
- Cross-shop transfers exist and work (`transfer_credits_between_shops`, 5-coin fee, transfer-provenance lots) — kept for Legacy, blocked for Subscription per your decision.

## Final rules I will implement

1. **Cross-shop transfers**: Legacy↔Legacy unchanged. Any transfer where either side is a Subscription Shop is rejected inside `transfer_credits_between_shops` (server-side) and the destination is hidden/disabled in the wallet UI.
2. **Allocation**: issued **once** at activation. Renewal extends time only, never re-mints. Upgrade mints only `new allocation − previous allocation` (never negative). No cap, no auto-refill; full allocation history kept for reporting.
3. **Wording**: subscription expense vs one-time cashflow allocation vs circulating coin balances vs business profit, used consistently in plan cards, guide, contextual help. Never "pay ₱50 and get ₱1,000". Starter presented as a legitimate fit for small, low-movement WiFi voucher shops.
4. **Upgrade proration (deterministic, 30-day month)**: `old daily = old monthly price / 30`; `unused = old daily × exact days remaining`; `first-month amount due = new plan price − unused` (floored at 0). Money only — the existing coin allocation is untouched and the upgrade still adds only the allocation difference. The calculation is shown to the Admin before payment and written to the subscription audit record.
5. **No Super Admin anywhere public**: removed from the demo role selector and rejected server-side; never shown in the public guide, role selectors, or Q&A answers.

## Stages

**Stage 0 — Super Admin out of the demo selector.** Drop `super_admin` from `DEMO_ROLES` (`src/lib/demo.ts`), from the zod enum in `src/lib/demo.functions.ts`, and reject it in `src/lib/demo.server.ts`.

**Stage 1 — Shop kind.** Add `ecosystems.shop_kind` enum (`legacy` | `subscription`), default `subscription`, backfill all existing rows to `legacy` in the same migration. This single column gates every new rule.

**Stage 2 — Plan catalog.** New `subscription_plans` table (name, description, WiFi-voucher use case, target business size, reseller suitability, upgrade guidance, monthly price, coin allocation, billing period, recommended, active, display order) + Super-Admin-only CRUD RPCs and a Super Admin plans card. Seeded: Starter ₱50/1,000, Basic ₱100/2,500, Standard ₱150/5,000, Advanced ₱200/10,000, Large Deployment configurable/500,000. GRANTs: active plans readable by `anon` and `authenticated`; writes Super Admin only.

**Stage 3 — Subscription lifecycle + payments.** New `shop_subscriptions` (plan, state ACTIVE / EXPIRING_SOON / EXPIRED / FROZEN / REACTIVATED / CLOSED / IN_REVIEW, period start/end, review-period end) and `subscription_events` audit (shop, previous/new plan, amount, allocation, additional allocation, proration inputs and result, payment reference, verification status, dates, transaction id, actor). Subscription payments are recorded as `SUBSCRIPTION_PAYMENT` — never a wallet credit, Cash In, Cash Out or coin transfer. Allocation posts to the credit ledger as a distinct non-earning `subscription_allocation` entry kind (no cashback, no points) via the existing platform-issuance path. No manual "Add Cashflow" for Subscription Shops.

**Stage 4 — Enforcement (server-side, not just UI).** Expiry job sets EXPIRED and flips the existing `operations_frozen`, so every money RPC already refuses. 7-day renewal reminder from `current_period_end`, cleared by a verified payment. Cross-shop guard from rule 1. `superadmin` cash-out path rejected for Subscription Shops in `request_withdrawal`/settlement and hidden in UI. Freeze/expiry/purge never touch the member's global account or other memberships. No backdated entries for frozen periods.

**Stage 5 — Public Guide page (`/guide`, no login).** Shareable, SEO- and OG-tagged landing page explaining the whole ecosystem: WiFi vouchers, Coins, revolving cashflow, plan comparison with who-each-plan-is-for, Admin/Reseller/Subreseller/Customer roles, cashback examples (100 coins → 5/2; 500 coins → 25/10), points (10 Coins = 1 Point → 10 points on a 100-coin purchase), Cash In/Out, shop isolation, digital-vs-printed-voucher comparison (stated as reduced reconciliation and receivable exposure, not eliminated risk), FAQ, and an "Ask a question" form. New `guide_questions` table: anyone may submit (rate-limited, no PII required beyond an optional contact), only Super Admin may answer, answers render in a distinct box labelled "Answered by WaveWallet Support" with no identity exposed. Only answered/approved questions are publicly readable.

**Stage 6 — Real 5-day review shop.** "Create your shop" from the guide creates a real Subscription Shop with the creator as Admin (never Super Admin), state IN_REVIEW with a 5-day end date and a visible countdown. Full Admin/Reseller/Subreseller/Customer workflows are available for evaluation; sample/simulated transactions are labelled as such and never touch real GCash. At day 5 the shop's financial operations freeze with a clear "subscription required to continue" screen — never a silent conversion to paid. Contextual "(i)" help on relevant screens plus a global Show/Hide Guide toggle (persisted per user; hiding never disables the help system).

## Isolation strategy

Wallets, ledger, vouchers, cashback, points, discounts, reseller hierarchy, GCash listener and verification are untouched. Every new rule is an added guard keyed on `shop_kind = 'subscription'`; no existing branch is rewritten, so Legacy shops take today's exact code path.

## Migration safety

Additive only: new tables, one new column with backfill, new RPCs. No drops, no deletions, no rewrite of existing ledger rows. `subscription_requests` remains the Legacy path.

## Remaining concerns (flagging, not blocking)

- **Review-shop abuse**: a real shop per visitor invites spam and duplicate shops. I intend to require a signed-in WaveWallet account, one review shop per member, and Super Admin visibility of all review shops. Say if you want a different limit.
- **"Simulated" inside a real shop**: to avoid two economies, review shops use the real coin engine with a modest review allocation and no real GCash paths; the coins are real inside that shop and remain if the owner subscribes. Confirm that is acceptable rather than a throwaway sandbox.
- **PWA/offline** from the earlier spec is not in these stages; the public guide will be cacheable, but real financial actions stay online-only. Tell me if PWA install should be added as Stage 7.

## Tests before publish

Legacy regression (voucher purchase, coin transfer, cashback, points, cash in/out, listener, ledger, cross-shop transfer still works) plus new coverage: plan CRUD, activation allocation once, renewal without re-mint, upgrade difference, proration arithmetic, expiry → freeze → renewal, cross-shop rejection for subscription shops, Super-Admin-cashout rejection, review-shop expiry, guide question permissions, and member-universe preservation after freeze/purge. Full written report before any publish.
