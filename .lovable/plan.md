# Go Live stuck on "Verification in progress" — SW Demo 2 Final Test

## What the data actually says

The payment is **genuinely not approved**. Nothing in the UI is lying.

Shop `SW Demo 2 Final Test`: still `is_review = true`, `subscription_state = awaiting_approval`.

Its latest Go Live request (submitted 23 Aug 2026 12:26 UTC):

- `status = pending`, `auto_state = pending`
- `auto_reason` = waiting for a payment notification matching at least two details
- Receipt was read fine: `receipt_check = matched`, reference `104116`, amount `150.00`, payer `15976553427`, plan `Standard` at ₱150 × 1 month
- `listener_event_id` is empty — no payment notification was ever matched to it

So the UI state is correct: the receipt was accepted, but the second, authoritative side of the rule (a real notification from the platform listener) never arrived or never matched.

## Why no match happened — three separate causes

**1. No qualifying notification exists at all.**
The only active listener device last delivered a GCash payment notification on **22 Aug**. Every event since then (up to 12:40 today) is from Shopee, Lazada, SeaBank, Gmail, etc. and is recorded as `non_payment`. There is no accepted GCash event after the 12:26 submission, so `reconcile_go_live_request` correctly returns `no_match`.

**2. The receipt is a bank-to-GCash transfer, and the matching trigger can't see it.**
The receipt is MariBank account `15976553427` → GCash `09541230072` via InstaPay. The database trigger that re-runs reconciliation when a new notification arrives only looks for pending requests whose `payer_number_key` **equals the notification's sender number**. A GCash "received from InstaPay" notification will not carry the sender's MariBank account number, so that trigger would never fire for this request — even if the right notification did arrive. The reference number (`104116`) plus amount would satisfy the ≥2-signal rule, but reconciliation is never invoked to evaluate it.

**3. The receipt's own date pushes it outside the match window.**
The screenshot text reads "23 Aug **2024** 19:07", so `receipt_paid_at` was stored as 2024-08-23. Reconciliation only accepts notifications within ±3 days of that timestamp — a window two years in the past. Any notification arriving today is excluded by date alone.

## Recommended changes (not applied yet)

1. **Broaden the re-match trigger.** When an accepted notification arrives, also re-run reconciliation for pending requests whose stored reference matches the notification's reference — not only those matching on sender number. This is the actual blocker for bank-to-wallet payments and does not weaken the ≥2-signal rule (reference remains one signal, amount the second, reference still counts as the strong signal).
2. **Make the time window robust against a misread receipt date.** Anchor the window on the request's submission time when the receipt date is implausible (far in the past or in the future relative to submission), instead of trusting the OCR year blindly. Keep the window itself narrow.
3. **Refresh the operator's screen.** The Go Live card fetches the request once on mount with no polling or realtime subscription, so even after activation the operator can sit on the old screen until a manual reload. Add a light poll or realtime subscription while a request is pending, so the congratulations/live transition appears on its own.
4. **This specific shop still needs a real payment notification** (or a deliberate platform-owner decision) before it can activate. No code change should auto-approve it — the listener has not corroborated the payment.

## Technical notes

- Path traced: `submit_go_live_payment` → inline `reconcile_go_live_request` → `go_live_match_signals` / `go_live_has_strong_signal` → `activate_go_live_request`.
- Re-match trigger: `tg_listener_event_subscription_match` (the `payer_number_key = new.sender_number_key` filter is cause 2).
- Window: `coalesce(receipt_paid_at, created_at) ± 3 days` inside `reconcile_go_live_request` (cause 3).
- UI: `fetchGoLiveRequest` in `src/lib/go-live.ts`, called once from `load()` in `src/components/subscription/go-live-card.tsx` (cause of the stale screen).
- No live data was modified during this investigation.
