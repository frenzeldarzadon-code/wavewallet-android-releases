/**
 * Update checking for both layers of WaveWallet.
 *
 * Web/PWA: a new deploy changes the build id, so the app only has to reload to
 * run the newest assets. Native Android: the shell is an installed APK, so a
 * web deploy can never change native code — a new APK must be installed by the
 * user through Android's own installer.
 *
 * Nothing here touches wallets, Coins, vouchers, pricing or authorization, and
 * an update never clears credentials, sessions or stored app data.
 */
import {
  WEB_BUILD_ID,
  WEB_VERSION,
  type UpdateManifest,
} from "@/lib/update-manifest";

export const VERSION_ENDPOINT = "/api/public/app-version";
const LAST_CHECK_KEY = "ww.update.lastChecked";
/** Never poll more often than this, so fast voucher selling stays untouched. */
export const MIN_CHECK_INTERVAL_MS = 30 * 60 * 1000;

export interface NativeVersion {
  versionCode: number;
  versionName: string;
  packageName?: string;
}

export interface UpdateState {
  currentWebVersion: string;
  currentWebBuild: string;
  latestWebVersion: string | null;
  latestWebBuild: string | null;
  webUpdateAvailable: boolean;
  native: NativeVersion | null;
  latestAndroid: { versionCode: number; versionName: string } | null;
  androidUpdateAvailable: boolean;
  androidUpdateRequired: boolean;
  androidUpdateUrl: string | null;
  notes: string | null;
  /** True when the manifest could not be reached — the app stays usable. */
  offline: boolean;
  checkedAt: number;
}

interface NativeBridge {
  saveImage?: (b: string, f: string) => boolean | void;
  getAppVersion?: () => string;
  openUpdatePage?: () => boolean | void;
}

export function nativeBridge(): NativeBridge | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { WaveWalletNative?: NativeBridge };
  return w.WaveWalletNative ?? null;
}

/** Installed Android shell version, or null in a plain browser/PWA. */
export function readNativeVersion(): NativeVersion | null {
  const bridge = nativeBridge();
  if (typeof bridge?.getAppVersion !== "function") return null;
  try {
    const parsed = JSON.parse(bridge.getAppVersion()) as Partial<NativeVersion>;
    if (typeof parsed?.versionCode !== "number") return null;
    return {
      versionCode: parsed.versionCode,
      versionName: String(parsed.versionName ?? parsed.versionCode),
      packageName: parsed.packageName,
    };
  } catch {
    return null;
  }
}

/** True when the page is running inside the WaveWallet Android shell. */
export function isAndroidShell(): boolean {
  return readNativeVersion() !== null;
}

/** Pure comparison used by the update state and by tests. */
export function evaluateUpdate(
  local: { buildId: string; version: string; native: NativeVersion | null },
  manifest: UpdateManifest | null,
): Omit<UpdateState, "checkedAt"> {
  const base = {
    currentWebVersion: local.version,
    currentWebBuild: local.buildId,
    native: local.native,
  };
  if (!manifest) {
    return {
      ...base,
      latestWebVersion: null,
      latestWebBuild: null,
      webUpdateAvailable: false,
      latestAndroid: null,
      androidUpdateAvailable: false,
      androidUpdateRequired: false,
      androidUpdateUrl: null,
      notes: null,
      offline: true,
    };
  }
  const latestBuild = manifest.web.buildId;
  // A dev build id never triggers an update prompt.
  const webUpdateAvailable =
    Boolean(latestBuild) && local.buildId !== "dev" && latestBuild !== local.buildId;
  const code = local.native?.versionCode ?? null;
  return {
    ...base,
    latestWebVersion: manifest.web.version,
    latestWebBuild: latestBuild,
    webUpdateAvailable,
    latestAndroid: {
      versionCode: manifest.android.versionCode,
      versionName: manifest.android.versionName,
    },
    androidUpdateAvailable: code !== null && code < manifest.android.versionCode,
    androidUpdateRequired: code !== null && code < manifest.android.minVersionCode,
    androidUpdateUrl: manifest.android.updateUrl,
    notes: manifest.notes ?? null,
    offline: false,
  };
}

async function fetchManifest(signal?: AbortSignal): Promise<UpdateManifest | null> {
  try {
    const res = await fetch(VERSION_ENDPOINT, { cache: "no-store", signal });
    if (!res.ok) return null;
    return (await res.json()) as UpdateManifest;
  } catch {
    return null; // Offline or unreachable: fail safely, never block the app.
  }
}

/**
 * Critical-operation guard.
 *
 * A voucher purchase, transfer or cash transaction increments this; while it is
 * non-zero the background check is skipped and no reload is suggested.
 */
let critical = 0;
export function beginCriticalOperation(): () => void {
  critical += 1;
  let done = false;
  return () => {
    if (done) return;
    done = true;
    critical = Math.max(0, critical - 1);
  };
}
export function isCriticalOperationActive(): boolean {
  return critical > 0;
}

export function lastCheckedAt(): number {
  if (typeof localStorage === "undefined") return 0;
  return Number(localStorage.getItem(LAST_CHECK_KEY) ?? 0) || 0;
}

function rememberCheck(at: number) {
  try {
    localStorage.setItem(LAST_CHECK_KEY, String(at));
  } catch {
    /* private mode — checking still works, it just is not remembered */
  }
}

/** Runs one update check. `background` respects the throttle and the guard. */
export async function checkForUpdates(
  options: { background?: boolean; signal?: AbortSignal } = {},
): Promise<UpdateState | null> {
  const now = Date.now();
  if (options.background) {
    if (isCriticalOperationActive()) return null;
    if (now - lastCheckedAt() < MIN_CHECK_INTERVAL_MS) return null;
  }
  const manifest = await fetchManifest(options.signal);
  const state: UpdateState = {
    ...evaluateUpdate(
      { buildId: WEB_BUILD_ID, version: WEB_VERSION, native: readNativeVersion() },
      manifest,
    ),
    checkedAt: now,
  };
  if (manifest) rememberCheck(now);
  return state;
}

/**
 * Loads the newest web assets.
 *
 * Only the app-shell caches written by our own service worker are dropped;
 * authentication, IndexedDB and any local app state are left untouched.
 */
export async function applyWebUpdate(): Promise<void> {
  try {
    if (typeof caches !== "undefined") {
      const names = await caches.keys();
      await Promise.allSettled(
        names.filter((n) => n.startsWith("ww-") || n.includes("precache")).map((n) => caches.delete(n)),
      );
    }
    if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.allSettled(regs.map((r) => r.update()));
    }
  } catch {
    /* a cache problem must never stop the reload */
  }
  window.location.reload();
}

/** Opens the official Android update destination — never an arbitrary URL. */
export function openAndroidUpdate(url: string | null): boolean {
  const bridge = nativeBridge();
  if (typeof bridge?.openUpdatePage === "function") {
    try {
      return bridge.openUpdatePage() !== false;
    } catch {
      /* fall through to the web route */
    }
  }
  if (!url) return false;
  window.open(url, "_blank", "noopener");
  return true;
}
