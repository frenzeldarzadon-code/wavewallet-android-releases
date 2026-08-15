# Android GCash Notification Listener — Feasibility & Architecture Plan

Planning only. No code, no Android project, no publish.

## 1. Is it feasible?

Yes, technically. Android's `NotificationListenerService` can read the text of GCash notifications once you manually grant Notification Access, and a small app can forward parsed events over HTTPS to WaveWallet. Nothing about it requires GCash cooperation, root, or accessibility abuse.

What it is *not*: it is not verified payment data. It is a screen-scrape of a notification string on one phone. It raises confidence a lot over screenshots, but it is spoofable by anything that can post a lookalike notification on that device, and it silently stops working when the phone is off, offline, or the OS kills the service. Treat it as a strong signal, never as settlement truth — WaveWallet stays the authority.

## 2. Recommended Android technology

Native Kotlin, single-module Android Studio project, minSdk 26, no framework.

- `NotificationListenerService` is a platform API. Capacitor/React Native/Flutter would all need a native Kotlin plugin anyway, so a wrapper adds build weight and background-reliability risk for zero benefit.
- The app has essentially no UI: a status screen, a permission button, a "send test event" button, a log of the last 20 events. Kotlin + one Activity + WorkManager is the whole thing.
- Delivery uses OkHttp + WorkManager so events survive a dead network and retry with backoff.
- Local queue in Room (or a small SQLite table) so nothing is lost between capture and acknowledged delivery.

Structure: `listener/` (the service + parser), `queue/` (Room entity + WorkManager uploader), `net/` (signed HTTP client), `ui/` (status + pairing screen).

## 3. WaveWallet backend changes

The verified-payment spine already exists in the database (`payment_feed_sources`, `verified_payments` with a unique `(provider, provider_txn_id)` index and a single-consumption index, plus `record_verified_payment` granted only to `service_role`). What's missing is a device layer and a live endpoint.

New tables:
- `listener_devices` — id, owner user, label, `device_secret_hash`, `ecosystem_id`, status (pending/active/revoked), `last_seen_at`, `last_event_at`, created/revoked audit columns. RLS: owner + Super Admin read; writes through RPCs only. Secret is stored hashed, shown once at pairing.
- `listener_events` — raw ingest log: device, `event_uid`, raw notification text, parsed amount / sender number / sender name / posted-at, outcome (accepted / duplicate / unparsed / rejected), created_at. Unique index on `(device_id, event_uid)`. This is the audit trail and the place unparsed notifications land for inspection.

New endpoint: `POST /api/public/payments/listener` (TanStack server route, `/api/public/*` so external callers reach it, security enforced in the handler). It verifies the device signature, writes `listener_events`, and on a parsed "received money" event calls `record_verified_payment` with `provider = 'gcash_listener'` and `provider_txn_id = <device_id>:<event_uid>`, then runs the existing `try_auto_approve_cash_in` matching. Also a small `GET`/`POST` heartbeat so the app can show "connected".

New RPCs: `register_listener_device` (returns a one-time secret), `revoke_listener_device`, `listener_device_status` for the Super Admin settings card.

Matching change: today auto-approval matches on configured details. With the listener live, the rule becomes — a pending cash in may auto-approve when an *unconsumed* `verified_payments` row matches amount, sender number (normalised via the existing `normalize_ph_mobile`), and falls inside a time window. Crediting still goes through `settle_cash_in_approval`, which is already idempotent, so retries cannot double-credit.

## 4. Authentication

Pairing: Super Admin creates a device in WaveWallet, gets a one-time pairing code / secret, types or scans it into the app once. The app stores it in Android Keystore-backed EncryptedSharedPreferences.

Each request carries `X-Device-Id`, `X-Timestamp`, `X-Nonce` and `X-Signature` = HMAC-SHA256 over `timestamp + nonce + raw body` using the device secret. The server looks up the device, recomputes the HMAC with a timing-safe compare, rejects timestamps older than ~5 minutes and replayed nonces, and rejects revoked devices. No Supabase user session on the phone, no service key on the phone. Revocation is instant and one-sided from the web app.

## 5. Duplicates vs. legitimate repeat payments

Two separate problems, two separate mechanisms.

- *Same notification delivered twice* (Android re-posts, app retries, user reinstalls): the app derives `event_uid` from stable notification fields — package + posted-at millis + notification key + a hash of the text — and the server's unique `(device_id, event_uid)` index plus the existing `(provider, provider_txn_id)` index make re-ingest a no-op.
- *Two genuine PHP 100 payments from the same sender minutes apart*: these are legitimately distinct and must both credit. They differ by posted-at timestamp, so they produce different `event_uid`s and two `verified_payments` rows. Each cash in consumes exactly one, enforced by the existing single-consumption index on `consumed_cash_in_id`. Where two pending cash ins could match one payment, match oldest-pending-first, one payment per request, never fan out.

