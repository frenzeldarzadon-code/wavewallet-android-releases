import { describe, expect, it } from "vitest";
import { formatPoints, pointsForSpend, pts } from "@/lib/points";

describe("pointsForSpend — points come from the coins actually spent", () => {
  it("awards 1 point for a 10-coin customer purchase at 10:1", () => {
    expect(pointsForSpend(10, 10)).toBe(1);
  });

  it("awards 0.7 for a reseller who actually paid 7 coins for a 10-coin voucher", () => {
    expect(pointsForSpend(7, 10)).toBe(0.7);
  });

  it("accumulates fractions without loss: 7 + 7 + 6 coins = 2 points", () => {
    const total = pointsForSpend(7, 10) + pointsForSpend(7, 10) + pointsForSpend(6, 10);
    expect(Math.round(total * 100) / 100).toBe(2);
  });

  it("honours a configured 5:1 ratio", () => {
    expect(pointsForSpend(7, 5)).toBe(1.4);
    expect(pointsForSpend(10, 5)).toBe(2);
  });

  it("uses the promotional/discounted amount, never the nominal price", () => {
    const nominal = 20;
    const paid = 12.5;
    expect(pointsForSpend(paid, 10)).toBe(1.25);
    expect(pointsForSpend(paid, 10)).not.toBe(pointsForSpend(nominal, 10));
  });

  it("awards nothing for a failed, cancelled or zero-coin purchase", () => {
    expect(pointsForSpend(0, 10)).toBe(0);
    expect(pointsForSpend(-5, 10)).toBe(0);
    expect(pointsForSpend(10, 0)).toBe(0);
    expect(pointsForSpend(Number.NaN, 10)).toBe(0);
  });

  it("keeps two decimals of precision", () => {
    expect(pointsForSpend(7, 3)).toBe(2.33);
  });
});

describe("formatPoints", () => {
  it("always shows two decimals so fractions stay visible", () => {
    expect(formatPoints(0.7)).toBe("0.70");
    expect(formatPoints(2)).toBe("2.00");
    expect(formatPoints("15.5")).toBe("15.50");
    expect(formatPoints(null)).toBe("0.00");
    expect(pts(0.7)).toBe("0.70 pts");
  });
});
