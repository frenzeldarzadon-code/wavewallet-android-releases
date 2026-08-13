/**
 * Super Admin profile: personal preferences, profile completion and the
 * read-only platform snapshot shown on the profile page.
 *
 * Everything here is derived from data the console already owns — the
 * `platform_overview` RPC, `audit_logs` and the caller's own profile row.
 * Nothing invents figures: an unavailable value is reported as unknown so the
 * UI can render an honest empty state instead of a placeholder number.
 */
import type { Json } from "@/integrations/supabase/types";
import { platformMrr, type EcosystemOverviewRow } from "@/lib/platform-overview";

/* ------------------------------------------------------------------ */
/* Preferences                                                         */
/* ------------------------------------------------------------------ */

export type AppearanceMode = "system" | "light" | "dark";

export interface MemberPreferences {
  timezone: string;
  language: string;
  appearance: AppearanceMode;
  /** Interface density preference. */
  compact: boolean;
  notifySubscriptions: boolean;
  notifyApplications: boolean;
  notifySecurity: boolean;
}

export const DEFAULT_PREFERENCES: MemberPreferences = {
  timezone: "Asia/Manila",
  language: "en-PH",
  appearance: "system",
  compact: false,
  notifySubscriptions: true,
  notifyApplications: true,
  notifySecurity: true,
};

export const TIMEZONES = [
  "Asia/Manila",
  "Asia/Singapore",
  "Asia/Hong_Kong",
  "Asia/Tokyo",
  "Australia/Sydney",
  "Europe/London",
  "America/Los_Angeles",
  "UTC",
] as const;

export const LANGUAGES: Array<{ value: string; label: string }> = [
  { value: "en-PH", label: "English (Philippines)" },
  { value: "en-US", label: "English (US)" },
  { value: "fil-PH", label: "Filipino" },
];

const APPEARANCES: AppearanceMode[] = ["system", "light", "dark"];

/** Tolerant reader: unknown or malformed stored values fall back to defaults. */
export function parsePreferences(raw: Json | null | undefined): MemberPreferences {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ...DEFAULT_PREFERENCES };
  const obj = raw as Record<string, unknown>;
  const str = (key: keyof MemberPreferences, fallback: string) => {
    const v = obj[key];
    return typeof v === "string" && v.trim() ? v : fallback;
  };
  const bool = (key: keyof MemberPreferences, fallback: boolean) => {
    const v = obj[key];
    return typeof v === "boolean" ? v : fallback;
  };
  const appearance = str("appearance", DEFAULT_PREFERENCES.appearance) as AppearanceMode;
  return {
    timezone: str("timezone", DEFAULT_PREFERENCES.timezone),
    language: str("language", DEFAULT_PREFERENCES.language),
    appearance: APPEARANCES.includes(appearance) ? appearance : "system",
    compact: bool("compact", DEFAULT_PREFERENCES.compact),
    notifySubscriptions: bool("notifySubscriptions", DEFAULT_PREFERENCES.notifySubscriptions),
    notifyApplications: bool("notifyApplications", DEFAULT_PREFERENCES.notifyApplications),
    notifySecurity: bool("notifySecurity", DEFAULT_PREFERENCES.notifySecurity),
  };
}

/** Only the keys that actually changed travel to the database. */
export function preferencesPatch(
  next: MemberPreferences,
  previous: MemberPreferences,
): Partial<MemberPreferences> | null {
  const patch: Record<string, unknown> = {};
  (Object.keys(next) as Array<keyof MemberPreferences>).forEach((key) => {
    if (next[key] !== previous[key]) patch[key] = next[key];
  });
  return Object.keys(patch).length ? (patch as Partial<MemberPreferences>) : null;
}

export const APPEARANCE_KEY = "wavewallet.appearance";

/** Applies the saved appearance to the document; "system" follows the OS. */
export function applyAppearance(mode: AppearanceMode) {
  if (typeof document === "undefined") return;
  const prefersDark =
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
      : false;
  const dark = mode === "dark" || (mode === "system" && prefersDark);
  document.documentElement.classList.toggle("dark", dark);
  try {
    window.localStorage.setItem(APPEARANCE_KEY, mode);
  } catch {
    /* storage is a convenience only */
  }
}

/* ------------------------------------------------------------------ */
/* Profile completion                                                  */
/* ------------------------------------------------------------------ */

export interface CompletionField {
  label: string;
  done: boolean;
}

export interface ProfileCompletion {
  percent: number;
  fields: CompletionField[];
  missing: string[];
}

