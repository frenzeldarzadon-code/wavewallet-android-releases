# Payment-method-agnostic notification listener

## What the current system actually does (verified)

**Android (in-app listener)**
- `GcashNotificationListener` hard-filters on `sbn.packageName != BuildConfig.GCASH_PACKAGE` ("com.globe.gcash.android") in both `onNotificationPosted` and the reconnect sweep. Everything else is dropped in memory and never counted or stored.
- `GcashParser` (v2) then classifies: `Ignored` (dropped), `Unparsed` (queued with no amount), `Payment` (queued with amount/sender/reference).
- The pairing screen sends a manual "WAVEWALLET TEST EVENT" with `packageName = BuildConfig.GCASH_PACKAGE`.

**Server ingest** — `src/routes/api/public/payments/listener.ts`
- HMAC-signed (device + ts + nonce + body), replay-protected, revoked devices get 403.
- Re-parses `raw_text` with `src/lib/gcash-notification.ts` (mirror of the Android parser), then calls `record_listener_event`.

**Database**
- `record_listener_event` **rejects any package other than the device's own `package_name`** ("Only % notifications are accepted"). Events with no positive amount are stored with `outcome='unparsed'` and never matched.
- `match_listener_event` requires amount + sender number key + 3-day time window + shop scope (`listener_serves_destination`). Multiple candidates → `ambiguous`.
- `try_auto_approve_cash_in` additionally requires receipt/OCR agreement, a reference key, sender/amount match, listener device online, and no duplicate reference.
- Duplicate protection is **already global** (`cash_in_reference_duplicate` scans all `cash_in_requests` with no ecosystem filter, plus a global check against `listener_events.reference_key`).

**Diagnosis of the screenshots (confirmed by data)**
- Active device `…f753327`: `listener_connected=true`, `notification_access=true`, `received_count=0`, `app_version 1.3.0`.
- The three newest server events on that device all have `raw_text = "WAVEWALLET TEST EVENT — not a payment, no amount, cannot credit any wallet."` and `outcome='unparsed'`.
- So the "Unreadable" rows on the server are **the app's own test events**, working as designed — not failed GCash parses. "GCash notifications received 0" means Android delivered zero notifications from `com.globe.gcash.android` to the app. That is the **native package filter combined with no real GCash notification arriving** (or a GCash build using a different package id) — the parser is not the failing layer here. Making the listener read all packages will make this immediately visible.

## Proposed changes

### A. Android (requires the next APK release — versionCode 6 / 1.4.0)
1. Remove the package whitelist. Capture every posted notification; keep a small ignore list for WaveWallet's own notifications and empty-text ones.
2. Send `package_name`, `app_label`, `title`, `text`, `posted_at`, plus existing signed device identity. Keep sending the phone-side parsed fields **only** when the provider is recognised locally; otherwise send the text and let the server decide.
3. Two counters in diagnostics: "notifications seen (all apps)" and "payment-provider notifications". This makes the 0-vs-unreadable confusion self-diagnosing.
4. Permission wording updated: "WaveWallet reads notifications on this phone locally and only uploads ones that match a configured payment provider."
5. `android-gcash-listener` standalone project untouched.

### B. Server (can ship now, web-only)
6. New provider registry `src/lib/payment-providers/` with a `PaymentProvider` interface (`id`, `packages[]`, `matches(text)`, `parse(text)` → amount / sender / reference / receiver). GCash moves in behind the existing parser unchanged; adding a provider later is one file.
7. Ingest route accepts the richer payload (`app_label`, `title`, `text`), resolves the provider from package + text, and forwards `provider_id`. Old payloads keep working (fields optional).
8. `record_listener_event`: replace the hard "package must equal device package" rejection with — accepted providers are stored as payment events; unrecognised packages are stored as `outcome='non_payment'` (or dropped by policy) and are never eligible for matching. Device stays shop-scoped exactly as today.

### C. Two-independent-signals rule (the core safety change)
9. Add a scoring function `listener_event_match_confidence(event, cash_in)` returning the count of **independent** agreeing signals from: exact reference, sender account key, amount (within tolerance), receiving account. Amount alone counts as one signal and can never reach the bar.
10. `match_listener_event` / `link_cash_in_listener_event` require **≥ 2 independent signals** and exactly one candidate. Today amount+sender is effectively required, so GCash behaviour is preserved; the rule becomes explicit and provider-agnostic.
11. `unparsed` / ambiguous / single-signal events stay `review_state='pending'` and never auto-approve. All existing OCR/receipt corroboration in `try_auto_approve_cash_in` is untouched.

### D. Global duplicate protection without cross-shop leakage
12. New table `public.payment_reference_seen (provider_id, reference_hash, first_used_at, cash_in_id, ecosystem_id)` — `reference_hash` is a salted SHA-256 of the normalised reference; no amounts, names or raw text. Written on successful corroboration.
13. Duplicate check consults this table platform-wide. Shop admins see only a boolean "this reference was already used on the platform"; the owning shop, amount and payer are visible to Super Admin only (RLS + a `security definer` indicator function). Existing global reference checks remain as a second net.

### E. Isolation and UI
14. No pairing/revocation changes. Device → ecosystem binding stays authoritative for which shop an event may serve.
15. Admin UI shows provider, amount, masked sender, reference tail and matched signals — **not** raw notification text. Raw text stays Super Admin only, as today.

## Ordering

1. Ship B + C + D + E (database migration + web) — no APK needed, existing GCash flow keeps working.
2. Then the Android change (A) in the next signed release; the server already accepts both old and new payloads.

Nothing is built, published or deployed as part of this plan.
