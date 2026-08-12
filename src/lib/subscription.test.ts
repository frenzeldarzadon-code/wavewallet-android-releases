import { describe, expect, it } from "vitest";
import {
  adjustmentIsShortening,
  adjustmentSummary,
  adjustmentTimeFrame,
  monthsForPayment,
  prepaidRemaining,
  projectedExpiry,
  requestMonths,
  type SubscriptionAdjustment,
} from "./subscription";

describe("per-ecosystem monthly duration rule", () => {
  it("derives whole months from the amount at PHP150/month", () => {
    expect(monthsForPayment(150, 150)).toMatchObject({ ok: true, months: 1 });
    expect(monthsForPayment(300, 150)).toMatchObject({ ok: true, months: 2 });
    expect(monthsForPayment(450, 150)).toMatchObject({ ok: true, months: 3 });
    expect(monthsForPayment(1800, 150)).toMatchObject({ ok: true, months: 12 });
  });

  it("uses each ecosystem's own rate", () => {
    expect(monthsForPayment(600, 200)).toMatchObject({ ok: true, months: 3 });
    expect(monthsForPayment(600, 150)).toMatchObject({ ok: true, months: 4 });
    expect(monthsForPayment(299.5, 149.75)).toMatchObject({ ok: true, months: 2, remainder: 0 });
  });

  it("credits whole months only and never loses the remainder", () => {
    const q = monthsForPayment(200, 150);
    expect(q).toMatchObject({ ok: true, months: 1, applied: 150, remainder: 50 });
    expect(monthsForPayment(449.99, 150)).toMatchObject({
      ok: true,
      months: 2,
      applied: 300,
      remainder: 149.99,
    });
    // Applied + remainder always reconciles back to what was paid.
    const q2 = monthsForPayment(725, 150);
    expect(q2.ok && q2.applied + q2.remainder).toBe(725);
    expect(q2.ok && q2.months).toBe(4);
  });

  it("rejects short, zero and unusable amounts", () => {
    const short = monthsForPayment(100, 150);
    expect(short.ok).toBe(false);
    expect(short.ok === false && short.error).toMatch(/Insufficient/);
    expect(monthsForPayment(0, 150).ok).toBe(false);
    expect(monthsForPayment(-150, 150).ok).toBe(false);
    expect(monthsForPayment(150, 0).ok).toBe(false);
  });

  it("extends an already-active shop from its current expiry", () => {
    const now = new Date("2026-03-10T00:00:00Z");
    const activeUntil = "2026-05-01T00:00:00Z";
    expect(projectedExpiry(activeUntil, 2, now).toISOString()).toBe("2026-07-01T00:00:00.000Z");
  });

  it("starts from today when expired or never activated", () => {
    const now = new Date("2026-03-10T00:00:00Z");
    expect(projectedExpiry("2026-01-01T00:00:00Z", 1, now).toISOString()).toBe(
      "2026-04-10T00:00:00.000Z",
    );
    expect(projectedExpiry(null, 3, now).toISOString()).toBe("2026-06-10T00:00:00.000Z");
  });

  it("reads months from the record, with a legacy fallback", () => {
    expect(requestMonths({ months_purchased: 2, billing_period: "monthly" })).toBe(2);
    expect(requestMonths({ months_purchased: null, billing_period: "quarterly" })).toBe(3);
    expect(requestMonths({ months_purchased: null, billing_period: "yearly" })).toBe(12);
    expect(requestMonths({ months_purchased: null, billing_period: "monthly" })).toBe(1);
  });
});

describe("platform-owner expiration adjustments", () => {
  const base: SubscriptionAdjustment = {
    id: "adj_1",
    ecosystem_id: "eco_1",
    actor_id: "su_1",
    actor_name: "Platform Owner",
    previous_period_end: "2026-04-01T00:00:00Z",
    new_period_end: "2026-04-08T00:00:00Z",
    direction: "extended",
    reason: "Courtesy adjustment due to dispute",
    note: "Outage on 2 Apr",
    created_at: "2026-03-20T00:00:00Z",
  };

  it("labels a +7 day courtesy adjustment and keeps both dates in history", () => {
    expect(adjustmentTimeFrame(base.previous_period_end, base.new_period_end)).toBe("+7 days");
    const line = adjustmentSummary(base);
    expect(line).toContain("+7 days");
    expect(line).toContain("Reason: Courtesy adjustment due to dispute");
    expect(line).toMatch(/Original: .+ → New: .+/);
    expect(line).toContain("Platform Owner");
  });

  it("labels whole-month shifts and shortenings", () => {
    expect(adjustmentTimeFrame("2026-04-01T00:00:00Z", "2026-05-01T00:00:00Z")).toBe("+1 month");
    expect(adjustmentTimeFrame("2026-04-08T00:00:00Z", "2026-04-01T00:00:00Z")).toBe("-7 days");
    expect(adjustmentTimeFrame(null, "2026-04-01T00:00:00Z")).toBe("new expiry set");
    expect(adjustmentSummary({ ...base, direction: "shortened", new_period_end: "2026-03-25T00:00:00Z" }))
      .toContain("shortened");
  });

  it("flags shortening so the UI can demand confirmation", () => {
    expect(adjustmentIsShortening("2026-04-08T00:00:00Z", "2026-04-01T00:00:00Z")).toBe(true);
    expect(adjustmentIsShortening("2026-04-01T00:00:00Z", "2026-04-08T00:00:00Z")).toBe(false);
    expect(adjustmentIsShortening(null, "2026-04-08T00:00:00Z")).toBe(false);
  });

  it("summarises prepaid time remaining", () => {
    const now = new Date("2026-03-01T00:00:00Z");
    expect(prepaidRemaining("2026-04-08T00:00:00Z", now).label).toBe("1 month 8 days left");
    expect(prepaidRemaining("2026-03-06T00:00:00Z", now).label).toBe("5 days left");
    expect(prepaidRemaining("2026-02-01T00:00:00Z", now)).toMatchObject({ expired: true });
    expect(prepaidRemaining(null, now)).toMatchObject({ expired: true });
  });
});
