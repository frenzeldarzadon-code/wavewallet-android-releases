# Admin APK distribution — findings first, then the build plan

## Finding: no APK can be produced inside this project environment

Inspection results:

- `android-gcash-listener/` contains complete Kotlin source only. There is no `app/build/` output and no `.apk` file anywhere in the project.
- The environment has **no JDK, no Gradle, no Android SDK** (`java`, `javac`, `gradle`, `sdkmanager` all absent). An Android compile cannot run here.
- `app/build.gradle.kts` has `versionCode = 1`, `versionName = "1.0.0"`, `applicationId = com.wavewallet.gcashlistener`, and the `signingConfigs` block is still commented out. No keystore exists in the repo (correctly — none should).

So: **a signed release APK cannot be generated here today**, and I will not fabricate signing material. The debug APK you already built is usable for controlled sideloading (it installs as `com.wavewallet.gcashlistener.debug`), but it is signed with the throwaway Android debug key, so future updates cannot be signed consistently and Play Protect warns harder. Recommended path is a release build, but the mechanics of producing the binary must happen where a JDK + Android SDK exists (your GitHub Actions runner or Android Studio).

## What is required for a proper signed release APK

You (not me, and never pasted into chat) create these repository secrets in GitHub → Settings → Secrets and variables → Actions:

- `WW_KEYSTORE_BASE64` — base64 of a keystore you generate locally with `keytool`
- `WW_KEYSTORE_PASSWORD`, `WW_KEY_ALIAS`, `WW_KEY_PASSWORD`

The existing `release` job in `.github/workflows/build-apk.yml` already consumes exactly those and skips when absent. One code change is needed on my side: uncomment the `signingConfigs` block and the `signingConfig` line in `app/build.gradle.kts` so the release job actually signs. Keep the keystore file backed up — losing it means future builds cannot upgrade installs in place.

## The distribution mechanism I will build now (no fake download)

Rather than link a GitHub artifact or repo, the APK binary is stored once in the project's own private storage bucket and served to Admins through a short-lived signed URL. No GitHub login, works for every authorised Admin.

1. **Storage + registry**
   - New private bucket `listener-apk`.
   - New table `public.listener_app_releases`: `id`, `version_name`, `version_code`, `build_type` (`debug` | `release`), `storage_path`, `size_bytes`, `sha256`, `notes`, `is_current`, `uploaded_by`, `created_at`. GRANTs + RLS: `SELECT` for authenticated members who are shop admin or super admin; writes restricted to super admin only.
2. **Super Admin upload** — a new panel inside the existing GCash notification listener card on the Super Admin platform settings page. Super Admin picks the `.apk` file; the browser computes the SHA-256 from the actual bytes (`crypto.subtle.digest`), uploads to the bucket, and records size/version/hash. The stored hash is always derived from the uploaded binary — never typed in.
3. **Admin download** — a new "Android GCash Listener" section inside the existing `ListenerDevicesCard` (already rendered on `admin.settings.tsx` and reused by Super Admin). It shows version name/code, build type, file size, the full SHA-256 with a copy button, and a Download button that fetches a signed URL on click. Until a release row exists, the section states plainly that the app has not been published yet and shows no button — no placeholder link.
4. **Install guidance** — collapsible instructions rendered next to the download: enable install from unknown sources, grant **Notification access**, allow **Restricted settings** on Android 13+ (Settings → Apps → app info → three dots → Allow restricted settings), disable battery optimisation / allow background activity (ColorOS: also lock the app in Recents), keep GCash notifications unmuted, then pair with the Device ID + one-time pairing secret from this same card. Play Protect note: for a self-distributed APK "Install anyway" may be required — verify the SHA-256 shown here against the downloaded file before installing, and never install a listener APK obtained from anywhere else.

## Explicitly not changed

- Super Admin listener behaviour, pairing, destination-aware matching, verification layers, Cash In/Cash Out, fees, wallets, reservations, and RLS all stay exactly as they are. This work only adds a release registry, a bucket, and UI inside the existing listener card.
- Nothing is published separately; this rides along with the final master-spec publish after tests, typecheck and build pass.

## Decision needed from you

Pick one before I implement step 1–4:

- **A (preferred)** — you add the four signing secrets, I uncomment the signing config, you dispatch the workflow, then upload the signed release APK through the new Super Admin panel.
- **B (interim)** — you upload the debug APK you already built through the same panel; it is recorded as `build_type = debug` and the UI labels it as a test build. The mechanism is identical, so swapping in a signed release later is just another upload.

Either way the mechanism gets built now and stays empty-but-honest until a real binary is uploaded.
