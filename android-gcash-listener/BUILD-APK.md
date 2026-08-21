# How to get the WaveWallet listener APK

## Which APK may be distributed

| Build | applicationId | Distributable? |
| --- | --- | --- |
| **release** (`assembleRelease`, signed with the WaveWallet keystore) | `com.wavewallet.gcashlistener` | **Yes — this is the only one.** Updates the installed listener in place, keeps pairing/settings. |
| debug (`assembleDebug`) | `com.wavewallet.gcashlistener.debug` | **No.** It is a *different* Android app: it installs side by side and can never update the production listener. |

The listener currently in the field is **v1.2.0 (versionCode 3)**, package
`com.wavewallet.gcashlistener`, signed with the WaveWallet release certificate
`8C:9A:D2:E7:C9:2B:F5:71:9D:03:E7:B6:0D:AC:60:45:2D:0C:AA:AB:58:83:A3:3C:D9:56:1E:A9:8B:23:E1:90`.
Any replacement APK must use that exact package **and** that exact signing key,
with a higher versionCode, or Android rejects the update
(`INSTALL_FAILED_UPDATE_INCOMPATIBLE`) or installs a second app.

Guardrails now enforce this:

- `app/build.gradle.kts` fails `assembleRelease`/`bundleRelease` outright when
  the `WW_KEYSTORE*` environment variables are absent, so an unsigned or
  debug-keyed "release" can never be produced by accident.
- `.github/workflows/build-gcash-listener-apk.yml` fails (rather than skips) the
  `release` job when the signing secrets are missing, and verifies package name,
  versionCode > 3, v2 signature, no debug key, and that the signer SHA-256
  matches the fingerprint above before uploading the artifact. The debug
  artifact is uploaded as `DEV-ONLY-gcash-listener-debug-apk-do-not-distribute`.

---

## Route A (recommended): let GitHub build it for you

You do not need Android Studio, a JDK or the Android SDK for this route.

### One-time setup

Nothing to copy anymore. The workflow already lives at the repository root as
`.github/workflows/build-apk.yml` (a duplicate is kept in
`android-gcash-listener/.github/workflows/build-apk.yml` for reference only).
Just make sure the Lovable project is synced to GitHub — the workflow is pushed
with the rest of the project and GitHub picks it up automatically.

### Every time you want a fresh APK

1. Open your repository on github.com.
2. Click the **Actions** tab (top of the page).
3. In the left sidebar click **Build listener APK**.
4. Click the **Run workflow** button on the right → **Run workflow** (green).
5. Wait roughly 5–10 minutes for the run to turn green.
6. Click the finished run, scroll to the bottom **Artifacts** box.
7. Download **`wavewallet-gcash-listener-release-apk`** (the debug artifact is development-only) — it downloads as a `.zip`.
8. Unzip it. Inside is **`app-debug.apk`**. That is the file you install.

### Install it on the Oppo Reno 13 Pro

1. Send/copy `app-debug.apk` to the phone (email, Google Drive, USB).
2. Tap the file → allow **Install unknown apps** for the app you opened it from.
3. Open **WaveWallet Listener**, then follow the pairing and ColorOS
   battery-permission steps in [README.md](./README.md).

The debug build installs under the id `com.wavewallet.gcashlistener.debug`, so it
can sit alongside a future signed release build.

### Signed release build (now wired up)

The workflow's `release` job runs on a manual **Run workflow** dispatch and
signs the APK when these repository secrets exist (Settings → Secrets and
variables → Actions):

- `WW_KEYSTORE_BASE64` — the keystore file, base64 encoded
- `WW_KEYSTORE_PASSWORD`, `WW_KEY_ALIAS`, `WW_KEY_PASSWORD`

The keystore is decoded into `$RUNNER_TEMP/signing/release.jks` (outside the
repository tree, mode 600) and deleted again in an `always()` step. Gradle picks
it up through the `WW_*` environment variables only; **no keystore, password or
alias is stored in this repository**, and no secret is echoed to the log.

After the build the job runs `apksigner verify --print-certs` and fails if the
APK is unsigned or still carries the Android debug key. Filename, size, SHA-256
and the signer certificate fingerprints are written to the run's job summary.

If the secrets are absent the job skips and `app/build.gradle.kts` produces an
unsigned release, leaving the debug build path untouched.

Package ids: release is `com.wavewallet.gcashlistener`, debug is
`com.wavewallet.gcashlistener.debug`. They are different apps, so the signed
release installs alongside a previously sideloaded debug build rather than
upgrading it — uninstall the debug app once the release is in use. Every future
release signed with the same keystore updates the release install in place.


---

## Route B: build it locally

Requires JDK 17 and the Android SDK (Android Studio installs both).

```bash
cd android-gcash-listener
./gradlew test           # run the parser / signing / queue unit tests
./gradlew assembleDebug  # produce the installable APK
```

The APK lands at:

```
android-gcash-listener/app/build/outputs/apk/debug/app-debug.apk
```

Opening the `android-gcash-listener` folder in Android Studio and pressing
**Run** does the same thing and installs straight onto a connected phone.

---

## What is already in place

- Complete standalone Gradle project (`settings.gradle.kts`, `build.gradle.kts`,
  `app/build.gradle.kts`).
- Gradle wrapper: `gradlew`, `gradlew.bat`, `gradle/wrapper/gradle-wrapper.jar`,
  `gradle/wrapper/gradle-wrapper.properties` (Gradle 8.7) — a CI runner can call
  `./gradlew` with nothing pre-installed but a JDK.
- JDK 17 / compileSdk 34 / minSdk 26, AGP 8.5.2, Kotlin 1.9.24.
- Launcher icon resources, so the manifest's `@mipmap/ic_launcher` resolves.
- Unit tests for the notification parser, the HMAC signing contract and the
  offline queue.

## Honest status

- **No APK has been compiled here.** No Android build has run in this
  environment, so nothing in this repo claims a successful Android compile.
- The GitHub Actions workflow is the only fully automated route left, and it
  needs the project pushed/synced to GitHub first.
- The listener stays advisory: it corroborates a Cash In, it never releases
  credits on its own, and "require listener confirmation" is off platform-wide.
