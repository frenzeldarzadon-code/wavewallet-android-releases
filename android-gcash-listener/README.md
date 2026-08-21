# WaveWallet GCash Notification Listener (Android companion app)

Phase 2 of the GCash automatic Cash In verification. This app forwards **GCash
"money received" notifications only** to the Phase 1 endpoint
`POST /api/public/payments/listener`.

It is corroborating evidence, nothing more:

- The app **never** approves a Cash In and **never** touches a wallet. WaveWallet
  is the only authority.
- No GCash credentials, MPIN, OTP, SMS, contacts, accessibility or storage
  permission is requested or stored.
- No Supabase key, service-role key or database secret exists anywhere in the app.

## Build status in this environment

**There is no installable APK yet.** This sandbox has no JDK and no Android SDK,
so Gradle cannot run here. The complete source and release build configuration
are ready; compiling requires Android Studio (Koala or newer) or a CI runner
with JDK 17 + Android SDK 34.

```bash
# on a machine with Android Studio / the Android SDK
cd android-gcash-listener
./gradlew test            # unit tests (parser, signing, queue, pairing)
./gradlew assembleDebug   # app/build/outputs/apk/debug/app-debug.apk
./gradlew assembleRelease # signed release: fill in signingConfigs in app/build.gradle.kts
```

The parser rules and the HMAC/SHA-256 vectors in `SigningTest` were verified
against the Phase 1 server implementation with a portable harness before commit.

## What the app does

| Piece | File |
| --- | --- |
| Notification reading (GCash package only) | `service/GcashNotificationListener.kt` |
| Versioned, safety-first parser | `parser/GcashParser.kt` |
| Stable event UID / duplicate protection | `crypto/EventUid.kt` |
| Phase 1 HMAC signing | `crypto/ListenerSigner.kt` |
| Keystore-backed pairing storage | `store/PairingStore.kt` |
| Durable Room queue | `data/ListenerDb.kt` |
| Signed delivery | `net/ListenerClient.kt` |
| Retry/backoff + heartbeat | `work/ListenerWork.kt` |
| Foreground service + boot restart | `service/ListenerForegroundService.kt`, `service/BootReceiver.kt` |
| UI: pairing, status, checklist, test event | `ui/MainActivity.kt` |

### Parser safety

Only the incoming shape is accepted, e.g.

```
You have received money in GCash! You have received PHP 10.00 of GCash from FR****L A. 09070321959.
```

Sent-money, cash-out, bills, GCredit/GInvest, promos and reminders are ignored
outright and never leave the phone. A notification that *looks* like an incoming
payment but cannot be read is queued as **unparsed** (null amount) — Phase 1
records it for review and can never auto-approve it. Patterns are versioned
(`gcash-ph-v1`, sent as `parser_version`) so wording changes are a deliberate
update rather than loose matching.

### Duplicate safety

The event UID is `sha256(notificationKey | postedAt | exactText)`. A reposted or
updated notification for the same payment produces the same UID and is dropped
by a unique index locally and rejected as a replay server-side. Two genuine
payments of the same amount from the same sender at different times have
different posted times, so they stay separate — sender + amount is never used as
a key.

### Signing contract (identical to Phase 1)

```
hmacKey   = hex(SHA-256(pairing secret))
payload   = "<deviceId>.<unixSeconds>.<uuidNonce>.<rawJsonBody>"
headers   = x-listener-device, x-listener-ts, x-listener-nonce, x-listener-sig
```

The pairing secret itself is consumed at pairing time, converted to the derived
key, stored in Keystore-backed `EncryptedSharedPreferences`, and never logged or
displayed again.

## WaveWallet SuperAdmin setup note

1. Sign in to WaveWallet as Super Admin and open **Super Admin → Settings**.
2. In **GCash notification listener**, enter a device name (e.g. "Oppo Reno 13
   Pro") and the match window in minutes, then **Register device**.
3. Copy the **Device ID** and the **pairing secret** — the secret is displayed
   once and cannot be retrieved later. If it is lost, revoke the device and
   register a new one.
4. Keep `require_listener_match` OFF while testing.

## Setup on the Oppo Reno 13 Pro (ColorOS)

1. Install the APK (build it first — see above) and open **WaveWallet Listener**.
2. **Pair device**: WaveWallet URL `https://wallet.sagadawave.com`, then paste the
   Device ID and one-time pairing secret. Tap **Pair**.
3. Tap **Open Notification Access settings** and enable **WaveWallet Listener**.
4. Allow the app's own notifications when Android asks (Android 13+).
5. ColorOS background survival:
   - Settings → Battery → this app → **Allow background activity** / don't optimise.
   - Settings → Battery → Power Saving → disable **Sleep standby optimisation**.
   - App management → this app → enable **Auto-launch** and **Allow background running**.
   - Open Recents, swipe down on the app card and **Lock** it.
   - Leave the persistent "listener active" notification enabled.
6. Tap **Send heartbeat** — the Super Admin card should show the device Online.
7. Tap **Send test event** — it carries no amount, is marked `[TEST]`, and can
   never approve a Cash In.
8. Finally, have someone send a small real GCash payment and confirm the
   notification appears in **Recent events** and in the Super Admin log.

The listener is only operational once the app is installed, paired, Notification
Access is granted, and a heartbeat has succeeded.

## Getting an installable APK

This project has not been compiled in Lovable (no JDK / Android SDK there).
See **[BUILD-APK.md](./BUILD-APK.md)** for the exact click-by-click path:

- **GitHub Actions (no tools needed):** the workflow lives at
  `.github/workflows/build-gcash-listener-apk.yml`; go to Actions → *Build GCash
  listener APK* → **Run workflow** → download the
  **wavewallet-gcash-listener-release-apk** artifact. That signed release APK
  (package `com.wavewallet.gcashlistener`) is the only build that may be given
  to operators: it updates the installed listener and preserves pairing. The
  `DEV-ONLY-...-debug-apk-do-not-distribute` artifact is
  `com.wavewallet.gcashlistener.debug`, a separate app for development only.
- **Locally (JDK 17 + Android SDK):**

  ```bash
  cd android-gcash-listener
  ./gradlew test
  ./gradlew assembleDebug
  # -> app/build/outputs/apk/debug/app-debug.apk
  ```
