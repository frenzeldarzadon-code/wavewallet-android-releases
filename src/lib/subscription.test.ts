import { describe, expect, it } from "vitest";
import { monthsForPayment, projectedExpiry, requestMonths } from "./subscription";

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
    expect(monthsForPayment(299.5, 149.75)).toMatchObject({ ok: true, months: 2 });
  });

  it("rejects non-multiple amounts instead of granting a partial month", () => {
    const q = monthsForPayment(200, 150);
    expect(q.ok).toBe(false);
    expect(q.months).toBeNull();
    expect(q.ok === false && q.error).toMatch(/Non-standard amount/);
    expect(monthsForPayment(449.99, 150).ok).toBe(false);
  });

  it("rejects short, zero and unusable amounts", () => {
    expect(monthsForPayment(100, 150).ok === false && monthsForPayment(100, 150)).toMatchObject({
      ok: false,
    });
    expect(monthsForPayment(100, 150).ok === false ? monthsForPayment(100, 150).error : "").toMatch(
      /Insufficient/,
    );
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
