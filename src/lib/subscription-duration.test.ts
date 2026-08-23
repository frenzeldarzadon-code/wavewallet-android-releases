import { describe, expect, it } from "vitest";
import {
  DURATION_OPTIONS,
  addMonths,
  isFreePrice,
  coveragePeriod,
  normalizeMonths,
  planTotalPhp,
  subscriptionCountdown,
} from "./subscription-duration";
import { isFreeSubscription, isSubscriptionOk } from "./auth";

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

/* ------------------------------------------------------------------ *
 * Zero-priced (free) subscriptions — Super Admin set the price to 0.
 * ------------------------------------------------------------------ */
describe("zero-priced subscriptions", () => {
  it("recognises only a zero/blank price as free", () => {
    expect(isFreePrice(0)).toBe(true);
    expect(isFreePrice("0")).toBe(true);
    expect(isFreePrice(null)).toBe(true);
    expect(isFreePrice(150)).toBe(false);
    expect(isFreePrice("0.01")).toBe(false);
  });

  it("charges nothing for any duration of a free plan", () => {
    expect(planTotalPhp(0, 1)).toBe(0);
    expect(planTotalPhp(0, 24)).toBe(0);
    expect(planTotalPhp(150, 2)).toBe(300);
  });

  it("shows no countdown and never freezes a free shop, even long past its period end", () => {
    const c = subscriptionCountdown({
      periodEnd: new Date("2020-01-01T00:00:00Z"),
      graceDays: 5,
      state: "active",
      monthlyPrice: 0,
      now: new Date("2026-01-01T00:00:00Z"),
    });
    expect(c.free).toBe(true);
    expect(c.frozen).toBe(false);
    expect(c.expired).toBe(false);
    expect(c.freezeAt).toBeNull();
    expect(c.label).not.toMatch(/remaining|Expires|Frozen/);
  });

  it("keeps a paid shop on the normal expiry/grace/freeze path", () => {
    const c = subscriptionCountdown({
      periodEnd: new Date("2026-01-01T00:00:00Z"),
      graceDays: 5,
      state: "active",
      monthlyPrice: 150,
      now: new Date("2026-01-10T00:00:00Z"),
    });
    expect(c.free).toBe(false);
    expect(c.frozen).toBe(true);
  });
});

describe("isSubscriptionOk with a zero price", () => {
  const base = {
    subscription_state: "active",
    current_period_end: new Date(Date.now() - 90 * 86_400_000).toISOString(),
    grace_period_days: 5,
    plan_price: 0,
    is_review: false,
  } as never;

  it("keeps a free live shop operational after its period end", () => {
    expect(isFreeSubscription(base)).toBe(true);
    expect(isSubscriptionOk(base)).toBe(true);
  });

  it("still freezes a priced shop after its period end", () => {
    const paid = { ...(base as object), plan_price: 150 } as never;
    expect(isFreeSubscription(paid)).toBe(false);
    expect(isSubscriptionOk(paid)).toBe(false);
  });

  it("does not treat a Demo/review shop as free", () => {
    const demo = { ...(base as object), is_review: true } as never;
    expect(isFreeSubscription(demo)).toBe(false);
  });
});
