/**
 * Self purchase (authorized shop member buying from their own shop) and
 * membership-free Universe buying — presentation mirror of the database rules.
 * The SQL side (retail_checkout_quote / retail_place_order netting, single
 * wallet hold, refund of the net amount) lives in the migration.
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_STORE_SETTINGS,
  checkoutProblem,
  customerOrderTotals,
  customerPaymentLabel,
  netCharge,
  selfPurchaseSummary,
  type CheckoutQuote,
  type RetailOrder,
} from "@/lib/retail";

const quote: CheckoutQuote = { total: 10, selfCashback: 2, buyerCharge: 8, selfPurchase: true };
const settings = { ...DEFAULT_STORE_SETTINGS, retailEnabled: true };
const credit = { fulfillment: "pickup" as const, payment: "credit" as const, address: "", notes: "" };

describe("self-purchase net charge", () => {
  it("₱10 retail − ₱2 cashback = ₱8 actual charge", () => {
    expect(netCharge(10, quote)).toBe(8);
    expect(selfPurchaseSummary(10, 2)).toBe("₱10 − ₱2 cashback = ₱8");
  });

  it("falls back to the full total when the quote is stale or not a self purchase", () => {
    expect(netCharge(12, quote)).toBe(12); // cart changed since the quote
    expect(netCharge(10, { ...quote, selfPurchase: false })).toBe(10);
    expect(netCharge(10, null)).toBe(10);
  });

  it("balance check uses the actual charge, not the retail price", () => {
    expect(checkoutProblem(credit, 10, settings, 8, 1, null, quote)).toBeNull();
    expect(checkoutProblem(credit, 10, settings, 8, 1, null, null)).toMatch(/coins/i);
    expect(checkoutProblem(credit, 10, settings, 7, 1, null, quote)).toMatch(/coins/i);
  });
});

describe("self-purchase order history", () => {
  const order = (over: Partial<RetailOrder>): RetailOrder =>
    ({
      id: "o",
      order_no: "RO-1",
      status: "approved",
      fulfillment: "pickup",
      fulfillment_status: "completed",
      payment_method: "credit",
      total: 10,
      delivery_fee: 0,
      items: [],
      created_at: "2026-09-01T00:00:00Z",
      self_cashback: 2,
      buyer_charge: 8,
      ...over,
    }) as RetailOrder;

  it("shows retail price, cashback and actual charge", () => {
    const t = customerOrderTotals(order({}));
    expect(t.total).toBe(10);
    expect(t.selfCashback).toBe(2);
    expect(t.charged).toBe(8);
    expect(customerPaymentLabel(order({}))).toBe(
      "Self purchase — ₱10 − ₱2 cashback = ₱8 paid",
    );
    expect(customerPaymentLabel(order({ status: "pending" }))).toMatch(/held/);
  });

  it("never nets cashback on cash / COD or rejected orders", () => {
    expect(customerOrderTotals(order({ payment_method: "cod" })).selfCashback).toBe(0);
    expect(customerOrderTotals(order({ payment_method: "cash" })).charged).toBe(10);
    expect(customerPaymentLabel(order({ status: "rejected" }))).toBe("Nothing charged");
  });

  it("ordinary orders are unchanged", () => {
    const t = customerOrderTotals(order({ self_cashback: 0, buyer_charge: null }));
    expect(t.charged).toBe(10);
    expect(customerPaymentLabel(order({ self_cashback: 0 }))).toBe("Paid with coins");
  });
});
