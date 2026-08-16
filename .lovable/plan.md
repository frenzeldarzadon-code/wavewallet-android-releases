# Subscription Shops — architecture plan (no code changes yet)

## What I verified first

- 4 shops exist today (Sagada Wave, DEMO — Preview Shop `is_test`, Lenas Giga Surf, Guesang GigaFlex). All would become **Legacy** shops; none is migrated.
- Subscription today is a single global plan in `platform_settings` (`plan_name`, `plan_price`, `billing_period`) plus a per-shop `plan_name`/`plan_price`/`current_period_end` and manual GCash requests (`subscription_requests`, `submit_subscription_request`, `review_subscription_request`, `expire_stale_subscriptions`, `subscription_ok`, `my_operational_status`, `require_operational`). There is no plan catalog and no cashflow allocation concept.
- Freeze already exists per shop (`operations_frozen`, `set_ecosystem_freeze`, `require_operational`) and is enforced server-side — the expiry/freeze requirement reuses this, it does not need a new mechanism.
- Cash In/Cash Out already supports dual paths (`admin` internal 1:1, `superadmin` with fees) and destination-aware GCash listeners; verification rules are already Super-Admin-only and centralised.
- Coin/cashback/points/voucher logic is already shop-scoped by `ecosystem_id`, so both shop types can share it unchanged.
- **Cross-shop transfers exist today and work**: `transfer_credits_between_shops` (5-coin platform fee, transfer-provenance lots), UI in the wallet centre. This directly contradicts spec §5/§25.

## Blocking questions (financial — I will not guess)

1. **Cross-shop transfers.** Should `transfer_credits_between_shops` be (a) removed platform-wide for everyone, (b) blocked only when either side is a Subscription Shop (Legacy↔Legacy keeps working), or (c) kept but disabled by a Super Admin switch? Option (a) contradicts the previously approved shop-to-shop feature; (b) is the only choice that satisfies "do not change Legacy behaviour".
2. **Allocation semantics.** On activation the Admin receives the plan's coins as a platform issuance. Confirm: it is minted **once at activation**, **not re-minted on renewal**, and an upgrade mints only the difference (new allocation − previous allocation, never negative). Renewal therefore buys time, not coins. Correct?
3. **Is the allocation a cap or a grant?** "Revolving capacity" can mean (i) a one-time mint that then circulates (no ceiling enforced afterwards), or (ii) a hard ceiling on total coins in the shop, enforced on every issuance. Which one? I plan (i) plus a reporting-only capacity indicator unless you say otherwise.
4. **Proration on upgrade.** Confirm the formula: unused days of the current plan × (old monthly price / days in period) is credited against the new plan's price (money side only, never coins), configurable on/off by Super Admin.
5. **Demo scope.** Today's demo signs into real sandbox accounts in the DEMO shop. §28–§39 ask for a public, no-login, fully simulated demo plus PWA offline. That is a large separate build. Ship it as Stage 6 after the subscription core, or earlier?

## Stages

**Stage 0 — Super Admin hidden from demo (safe, immediate).** Remove `super_admin` from `DEMO_ROLES` (`src/lib/demo.ts`) and reject that role server-side in `src/lib/demo.server.ts`.

**Stage 1 — Shop kind.** Add `ecosystems.shop_kind` enum `legacy | subscription`, default `subscription`, and backfill every existing row to `legacy` in the same migration. One column drives every branch below; nothing reads it for Legacy behaviour except to keep it unchanged.

**Stage 2 — Plan catalog (configurable, never hard-coded).** New `subscription_plans` table: name, description, target business type, monthly price, coin allocation, billing period, recommended flag, active flag, display order. Seeded with Starter/Basic/Standard/Advanced/Large Deployment at the stated prices and allocations. Super Admin CRUD via SECURITY DEFINER RPCs + a new plans card in Super Admin settings. GRANTs + RLS: `anon`/`authenticated` read active plans only; writes Super Admin only.

**Stage 3 — Subscription lifecycle + payments.** New `shop_subscriptions` (current plan, state ACTIVE/EXPIRING_SOON/EXPIRED/FROZEN/REACTIVATED/CLOSED, period start/end) and `subscription_events` audit table capturing shop, previous/new plan, amount, allocation, additional allocation, proration, payment reference, verification status, dates, transaction id, actor. Subscription payments are recorded as `SUBSCRIPTION_PAYMENT` — a separate record type that never touches a member wallet, never creates a Cash In/Out and never becomes a coin transfer. Verified payment → activate/renew/upgrade + apply allocation rules. Allocation is written to the credit ledger as a distinct `subscription_allocation` entry kind (non-earning, no cashback, no points), reusing the existing platform-issuance path so provenance stays intact. No manual "Add Cashflow" exists for Subscription Shops.

**Stage 4 — Enforcement (server-side, not UI).** Expiry job flips EXPIRED and sets `operations_frozen` via the existing freeze mechanism, so every money RPC already refuses. 7-day banner driven by `current_period_end`. Cross-shop transfer guard per the answer to question 1. `superadmin` cash-out path rejected for Subscription Shops in `request_withdrawal`/settlement, plus hidden in UI. Members and their other shop memberships are never touched by freeze, expiry or purge.

**Stage 5 — Super Admin UI split.** Two areas: Legacy Shops (today's screens, untouched) and Subscription Shops (plan, state, period, allocation history, payment matching). Admin-facing plan selection and "+ Add another shop" with the business explanations (who it's for, capacity provided, when to upgrade), plus the cashflow-vs-expense-vs-profit wording.

**Stage 6 — Public demo + PWA** (pending answer to question 5): guest-only simulated data, four roles, coin-flow/cashback/points education, reset/exit, service worker caching the demo shell; real money paths never available offline.

## Isolation strategy for shared code

Wallets, ledger, vouchers, cashback, points, reseller hierarchy, GCash listener and verification stay exactly as they are. Every new rule is expressed as an extra guard keyed on `shop_kind = 'subscription'`; no existing branch is rewritten. Legacy shops take the identical code path they take today.

## Migration safety

Additive only: new tables, one new column with a backfill, new RPCs. No drops, no data deletion, no rewriting of existing ledger rows. Existing `subscription_requests` stays as the Legacy path; Subscription Shops use the new tables.

## Tests before publish

Legacy regression (voucher purchase, coin transfer, cashback, points, cash in/out, listener, ledger) plus new coverage for plan CRUD, activation allocation, upgrade difference and proration, renewal without re-mint, expiry → freeze → renewal, cross-shop rejection, Super-Admin-cashout rejection for subscription shops, and member-universe preservation after freeze/purge. Full report delivered before any publish.
