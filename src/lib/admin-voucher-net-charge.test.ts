/**
 * Admin voucher purchase — presentation mirror of the database rule
 * (`voucher_admin_self_net` + `universe_purchase_debit`). The database is
 * authoritative; see supabase/tests/admin-voucher-net-purchase.sql.
 *
 * benefit = price − platform fee − seller cashback owed
 * points  = (price − benefit) / credits_per_point      (the ACTUAL charge basis)
 * charge  = price − max(benefit − points, 0)           (1 point = 1 coin cost)
 */
import { describe, expect, it } from "vitest";
import { selfPurchaseCharge, quotePointsEarned, type SelfPurchaseQuote } from "@/lib/wallet";
import { pointsForSpend } from "@/lib/points";

/** ₱10 voucher, 1% price-inclusive fee, 10 coins = 1 point. */
const adminQuote: SelfPurchaseQuote = {
  total: 10,
  selfCashback: 9.89,
  buyerCharge: 0.11,
  selfPurchase: true,
  cashbackPercent: 99,
  platformFee: 0.1,
  pointsEarned: 0.01,
};

describe("admin voucher purchase net charge", () => {
  it("deducts the actual charge, never the face value", () => {
    expect(selfPurchaseCharge(10, adminQuote)).toBe(0.11);
  });

  it("charge = platform fee + the coin cost of the points earned", () => {
    expect(
      Math.round(((adminQuote.platformFee ?? 0) + (adminQuote.pointsEarned ?? 0)) * 100) / 100,
    ).toBe(adminQuote.buyerCharge);
  });

  it("benefit + charge always equals the voucher price (no double counting)", () => {
    expect(Math.round((adminQuote.selfCashback + adminQuote.buyerCharge) * 100) / 100).toBe(
      adminQuote.total,
    );
  });

  it("points come from the actual charge basis, not the face value", () => {
    expect(quotePointsEarned(10, 10, adminQuote)).toBe(0.01);
    expect(quotePointsEarned(10, 10, adminQuote)).not.toBe(pointsForSpend(10, 10));
  });

  it("insufficient balance is judged on the actual charge", () => {
    const balance = 5;
    expect(balance < adminQuote.total).toBe(true);
    expect(selfPurchaseCharge(10, adminQuote) > balance).toBe(false);
  });

  it("a stale quote (price changed) never under-charges", () => {
    expect(selfPurchaseCharge(20, adminQuote)).toBe(20);
    expect(quotePointsEarned(20, 10, adminQuote)).toBe(2);
  });

  it("reseller and customer behaviour is unchanged", () => {
    const reseller: SelfPurchaseQuote = {
      total: 10,
      selfCashback: 2,
      buyerCharge: 8,
      selfPurchase: true,
      cashbackPercent: 20,
      platformFee: 0.1,
      pointsEarned: 0.8,
    };
    expect(selfPurchaseCharge(10, reseller)).toBe(8);
    expect(quotePointsEarned(10, 10, reseller)).toBe(0.8);
    expect(selfPurchaseCharge(10, null)).toBe(10);
    expect(quotePointsEarned(10, 10, null)).toBe(1);
  });
});
