# How to get the WaveWallet listener APK

No APK has been produced yet. This environment has no Java JDK and no Android
SDK, so it cannot compile Android code. What follows are the two routes that
actually produce an installable `app-debug.apk`.

---

## Route A (recommended): let GitHub build it for you

You do not need Android Studio, a JDK or the Android SDK for this route.

### One-time setup

1. Connect this Lovable project to GitHub (Lovable top bar → **GitHub** →
   **Connect / Push to GitHub**). Everything in `android-gcash-listener/`,
   including the build workflow, is pushed with the rest of the project.
2. In your GitHub repository, copy the workflow file to the repository root so
   GitHub can see it:
   - the file lives here: `android-gcash-listener/.github/workflows/build-apk.yml`
   - GitHub only runs workflows found at `.github/workflows/` in the **repo root**
   - so copy it to `.github/workflows/build-apk.yml` (the file itself already
     knows the app is in the `android-gcash-listener` subfolder)
   - easiest way, in the GitHub web UI: open the file → **Copy raw file** →
     go to the repo root → **Add file → Create new file** → name it
     `.github/workflows/build-apk.yml` → paste → **Commit changes**.

### Every time you want a fresh APK

1. Open your repository on github.com.
2. Click the **Actions** tab (top of the page).
3. In the left sidebar click **Build listener APK**.
4. Click the **Run workflow** button on the right → **Run workflow** (green).
5. Wait roughly 5–10 minutes for the run to turn green.
6. Click the finished run, scroll to the bottom **Artifacts** box.
7. Download **`wavewallet-gcash-listener-debug-apk`** — it downloads as a `.zip`.
8. Unzip it. Inside is **`app-debug.apk`**. That is the file you install.

### Install it on the Oppo Reno 13 Pro

1. Send/copy `app-debug.apk` to the phone (email, Google Drive, USB).
2. Tap the file → allow **Install unknown apps** for the app you opened it from.
3. Open **WaveWallet Listener**, then follow the pairing and ColorOS
   battery-permission steps in [README.md](./README.md).

The debug build installs under the id `com.wavewallet.gcashlistener.debug`, so it
can sit alongside a future signed release build.

### Optional signed release build

The workflow also has a `release` job. It runs only when you manually dispatch
the workflow **and** these repository secrets exist (Settings → Secrets and
variables → Actions):

- `WW_KEYSTORE_BASE64` — your keystore file, base64 encoded
- `WW_KEYSTORE_PASSWORD`, `WW_KEY_ALIAS`, `WW_KEY_PASSWORD`

If they are absent the job simply skips. **No keystore, password or signing key
is stored in this repository**, and nothing is created for you — a signed
release is optional and only needed for Play Store style distribution. Sideloading
the debug APK is enough for your own phone. To use it you must also uncomment the
`signingConfigs` block in `app/build.gradle.kts`.

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
