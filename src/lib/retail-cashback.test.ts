/**
 * Retail R3 cashback — presentation mirror of the database `retail_line_cashback`.
 * The SQL side (attribution, settlement, idempotency, reconciliation) is covered
 * by supabase/tests/retail-r3-cashback.sql.
 */
import { describe, expect, it } from "vitest";
import { applicableUnitPrice, lineCashback, quoteLine, type RetailProduct } from "@/lib/retail";

const bulk: RetailProduct = {
  id: "p",
  name: "Sardines",
  description: null,
  image_path: null,
  price: 100,
  stock: 100,
  sold_count: 0,
  public_visible: true,
  rating_avg: 0,
  rating_count: 0,
  wholesale_price: 90,
  wholesale_min_qty: 12,
};

describe("retail line cashback", () => {
  it("A. percent of the normal seller amount", () => {
    expect(lineCashback("percent", 10, 100, 1)).toBe(10);
  });
  it("B. fixed amount is per unit", () => {
    expect(lineCashback("fixed", 2, 300, 3)).toBe(6);
  });
  it("C. disabled is always zero even with a value", () => {
    expect(lineCashback("disabled", 50, 100, 1)).toBe(0);
  });
  it("D. wholesale-qualified: base is the discounted amount actually paid", () => {
    const seller = applicableUnitPrice(bulk, 12) * 12; // 1080, not 1200
    expect(seller).toBe(1080);
    expect(lineCashback("percent", 10, seller, 12)).toBe(108);
    expect(lineCashback("percent", 10, seller, 12)).not.toBe(120);
  });
  it("E. below the threshold: base is the regular amount", () => {
    expect(lineCashback("percent", 10, applicableUnitPrice(bulk, 11) * 11, 11)).toBe(110);
  });
  it("F. platform fee is neither in the base nor deducted from cashback", () => {
    const q = quoteLine(bulk, 12, 1); // seller 1080, fee 10.80, customer 1090.80
    expect(lineCashback("percent", 10, q.sellerTotal, 12)).toBe(108);
    expect(lineCashback("percent", 10, q.customerTotal, 12)).not.toBe(108);
    expect(q.fee).toBe(10.8);
  });
  it("never exceeds the seller line", () => {
    expect(lineCashback("fixed", 500, 100, 1)).toBe(100);
    expect(lineCashback("percent", 100, 37.05, 3)).toBe(37.05);
  });
  it("rounds once to 2 dp", () => {
    expect(lineCashback("percent", 3, 37.05, 3)).toBe(1.11); // 1.1115
  });
});