/** Completion is computed from real, editable fields only. */
export function profileCompletion(input: {
  fullName?: string | null | undefined;
  handle?: string | null | undefined;
  email?: string | null | undefined;
  phone?: string | null | undefined;
  bio?: string | null | undefined;
  avatarPath?: string | null | undefined;
}): ProfileCompletion {
  const has = (v?: string | null) => Boolean((v ?? "").trim());
  const fields: CompletionField[] = [
    { label: "Display name", done: has(input.fullName) },
    { label: "@handle", done: has(input.handle) },
    { label: "Email address", done: has(input.email) },
    { label: "Phone number", done: has(input.phone) },
    { label: "Profile bio", done: has(input.bio) },
    { label: "Profile photo", done: has(input.avatarPath) },
  ];
  const done = fields.filter((f) => f.done).length;
  return {
    percent: Math.round((done / fields.length) * 100),
    fields,
    missing: fields.filter((f) => !f.done).map((f) => f.label),
  };
}

/* ------------------------------------------------------------------ */
/* Platform snapshot                                                   */
/* ------------------------------------------------------------------ */

export interface PlatformSnapshot {
  ecosystems: number;
  archived: number;
  admins: number;
  resellers: number;
  users: number;
  mrr: number;
  frozen: number;
  overdue: number;
}

type SnapshotRow = Pick<
  EcosystemOverviewRow,
  | "admin_count"
  | "reseller_count"
  | "subreseller_count"
  | "customer_count"
  | "archived_at"
  | "operations_frozen"
  | "subscription_state"
  | "plan_price"
>;

/**
 * Live counters across every tenant. Archived shops are excluded from the
 * active figures but still reported separately, matching the Overview page.
 */
export function platformSnapshot(rows: SnapshotRow[]): PlatformSnapshot {
  const n = (v: unknown) => Math.max(0, Number(v ?? 0));
  const live = rows.filter((r) => !r.archived_at);
  return {
    ecosystems: live.length,
    archived: rows.length - live.length,
    admins: live.reduce((s, r) => s + n(r.admin_count), 0),
    resellers: live.reduce((s, r) => s + n(r.reseller_count) + n(r.subreseller_count), 0),
    users: live.reduce((s, r) => s + n(r.customer_count), 0),
    mrr: platformMrr(rows),
    frozen: live.filter((r) => r.operations_frozen).length,
    overdue: live.filter(
      (r) => r.subscription_state === "expired" || r.subscription_state === "suspended",
    ).length,
  };
}

export type HealthTone = "success" | "warning" | "danger" | "muted";

export interface SystemHealth {
  label: string;
  tone: HealthTone;
  detail: string;
}

/** Health is a plain reading of tenant state — no synthetic uptime figures. */
export function systemHealth(snapshot: PlatformSnapshot, loaded: boolean): SystemHealth {
  if (!loaded) return { label: "Checking", tone: "muted", detail: "Reading platform state…" };
  if (snapshot.frozen > 0)
    return {
      label: "Attention",
      tone: "danger",
      detail: `${snapshot.frozen} shop${snapshot.frozen === 1 ? "" : "s"} frozen`,
    };
  if (snapshot.overdue > 0)
    return {
      label: "Degraded",
      tone: "warning",
      detail: `${snapshot.overdue} subscription${snapshot.overdue === 1 ? "" : "s"} lapsed`,
    };
  if (snapshot.ecosystems === 0)
    return { label: "Idle", tone: "muted", detail: "No active shops yet" };
  return { label: "Operational", tone: "success", detail: "All shops trading normally" };
}

/* ------------------------------------------------------------------ */
/* Session / device                                                    */
/* ------------------------------------------------------------------ */

/** Best-effort, purely cosmetic description of the current browser. */
export function describeDevice(userAgent?: string | null): string {
  const ua = userAgent ?? "";
  if (!ua) return "This device";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\//.test(ua)
      ? "Opera"
      : /Chrome\//.test(ua)
        ? "Chrome"
        : /Safari\//.test(ua)
          ? "Safari"
          : /Firefox\//.test(ua)
            ? "Firefox"
            : "Browser";
  const os = /iPhone|iPad|iPod/.test(ua)
    ? "iOS"
    : /Android/.test(ua)
      ? "Android"
      : /Mac OS X/.test(ua)
        ? "macOS"
        : /Windows/.test(ua)
          ? "Windows"
          : /Linux/.test(ua)
            ? "Linux"
            : "Unknown OS";
  return `${browser} on ${os}`;
}

export function validateBio(bio: string): string | null {
  if (bio.trim().length > 280) return "Keep your bio to 280 characters or fewer";
  return null;
}

/** Security-relevant audit actions, matched loosely on the recorded label. */
const SECURITY_WORDS = ["password", "security", "access", "impersonat", "role", "sign", "invit"];

export function isSecurityEvent(action: string): boolean {
  const a = action.toLowerCase();
  return SECURITY_WORDS.some((w) => a.includes(w));
}
