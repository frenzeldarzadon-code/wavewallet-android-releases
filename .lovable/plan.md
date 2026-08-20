# Free Shop Creation → Demo Shop → GCash Go-Live

## What exists today (verified)

- `create_review_shop(name, description)` already creates a shop with **no plan choice**: `shop_kind='subscription'`, `is_review=true`, `review_ends_at = now + 5 days`, `subscription_state='pending'`, creator becomes shop admin, plus demo wallets/vouchers/ledger seeded with 1,000 Demo Coins. It enforces **one review shop per member**.
- `/start-shop` is the creation form; `/review` is the demo workspace; `ReviewBanner` shows the countdown.
- Activation today is **Super Admin only**: `/super/shops` calls `activate_subscription(ecosystem_id, plan_id, …)`, which requires **picking a plan**, wipes the demo tables, clears `is_review`, sets `subscription_state='active'` and mints the plan's Coin allocation.
- A separate legacy path exists: `submit_subscription_request` → `review_subscription_request` (member submits GCash reference + proof, Super Admin approves). It uses `platform_settings.gcash_number` / `gcash_account_name` and derives months from `amount / ecosystem_monthly_rate`.
- GCash listener: `listener_events` are stored durably and `match_listener_event` matches **only `cash_in_requests`** (sender key + amount, destination-aware). Platform-owned devices exist with `ecosystem_id = null`, `owner_role='platform'` (one active device, receiving key `639541230072`).
- `platform_settings` currently holds gcash number `09070321959`, plan "Operator Monthly" ₱150.

## What changes

### 1. Creation is free and plan-less (mostly already true)
- Keep `create_review_shop` as the single creation entry point; surface it under Shops (Universe → Shops / start-shop) for any signed-in member.
- Relabel review → **Demo shop** across UI (`start-shop`, `review`, banner, `/super/shops`). No plan selector anywhere at creation.
- Decision needed: keep "one demo shop per member" (recommended) or allow several.
- Remove the hard 5-day expiry from the go-live path: the demo may keep its countdown for information, but going live must stay possible after it lapses.

### 2. "Go Live" action inside the demo shop
- New `GoLiveCard` on the demo workspace (and a banner CTA) with a single button — **no plan cards**.
- Clicking it opens a payment sheet that shows, read-only from `platform_settings`:
  - GCash number + account name configured for the platform listener,
  - the **amount due** (the fixed go-live/monthly price — see decisions below),
  - the reference field and optional receipt screenshot upload, matching the existing Cash In evidence style.
- Submitting creates a **go-live payment request** (reuse `subscription_requests` with a `purpose='go_live'` marker rather than a new table) and moves the shop to `subscription_state='awaiting_approval'`, still demo, no Coins minted.

### 3. Verification via the existing GCash listener
- Add a second consumer for platform-destined listener events: `match_listener_event` keeps its current cash-in path unchanged, and when it finds `no_pending_match` **and** the device is `owner_role='platform'`, it additionally tries pending go-live requests by declared sender number + amount (same normalization and tolerance rules already used for Cash In).
- On a match, call a new `verify_go_live_payment(request_id, event_id)` which is the only path that auto-activates.
- Global duplicate guard: a reference already consumed by any cash-in or go-live request cannot activate a second shop; it stays pending for manual review.
- Super Admin can still approve manually from `/super/shops` (evidence-based), exactly as today for Cash In.

### 4. Activation (`convert_demo_shop_to_live`)
Single idempotent, `SECURITY DEFINER` RPC, callable only by the verification path or Super Admin:
1. Lock the shop; abort if not `is_review`.
2. Delete `demo_ledger` / `demo_wallets` / `demo_vouchers` for that shop (Demo Coins never become real).
3. Clear `is_review` / `review_ends_at`, set `signup_enabled = true`, `subscription_state='active'`, `current_period_end = now + months`, plan fields from the paid amount.
4. Ensure the creator's `admin` membership + `user_roles` row is active so the full Admin console works.
5. Set `shop_subscriptions.state='active'`, write a `subscription_events` row and an `audit_logs` entry with the reference and listener event id.
6. Coin allocation: only if a plan is attached. Under the plan-less model the default is **no automatic minting** — see decisions.
- Guard against double activation by a unique/one-shot check on the request, so a duplicate listener event cannot mint twice.

### 5. After activation
- All demo labels, banners and `/review` links disappear for that shop (they key off `is_review`).
- The shop behaves as a normal shop: Admin console, resellers, vouchers, Cash In/Out, retail, Universe posting — no special-casing.
- Existing regular shops, legacy shops and current subscriptions are untouched; `activate_subscription` stays in place for plan-based upgrades.

### 6. Super Admin visibility
- `/super/shops` gains a **Go-live payments** section: shop, requester, amount, reference, receipt, listener match state and reason, with Approve / Reject / Activate actions and the existing diagnostics wording.

## Edge cases

- **Number mismatch**: `platform_settings.gcash_number` (09070321959) does not match the active platform listener's receiving key (639541230072). The page must display the number that the listener actually watches, or the two must be reconciled first — otherwise members pay a number no listener can confirm.
- **No active platform listener**: fall back to manual Super Admin approval; never block go-live.
- **Payment before request** (payment-first): the listener event is stored durably; when the request arrives, reconciliation runs and can approve immediately.
- **Wrong amount / partial payment**: stays pending with a plain reason; no partial activation.
- **Duplicate reference** across shops: pending + side-by-side review, consistent with cash-in rules.
- **Expired demo window**: shop freezes for demo operations but Go Live still works.
- **Double click / duplicate event**: activation is one-shot guarded and idempotent.
- **Tenant isolation**: all new rows carry `ecosystem_id`; RLS restricts reads to the shop's admin plus Super Admin.
- **Demo → real leakage**: demo rows are deleted, never converted; the `guard_shop_kind_ledger` trigger stays.

## Decisions I need from you

1. **Amount due for go-live** — fixed ₱150/month from `platform_settings`, or a specific one-off go-live fee?
2. **Coins on activation** — since no plan is chosen, should activation mint any starting Coins (e.g. the Starter 1,000), or start at zero and let the admin buy Coins normally?
3. **Which GCash number** is authoritative for go-live payments: the platform settings number or the active listener's number?
4. Keep **one demo shop per member**, or allow multiple?

## Technical notes

- New/changed DB objects: `subscription_requests.purpose` (+ index), `verify_go_live_payment`, `convert_demo_shop_to_live`, an added platform branch in `match_listener_event`, RLS/grants for the new reads.
- New/changed frontend: `src/lib/go-live.ts`, `src/components/money/go-live-card.tsx`, edits to `src/routes/review.tsx`, `src/components/review-banner.tsx`, `src/routes/start-shop.tsx`, `src/routes/super.shops.tsx`.
- No changes to `cash_in_requests` logic, the Android listener app, or the existing ingest endpoint.