The GCash notification does not include the reference number, so the member-typed reference stays the duplicate key on the cash-in side and the listener event is the corroborating evidence.

## 6. GCash changing its notification wording

Never match loosely. Rules:
- Only notifications whose source package is the GCash app are considered; everything else is discarded before parsing.
- A small ordered set of named patterns (currently the "You have received PHP <amount> of GCash from <NAME> <number>" shape), each with a version tag recorded on the event.
- If the package is GCash but no pattern matches, store the event as `unparsed` with the raw text and raise it in the Super Admin UI — never guess, never auto-approve. That gives you a visible signal the moment GCash changes wording, and the raw text needed to add a pattern.
- Explicitly ignore outgoing/promo/"you sent"/"cash in successful" notifications by requiring the received-money shape, not just the word "PHP".
- Patterns should be updatable from the server (fetched config) so a wording change doesn't require a new APK.

## 7. Oppo / ColorOS background survival

ColorOS is among the most aggressive at killing background services. Plan for it explicitly:
- Foreground service with a persistent low-priority notification so the OS treats the app as user-visible.
- Request battery-optimisation exemption; in ColorOS also set the app to "Allow background activity" / "Allow auto-launch" and lock it in Recents.
- WorkManager periodic heartbeat that also acts as a self-heal — if the listener is disconnected it calls `requestRebind`.
- Server-side dead-man switch: if no heartbeat for N minutes, WaveWallet marks the device offline, shows it in the Super Admin card, and auto-approval falls back to the manual queue rather than silently stalling.
- Document the exact ColorOS settings path in an in-app checklist screen.

## 8. What you install and grant

Install: one APK (sideloaded), roughly 5–8 MB.

Grant, all explicitly by you:
- Notification Access (Settings → Notification & status bar → Notification access) — the core one.
- Post-notifications permission (Android 13+) for the foreground-service notification.
- Ignore battery optimisation + ColorOS auto-launch/background activity.
- Internet is a normal permission, no prompt.

Never requested and never stored: MPIN, GCash password, OTP, GCash login, SMS access, accessibility service, contacts.

## 9. APK for the Oppo Reno 13 Pro

Yes — a debug or self-signed release APK can be built and sideloaded (enable "Install unknown apps" for your browser/file manager). No Play Store listing needed; a Play listing would in fact be difficult, since notification-listener apps get heavy policy scrutiny. Building and signing the APK happens outside this web project — this environment can produce the Android source, but you (or a CI runner / Android Studio on a desktop) run the Gradle build that emits the installable file.

## 10. Security and reliability limitations — read before approving

- **Spoofable.** Any app on that phone that can post a notification imitating GCash can mint a payment event. Mitigation: package check, listener-only-on-your-device, per-event audit log, and an amount ceiling above which auto-approval is refused.
- **Single point of failure.** Phone off, no data, OS killed the service, GCash notifications muted → zero events, everything falls back to the manual queue. This must be a graceful degradation, not an outage.
- **Not reconciliation.** Notification text is not the GCash ledger. Reversals, holds and disputed transfers never appear. Periodic manual reconciliation against the real GCash statement stays necessary.
- **No reference number** in the notification, so amount + sender + time window is the only match key; two identical amounts from the same sender in the same window are genuinely ambiguous and should go to manual review rather than guess.
- **Privacy.** The service can technically read all notifications on the device; the app must filter to GCash at the earliest point and never transmit anything else.
- **Terms of service.** Reading GCash notifications is not a GCash-sanctioned integration. Low practical risk on a personal device, but it is not an approved channel.

## Recommended guard rails if we build it

Keep configured matching and the manual queue exactly as they are. Add the listener as an additional *corroborating* signal — a cash in auto-approves only when a listener event AND the member-submitted details agree — with a per-transaction and per-day auto-approval ceiling, and every automatic approval labelled as listener-backed in the audit trail.

## Suggested phasing

1. Backend only: device tables, signed `/api/public/payments/listener` endpoint, Super Admin device + event card. Testable with curl, zero Android work.
2. Android app: listener service, parser, queue, pairing, status screen, test-event button. Emitted as source in a separate project.
3. Field hardening on the Oppo: ColorOS settings checklist, heartbeat/dead-man switch, wording-drift monitoring.
