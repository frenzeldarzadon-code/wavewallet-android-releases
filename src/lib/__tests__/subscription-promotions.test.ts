import { describe, expect, it } from "vitest";
import {
  PLAN_DURATION_OPTIONS,
  durationQuote,
  freeMonths,
  isPromotion,
  planDurationOption,
  serviceEndsAt,
} from "@/lib/subscription-promotions";

const opt = (v: string) => planDurationOption(v);

describe("plan duration and promotion options", () => {
  it("offers exactly 1, 3, 6 months and the 1-year promotion", () => {
    expect(PLAN_DURATION_OPTIONS.map((o) => o.serviceMonths)).toEqual([1, 3, 6, 12]);
    expect(PLAN_DURATION_OPTIONS.map((o) => o.paidMonths)).toEqual([1, 3, 6, 10]);
  });

  it("only the 1-year option is a promotion, worth 2 free months", () => {
    expect(isPromotion(opt("1"))).toBe(false);
    expect(isPromotion(opt("6"))).toBe(false);
    expect(isPromotion(opt("12-promo"))).toBe(true);
    expect(freeMonths(opt("12-promo"))).toBe(2);
  });

  it("charges plain months at price × months", () => {
    expect(durationQuote({ monthlyPrice: 150, option: opt("1") }).total).toBe(150);
    expect(durationQuote({ monthlyPrice: 150, option: opt("3") }).total).toBe(450);
    expect(durationQuote({ monthlyPrice: 150, option: opt("6") }).total).toBe(900);
  });

  it("charges 10 months for the 1-year promotion but grants 12 months of service", () => {
    const q = durationQuote({ monthlyPrice: 150, option: opt("12-promo") });
    expect(q.total).toBe(1500);
    expect(q.listAmount).toBe(1800);
    expect(q.savings).toBe(300);
    expect(q.serviceMonths).toBe(12);
    expect(q.serviceDays).toBe(360);
  });

  it("applies an extra platform discount on top of the promotion", () => {
    expect(
      durationQuote({ monthlyPrice: 150, option: opt("12-promo"), discountPercent: 100 }).total,
    ).toBe(0);
    expect(
      durationQuote({ monthlyPrice: 150, option: opt("6"), discountPercent: 50 }).total,
    ).toBe(450);
  });

  it("expires 12 fixed 30-day months after the start for the promotion", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    expect(serviceEndsAt(null, opt("12-promo"), now).toISOString()).toBe(
      "2026-12-27T00:00:00.000Z",
    );
  });

  it("appends to a period that is still running", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    expect(serviceEndsAt("2026-02-01T00:00:00Z", opt("1"), now).toISOString()).toBe(
      "2026-03-03T00:00:00.000Z",
    );
  });
});
