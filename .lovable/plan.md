# Push Notification Audit — WaveWallet (inspection only, no changes made)

**Verdict: there are NO true OS-level push notifications today.** The app has a complete
in-app notification centre plus an honest "device registry" scaffold, but no push provider,
no FCM, no VAPID keys, and no server-side sender. Nothing can reach a phone whose app is
closed.

## 1. Android APK / native wrapper — no push provider

`android-app/` is a plain WebView shell (`MainActivity.kt`, `AboutActivity.kt`,
`ImageSaver.kt`, `NetworkStatus.kt`).

- `android-app/app/build.gradle.kts` dependencies: `core-ktx`, `appcompat`, `activity-ktx`,
  `webkit`, `swiperefreshlayout`, `junit`. **No `firebase-bom`, no `firebase-messaging`,
  no `com.google.gms.google-services` plugin** (root `build.gradle.kts` has only AGP +
  Kotlin). No `google-services.json` anywhere in the repo.
- No OneSignal / Airship / Pusher / any alternative provider.
- The only push-adjacent Android code in the repo belongs to a different app,
  `android-gcash-listener/`, which *reads* GCash notifications (`NotificationListenerService`)
  and posts them to the backend. It does not deliver notifications to customers.

## 2. Android 13+ permission and channels — missing in the customer app

`android-app/app/src/main/AndroidManifest.xml` declares only `INTERNET` and
`ACCESS_NETWORK_STATE`. **No `POST_NOTIFICATIONS`**, no runtime permission request, no
`NotificationChannel` creation, no notification-posting code in `MainActivity.kt`.

(The listener app does declare `POST_NOTIFICATIONS` and creates a channel in
`service/ListenerForegroundService.kt` — that is the operator's own tool, not the customer APK.)

## 3. Token collection — no FCM tokens; browser-subscription scaffold only

- No `FirebaseMessaging.getInstance().token`, no `onNewToken` anywhere.
- The web app has `public.push_devices` (migration `20260817065540…`) with
  `endpoint`, `p256dh`, `auth`, `push_enabled`, `expired_at`, RLS scoped to `auth.uid()`,
  written through `public.register_push_device(...)` (EXECUTE revoked from `anon`).
  So there *is* a secure, user-associated device registry — it is just fed by the Web Push
  API, not FCM.
- `src/lib/financial-notifications.ts` → `browserSubscription()` returns `null` unless
  `VITE_VAPID_PUBLIC_KEY` is set. **It is not set in `.env`**, so every registration stores a
  local device id with no real push endpoint.

## 4. Background/closed-app receiver — none

- No `FirebaseMessagingService` subclass in the APK.
- The service worker (`vite-plugin-pwa` in `vite.config.ts`, emitted as `/sw.js`) is
  Workbox caching only: `globPatterns`, `runtimeCaching`. **No `push` event listener and no
  `notificationclick` handler.** A WebView also does not run a site service worker for push.
- Consequence: nothing can display a notification while WaveWallet is backgrounded or closed.

## 5. Server-side sender — does not exist

- `public.notify_financial` / `notify_financial_safe` (migration `20260817070138…`) insert a
  row into `member_notifications` (idempotent on `event_key`), then insert
  `notification_deliveries` rows with status `pending` per active device — or `skipped` with
  reason `category_muted` / `account_push_disabled` / `no_active_device`.
- **Nothing ever moves a row from `pending` to `sent`.** There is no web-push library, no FCM
  HTTP v1 call, no Admin SDK, no Edge Function or server route that sends. `src/routes/api/public/`
  contains only `app-version.ts` and `payments/listener.ts`.

## 6. Financial events → push? No; in-app rows only

The financial wiring itself is correct and post-commit: money RPCs call `notify_financial_safe`
after the ledger write, with categories in `src/lib/financial-notifications.ts`
(`cash_in`, `purchase`, `cashback`, `transfer`, `points`, `reward_redemption`, `refund`,
`withdrawal`, `wallet_adjustment`). A raw GCash listener detection does **not** notify — only a
confirmed transaction does, which already matches your desired rule. But the outcome is an
in-app row plus, at best, `showBrowserNotification()` in `src/lib/notifications.ts`, which
only fires while a tab is open and focused.

## 7. Deep links — half present

`member_notifications.link` is stored and `notificationLink()` (`src/lib/notifications.ts`)
routes in-app taps via `NotificationBell` / `universe/notifications-page.tsx`. There is no
`notificationclick` handler and no Android intent/deep-link path, so a *system* notification
tap has no route today.

## 8. In-app centre vs real push

| Layer | Status |
| --- | --- |
| In-app notification centre (bell, `/universe/notifications`, prefs, delivery log) | Implemented |
| Foreground browser alert while a tab is open | Implemented (`showBrowserNotification`) |
| Device registry + per-category preferences + delivery audit | Implemented, unused for sending |
| OS push with app closed | **Not implemented** |

`src/lib/notifications.ts` already documents this honestly in `PUSH_REQUIREMENTS`.

## 9. Minimum work to get GCash-style push on the current APK

Recommended path: **FCM in the native APK** (a WebView cannot receive Web Push reliably on Android).

1. Add Firebase to `android-app`: `google-services` plugin, `firebase-messaging`,
   `google-services.json`.
2. Add `POST_NOTIFICATIONS` to the manifest, request it at runtime on Android 13+, and create
   a high-importance "Money alerts" channel.
3. Add a `FirebaseMessagingService` (`onNewToken`, `onMessageReceived`) that posts a
   notification with a `PendingIntent` carrying the `link`, and have `MainActivity` load that
   path in the WebView.
4. Bridge the signed-in user to the token: a JS interface exposing the FCM token to the web
   layer so it can call `register_push_device` with a new `provider='fcm'` / `token` column —
   the existing table, RLS and preferences then apply unchanged.
5. Backend sender: a TanStack server route/cron that reads `notification_deliveries` rows with
   status `pending`, calls FCM HTTP v1 with a service-account secret, and marks
   `sent`/`failed` + `expired_at` on `UNREGISTERED`. Keep it triggered only by committed
   financial events (already the case).
6. Optional web parity: generate VAPID keys, set `VITE_VAPID_PUBLIC_KEY`, add `push` +
   `notificationclick` handlers to the service worker, and send via `web-push` for desktop
   browsers.

iOS: nothing in the current architecture supports it — there is no iOS app and no APNs
configuration. It would require a separate wrapper plus APNs (reachable through the same FCM
sender once built).

No files were changed, no commit made, nothing published.
