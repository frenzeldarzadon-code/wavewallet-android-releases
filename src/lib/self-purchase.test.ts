/**
 * GLOBAL self-purchase rule — presentation mirror shared by Voucher and Retail.
 * The authority is the database (`universe_self_purchase_net` +
 * `universe_purchase_debit`); see supabase/tests/universe-self-purchase.sql.
 */
import { describe, expect, it } from "vitest";
import { selfPurchaseCharge, type SelfPurchaseQuote } from "@/lib/wallet";
import { netCharge } from "@/lib/retail";

const q: SelfPurchaseQuote = {
  total: 10,
  selfCashback: 2,
  buyerCharge: 8,
  selfPurchase: true,
  cashbackPercent: 20,
};

describe("selfPurchaseCharge (shared by every Universe shop type)", () => {
  it("₱10 − 20% (₱2) = ₱8 actual charge", () => {
    expect(selfPurchaseCharge(10, q)).toBe(8);
  });
  it("Retail's netCharge is the same helper", () => {
    expect(netCharge(10, { total: 10, selfCashback: 2, buyerCharge: 8, selfPurchase: true })).toBe(8);
  });
  it("a stale quote (price changed) never under-charges", () => {
    expect(selfPurchaseCharge(20, q)).toBe(20);
  });
  it("non-self purchases and transfers (no quote) pay the full amount", () => {
    expect(selfPurchaseCharge(10, { ...q, selfPurchase: false, selfCashback: 0, buyerCharge: 10 })).toBe(10);
    expect(selfPurchaseCharge(10, null)).toBe(10);
  });
});
