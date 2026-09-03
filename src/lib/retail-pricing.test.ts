/**
 * Retail R2 pricing — the presentation mirror of `retail_place_order`.
 *
 * These assert the same arithmetic the database performs, so the numbers a
 * buyer sees before confirming match what the ledger holds. The SQL side is
 * covered by supabase/tests/retail-r2-pricing.sql.
 */
import { describe, expect, it } from "vitest";
import {
  applicableUnitPrice,
  cartLines,
  cartQuote,
  cartTotal,
  customerToSeller,
  quoteLine,
  sellerToCustomer,
  wholesaleApplies,
  type RetailProduct,
} from "@/lib/retail";

const product = (over: Partial<RetailProduct> = {}): RetailProduct => ({
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
  ...over,
});

describe("wholesale qualification (single tier, existing schema)", () => {
  it("uses the regular price below the minimum quantity", () => {
    expect(wholesaleApplies(product(), 11)).toBe(false);
    expect(applicableUnitPrice(product(), 11)).toBe(100);
  });
  it("switches to the wholesale price at exactly the minimum quantity", () => {
    expect(wholesaleApplies(product(), 12)).toBe(true);
    expect(applicableUnitPrice(product(), 12)).toBe(90);
    expect(applicableUnitPrice(product(), 40)).toBe(90);
  });
  it("never applies wholesale when the shop has not configured it", () => {
    expect(applicableUnitPrice(product({ wholesale_price: 0 }), 50)).toBe(100);
    expect(applicableUnitPrice(product({ wholesale_min_qty: 0 }), 50)).toBe(100);
    expect(applicableUnitPrice(product({ wholesale_price: undefined, wholesale_min_qty: undefined }), 50)).toBe(100);
  });
});

describe("platform fee on the applicable seller amount", () => {
  it("normal retail price + 1% fee", () => {
    const q = quoteLine(product(), 1, 1);
    expect(q).toEqual({ unitPrice: 100, wholesale: false, sellerTotal: 100, fee: 1, customerTotal: 101 });
  });
  it("wholesale price + 1% fee: the discounted amount is never in the fee base", () => {
    // ₱90 seller amount → ₱0.90 fee → ₱90.90 consumed (never 1% of ₱100)
    const q = quoteLine(product({ wholesale_min_qty: 1 }), 1, 1);
    expect(q).toEqual({ unitPrice: 90, wholesale: true, sellerTotal: 90, fee: 0.9, customerTotal: 90.9 });
    const bulk = quoteLine(product(), 12, 1);
    expect(bulk.sellerTotal).toBe(1080);
    expect(bulk.fee).toBe(10.8);
    expect(bulk.fee).not.toBe(12); // 1% of the regular 12 × ₱100
    expect(bulk.customerTotal).toBe(1090.8);
  });
  it("a higher fee raises the customer price but never the seller amount", () => {
    const q = quoteLine(product({ wholesale_min_qty: 1 }), 1, 2);
    expect(q.sellerTotal).toBe(90);
    expect(q.fee).toBe(1.8);
    expect(q.customerTotal).toBe(91.8);
  });
  it("zero fee keeps the customer price equal to the seller amount", () => {
    expect(quoteLine(product(), 3, 0)).toMatchObject({ sellerTotal: 300, fee: 0, customerTotal: 300 });
  });
});

describe("rounding", () => {
  it("rounds the fee once to 2 decimals from the rounded seller line", () => {
    const q = quoteLine(product({ price: 12.35, wholesale_price: 0 }), 3, 1);
    expect(q.sellerTotal).toBe(37.05);
    expect(q.fee).toBe(0.37); // 0.3705 → 0.37
    expect(q.customerTotal).toBe(37.42);
  });
  it("sums rounded lines without re-rounding the order", () => {
    const a = product({ id: "a", price: 12.35, wholesale_price: 0 });
    const b = product({ id: "b", price: 0.33, wholesale_price: 0 });
    const q = cartQuote({ a: 3, b: 5 }, [a, b], 1);
    // lines: 37.05 + 0.37 = 37.42 ; 1.65 + 0.02 = 1.67
    expect(q.sellerTotal).toBe(38.7);
    expect(q.fee).toBe(0.39);
    expect(q.total).toBe(39.09);
    expect(cartTotal({ a: 3, b: 5 }, [a, b], 1)).toBe(39.09);
    expect(q.total).toBe(Math.round((q.sellerTotal + q.fee) * 100) / 100);
  });
  it("unit customer price helpers are stable round trips at 2 dp", () => {
    expect(sellerToCustomer(100, 1)).toBe(101);
    expect(sellerToCustomer(90, 1)).toBe(90.9);
    expect(customerToSeller(101, 1)).toBe(100);
    expect(customerToSeller(90.9, 1)).toBe(90);
    expect(sellerToCustomer(customerToSeller(50, 1), 1)).toBeCloseTo(50, 1);
  });
});

describe("cart lines", () => {
  it("flags wholesale lines and exposes customer line totals", () => {
    const lines = cartLines({ p: 12 }, [product()], 1);
    expect(lines[0]!.wholesale).toBe(true);
    expect(lines[0]!.lineTotal).toBe(1090.8);
  });
  it("stays backward compatible when no fee is supplied", () => {
    expect(cartTotal({ p: 2 }, [product({ wholesale_price: 0 })])).toBe(200);
  });
});
