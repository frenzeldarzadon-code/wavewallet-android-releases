# WaveWallet Android app

A thin, hardened Android shell around the published WaveWallet web app
(`https://wallet.sagadawave.com`). It is the same product, the same accounts,
the same backend — the app contains **no** ledger, no business rules, no API
keys and no second database.

- Application ID: `com.wavewallet.app` (debug builds: `com.wavewallet.app.debug`)
- Version: `1.0.0` (versionCode `1`)
- minSdk 24, targetSdk 34
- Splash + launcher icon generated from the WaveWallet brand icons
- About/version screen: long-press the launcher icon → **About WaveWallet**

## What the shell does and does not do

- Loads only `wallet.sagadawave.com` / `sagada-wave-wallet.lovable.app` over
  HTTPS; any other link opens in the system browser.
- Keeps cookies + localStorage so login/session behaves exactly like the site.
- Supports file pickers (payment screenshots, avatars).
- Shows an offline banner and an offline screen. It never queues, caches or
  replays a financial action: transfers, voucher purchases, cash in/out and
  subscription payments are always authorised server-side.
- Mixed content blocked, cleartext blocked, file/content access disabled,
  remote debugging disabled, no JavaScript bridge into native code.

## Build

CI: GitHub Actions workflow `.github/workflows/build-wavewallet-apk.yml`.
Every push builds and uploads `wavewallet-debug-apk`. A manual
**Run workflow** (workflow_dispatch) additionally builds and verifies a signed
release APK when the signing secrets exist.

Locally (needs JDK 17 + Android SDK 34):

```bash
cd android-app
./gradlew testDebugUnitTest assembleDebug
# → app/build/outputs/apk/debug/app-debug.apk
```

## Release signing (one-time, done by the owner)

Create a keystore and keep it forever — updates must be signed with the same
key or Android refuses to install over the existing app.

```bash
keytool -genkeypair -v -keystore wavewallet-release.jks \
  -alias wavewallet -keyalg RSA -keysize 4096 -validity 10000
base64 -w0 wavewallet-release.jks > wavewallet-release.jks.b64   # Windows: certutil -encode
```

Add these GitHub repository secrets (Settings → Secrets and variables →
Actions):

| Secret | Value |
| --- | --- |
| `WW_APP_KEYSTORE_BASE64` | contents of `wavewallet-release.jks.b64` |
| `WW_APP_KEYSTORE_PASSWORD` | keystore password |
| `WW_APP_KEY_ALIAS` | `wavewallet` |
| `WW_APP_KEY_PASSWORD` | key password |

Then run the workflow manually and download `wavewallet-release-apk`.

## Shipping updates

Bump `versionCode` (and `versionName`) in `app/build.gradle.kts`, rebuild with
the **same** keystore, and install the new APK over the old one. The
application ID and signing identity stay identical, so accounts, sessions and
data are untouched.
