import { describe, expect, it } from "vitest";
import {
  DURATION_OPTIONS,
  addMonths,
  coveragePeriod,
  normalizeMonths,
  planTotalPhp,
  subscriptionCountdown,
} from "./subscription-duration";

const DAY = 86_400_000;
const at = (days: number) => new Date(Date.now() + days * DAY);

describe("duration and price", () => {
  it("offers exactly the durations the server accepts (1–24 months)", () => {
    expect(DURATION_OPTIONS[0]).toBe(1);
    expect(DURATION_OPTIONS.at(-1)).toBe(24);
    expect(DURATION_OPTIONS).toHaveLength(24);
  });

  it("1 month is 1x the package price", () => {
    expect(planTotalPhp(499, 1)).toBe(499);
  });

  it("2 months is exactly 2x the package price — no invented discount", () => {
    expect(planTotalPhp(499, 2)).toBe(998);
    expect(planTotalPhp(1250.5, 2)).toBe(2501);
  });

  it("keeps different shop/package prices isolated", () => {
    expect(planTotalPhp(299, 3)).toBe(897);
    expect(planTotalPhp(999, 3)).toBe(2997);
  });

  it("clamps impossible durations onto the server range", () => {
    expect(normalizeMonths(0)).toBe(1);
    expect(normalizeMonths(99)).toBe(24);
    expect(normalizeMonths("abc")).toBe(1);
    expect(planTotalPhp(0, 3)).toBe(0);
  });
});

describe("period purchased", () => {
  it("starts today for a first activation", () => {
    const now = new Date("2026-03-10T00:00:00Z");
    const p = coveragePeriod(null, 2, now);
    expect(p.extendsExisting).toBe(false);
    expect(p.end.getTime()).toBe(addMonths(now, 2).getTime());
  });

  it("extends an early renewal instead of overwriting the running period", () => {
    const now = new Date("2026-03-10T00:00:00Z");
    const end = new Date("2026-05-01T00:00:00Z");
    const p = coveragePeriod(end, 2, now);
    expect(p.extendsExisting).toBe(true);
    expect(p.start.getTime()).toBe(end.getTime());
    expect(p.end.getTime()).toBe(addMonths(end, 2).getTime());
  });

  it("restarts from today when the previous period already lapsed", () => {
    const now = new Date("2026-06-10T00:00:00Z");
    const p = coveragePeriod(new Date("2026-05-01T00:00:00Z"), 1, now);
    expect(p.extendsExisting).toBe(false);
    expect(p.start.getTime()).toBe(now.getTime());
  });
});

describe("dashboard countdown", () => {
  it("reflects the real expiration date in whole months", () => {
    const c = subscriptionCountdown({ periodEnd: at(61).toISOString(), graceDays: 5 });
    expect(c.label).toBe("2 months remaining");
    expect(c.expired).toBe(false);
  });

  it("shows whole days, never fractional months", () => {
    const c = subscriptionCountdown({ periodEnd: at(14.4).toISOString(), graceDays: 5 });
    expect(c.label).toBe("Expires in 14 days");
    expect(c.label).not.toMatch(/\./);
  });

  it("warns on the final day", () => {
    const c = subscriptionCountdown({ periodEnd: at(0.4).toISOString(), graceDays: 5 });
    expect(c.label).toBe("Expires today");
    expect(c.tone).toBe("warning");
  });

  it("preserves the configured grace period after expiry", () => {
    const c = subscriptionCountdown({ periodEnd: at(-2).toISOString(), graceDays: 5 });
    expect(c.expired).toBe(true);
    expect(c.frozen).toBe(false);
    expect(c.label).toBe("Expired — account freezes in 3 days");
    expect(c.daysUntilFreeze).toBe(3);
  });

  it("honours a zero-day grace configuration without inventing one", () => {
    const c = subscriptionCountdown({ periodEnd: at(-0.1).toISOString(), graceDays: 0 });
    expect(c.frozen).toBe(true);
    expect(c.label).toBe("Frozen — payment required");
  });

  it("never shows a misleading countdown once the grace period is over", () => {
    const c = subscriptionCountdown({ periodEnd: at(-40).toISOString(), graceDays: 5 });
    expect(c.frozen).toBe(true);
    expect(c.daysRemaining).toBe(0);
    expect(c.daysUntilFreeze).toBe(0);
    expect(c.label).toBe("Frozen — payment required");
  });

  it("says nothing misleading when no renewal date exists", () => {
    const c = subscriptionCountdown({ periodEnd: null, graceDays: 5 });
    expect(c.label).toBe("No renewal date set");
    expect(c.freezeAt).toBeNull();
  });
});
