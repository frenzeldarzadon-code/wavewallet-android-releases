/**
 * WaveWallet update metadata — the single source of truth for releases.
 *
 * This file carries NO secrets and NO business logic. It only describes which
 * web build and which native Android build are current, so an installed shell
 * or PWA can tell whether it is running the latest release.
 *
 * How to cut a release:
 *  - Web only (HTML/CSS/JS, server functions): bump WEB_VERSION. The build id
 *    changes automatically on every deploy, so a refresh is enough.
 *  - Native Android changes (MainActivity.kt, ImageSaver.kt, permissions):
 *    bump versionCode/versionName in android-app/app/build.gradle.kts AND the
 *    ANDROID_* values below, then publish a new signed APK. A web deploy alone
 *    can NEVER update native code.
 */

declare const __WW_BUILD__: string | undefined;

/** Human web release version. */
export const WEB_VERSION = "1.1.0";

/** Unique per deploy; injected at build time by vite.config.ts. */
export const WEB_BUILD_ID: string =
  typeof __WW_BUILD__ === "string" && __WW_BUILD__ ? __WW_BUILD__ : "dev";

/** Latest published native Android release. Must match android-app/app/build.gradle.kts. */
export const ANDROID_VERSION_CODE = 3;
export const ANDROID_VERSION_NAME = "1.1.1";
/**
 * Oldest native build still considered compatible. Anything below this is
 * missing native capabilities the web layer relies on (voucher image saving).
 */
export const ANDROID_MIN_VERSION_CODE = 2;

/**
 * The one allowed destination for a native update. Never an arbitrary URL:
 * this is the permanent signed APK asset published on the official public
 * release repository.
 */
export const ANDROID_UPDATE_URL =
  "https://github.com/frenzeldarzadon-code/wavewallet-android-releases/releases/download/v1.1.1/WaveWallet-1.1.1.apk";

/** SHA-256 of the published 1.1.1 APK, for verification on the download page. */
export const ANDROID_SHA256 =
  "4af79779ce316190b3afd4c796d87bd542c358d8d8b6966c5a4853c75f7f284d";

export const RELEASE_NOTES =
  "Voucher images now save reliably to Downloads inside the Android app, and WaveWallet can check for web and app updates from Profile.";

export interface UpdateManifest {
  web: { version: string; buildId: string };
  android: {
    versionCode: number;
    versionName: string;
    minVersionCode: number;
    updateUrl: string;
  };
  notes: string;
  checkedAt: string;
}

export function buildUpdateManifest(): UpdateManifest {
  return {
    web: { version: WEB_VERSION, buildId: WEB_BUILD_ID },
    android: {
      versionCode: ANDROID_VERSION_CODE,
      versionName: ANDROID_VERSION_NAME,
      minVersionCode: ANDROID_MIN_VERSION_CODE,
      updateUrl: ANDROID_UPDATE_URL,
    },
    notes: RELEASE_NOTES,
    checkedAt: new Date().toISOString(),
  };
}
