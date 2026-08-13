import { describe, expect, it } from "vitest";
import {
  DEFAULT_PREFERENCES,
  describeDevice,
  isSecurityEvent,
  parsePreferences,
  platformSnapshot,
  preferencesPatch,
  profileCompletion,
  systemHealth,
  validateBio,
} from "@/lib/super-profile";

describe("preferences", () => {
  it("falls back to defaults for missing or malformed values", () => {
    expect(parsePreferences(null)).toEqual(DEFAULT_PREFERENCES);
    expect(parsePreferences([] as never)).toEqual(DEFAULT_PREFERENCES);
    expect(parsePreferences({ appearance: "neon", timezone: 7 } as never)).toEqual(
      DEFAULT_PREFERENCES,
    );
  });

  it("keeps stored values it recognises", () => {
    const parsed = parsePreferences({
      timezone: "UTC",
      language: "fil-PH",
      appearance: "dark",
      compact: true,
      notifySecurity: false,
    } as never);
    expect(parsed.timezone).toBe("UTC");
    expect(parsed.language).toBe("fil-PH");
    expect(parsed.appearance).toBe("dark");
    expect(parsed.compact).toBe(true);
    expect(parsed.notifySecurity).toBe(false);
    expect(parsed.notifyApplications).toBe(true);
  });

  it("sends only changed keys, or nothing at all", () => {
    expect(preferencesPatch(DEFAULT_PREFERENCES, DEFAULT_PREFERENCES)).toBeNull();
    expect(
      preferencesPatch({ ...DEFAULT_PREFERENCES, compact: true }, DEFAULT_PREFERENCES),
    ).toEqual({ compact: true });
  });
});

describe("profile completion", () => {
  it("is calculated from real fields", () => {
    const empty = profileCompletion({});
    expect(empty.percent).toBe(0);
    expect(empty.missing).toHaveLength(6);

    const full = profileCompletion({
      fullName: "Frenzel",
      handle: "frenzel",
      email: "f@example.com",
      phone: "0917",
      bio: "Platform owner",
      avatarPath: "platform/x/y.webp",
    });
    expect(full.percent).toBe(100);
    expect(full.missing).toEqual([]);
  });

  it("ignores whitespace-only values", () => {
    const c = profileCompletion({ fullName: "  ", handle: "a" });
    expect(c.missing).toContain("Display name");
    expect(c.percent).toBe(17);
  });
});

const row = (over: Partial<Record<string, unknown>> = {}) =>
  ({
    admin_count: 1,
    reseller_count: 2,
    subreseller_count: 1,
    customer_count: 10,
    archived_at: null,
    operations_frozen: false,
    subscription_state: "active",
    plan_price: 500,
    ...over,
  }) as never;

describe("platform snapshot", () => {
  it("counts only live shops and never double counts roles", () => {
    const s = platformSnapshot([row(), row({ archived_at: "2026-01-01" })]);
    expect(s.ecosystems).toBe(1);
    expect(s.archived).toBe(1);
    expect(s.admins).toBe(1);
    expect(s.resellers).toBe(3);
    expect(s.users).toBe(10);
    expect(s.mrr).toBe(500);
  });

  it("returns zeros rather than fake data when there is nothing", () => {
    expect(platformSnapshot([])).toMatchObject({ ecosystems: 0, admins: 0, users: 0, mrr: 0 });
  });
});

describe("system health", () => {
  it("reports the worst live signal", () => {
    const base = platformSnapshot([row()]);
    expect(systemHealth(base, false).label).toBe("Checking");
    expect(systemHealth(base, true).tone).toBe("success");
    expect(systemHealth({ ...base, overdue: 2 }, true).tone).toBe("warning");
    expect(systemHealth({ ...base, frozen: 1, overdue: 2 }, true).tone).toBe("danger");
    expect(systemHealth(platformSnapshot([]), true).label).toBe("Idle");
  });
});

describe("misc helpers", () => {
  it("describes a device without guessing wildly", () => {
    expect(describeDevice("Mozilla/5.0 (Macintosh; Mac OS X) Chrome/120 Safari/537")).toBe(
      "Chrome on macOS",
    );
    expect(describeDevice("")).toBe("This device");
  });

  it("limits bio length", () => {
    expect(validateBio("short")).toBeNull();
    expect(validateBio("x".repeat(281))).toMatch(/280/);
  });

  it("flags security relevant audit actions", () => {
    expect(isSecurityEvent("Accessed account")).toBe(true);
    expect(isSecurityEvent("Created voucher batch")).toBe(false);
  });
});
