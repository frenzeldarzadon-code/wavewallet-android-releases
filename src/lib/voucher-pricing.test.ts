/**
 * Universe voucher pricing — presentation mirror of the SQL helpers.
 * The money-moving side is covered by supabase/tests/voucher-universe-pricing.sql.
 */
import { describe, expect, it } from "vitest";
import { voucherCost } from "./wallet";
import {
  platformFeeFromRetail,
  retailFromSellerCut,
  sellerCutFromRetail,
} from "./voucher-pricing";

describe("one-time fee-inclusive transition (live ₱10 voucher at 1%)", () => {
  it("keeps the customer price at ₱10 and backs the fee out", () => {
    expect(sellerCutFromRetail(10, 1)).toBe(9.9);
    expect(platformFeeFromRetail(10, 1)).toBe(0.1);
    expect(sellerCutFromRetail(10, 1) + platformFeeFromRetail(10, 1)).toBeCloseTo(10, 10);
  });
  it("never adds the fee on top of an existing price", () => {
    expect(sellerCutFromRetail(10, 1) + platformFeeFromRetail(10, 1)).not.toBeGreaterThan(10);
  });
  it("cut + fee equals the price for awkward amounts (no penny leaks)", () => {
    for (const p of [0.01, 0.05, 0.99, 5, 7.77, 12.34, 99.99, 250]) {
      expect(round2(sellerCutFromRetail(p, 1) + platformFeeFromRetail(p, 1))).toBe(p);
    }
  });
});

describe("Set Retail Price vs Set Seller's Cut", () => {
  it("Set Retail Price ₱10 → cut 9.90, customer pays 10", () => {
    expect(sellerCutFromRetail(10, 1)).toBe(9.9);
  });
  it("Set Seller's Cut ₱10 → customer price 10.10, fee 0.10", () => {
    expect(retailFromSellerCut(10, 1)).toBe(10.1);
    expect(platformFeeFromRetail(10.1, 1)).toBe(0.1);
  });
  it("round-trips in both directions", () => {
    for (const cut of [9.95, 10, 12.34, 0.5, 99.99]) {
      expect(sellerCutFromRetail(retailFromSellerCut(cut, 1), 1)).toBe(cut);
    }
  });
  it("a higher future fee changes only new calculations", () => {
    expect(retailFromSellerCut(10, 2)).toBe(10.2);
    expect(sellerCutFromRetail(10, 2)).toBe(9.8);
  });
  it("zero fee is the identity", () => {
    expect(sellerCutFromRetail(10, 0)).toBe(10);
    expect(retailFromSellerCut(10, 0)).toBe(10);
    expect(platformFeeFromRetail(10, 0)).toBe(0);
  });
});

describe("no reseller/subreseller purchase discount in Universe", () => {
  it("a 0% discount charges the full customer price (the server now returns 0)", () => {
    expect(voucherCost(10, 0)).toBe(10);
  });
  it("a general promo price is what everyone pays; fee follows the actual price", () => {
    expect(platformFeeFromRetail(15, 1)).toBe(0.15);
    expect(sellerCutFromRetail(15, 1)).toBe(14.85);
  });
  it("cashback is a separate rate on the full sale amount, never on the fee", () => {
    const rate = 50;
    const cashback = round2((10 * rate) / 100);
    const fee = platformFeeFromRetail(10, 1);
    expect(cashback).toBe(5);
    expect(round2(10 - cashback - fee)).toBe(4.9); // admin remainder
    expect(round2(cashback + fee + 4.9)).toBe(10); // no double fee
  });
});

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
