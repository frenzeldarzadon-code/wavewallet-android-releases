/**
 * Retail R6 — presentation mirror of the locked cash-on-delivery model.
 *
 * Locked example: Seller's Cut ₱100 → Retail Price ₱101 (₱1 fee embedded in the
 * product only) + ₱20 delivery = ₱121 customer cash = ₱121 collector float.
 * Never ₱122.01. The SQL side is covered by supabase/tests/retail-r6-cod.sql.
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_STORE_SETTINGS,
  cartQuote,
  checkoutProblem,
  codCashTotal,
  codCustomerTotal,
  customerCancelBlockedReason,
  sellerToCustomer,
  type CodQuote,
  type RetailProduct,
} from "@/lib/retail";
import {
  canCollectorConfirmCash,
  canSellerCancel,
  canSellerRelease,
  codStageLabel,
  dutyNextStep,
  dutySteps,
  fallbackCountdown,
  fallbackReleaseAt,
  splitDeliveryFee,
  splitProblem,
} from "@/lib/retail-cod";

const product: RetailProduct = {
  id: "p",
  name: "Sardines",
  description: null,
  image_path: null,
  price: 100, // seller's cut
  stock: 10,
  sold_count: 0,
  public_visible: true,
  rating_avg: 0,
  rating_count: 0,
};

describe("locked ₱121 example", () => {
  it("Seller's Cut ₱100 → Retail Price ₱101 (1 % embedded, product only)", () => {
    expect(sellerToCustomer(100, 1)).toBe(101);
    const q = cartQuote({ p: 1 }, [product], 1);
    expect(q).toMatchObject({ sellerTotal: 100, fee: 1, total: 101 });
  });
  it("adds the ₱20 delivery fee with no platform fee → ₱121, never ₱122.01", () => {
    expect(codCustomerTotal(101, 20)).toBe(121);
    expect(codCustomerTotal(101, 20)).not.toBe(122.01);
    expect(codCashTotal({ total: 101, delivery_fee: 20 })).toBe(121);
  });
  it("splits the ₱20 pool 100 % between delivery person and collector (70/30 → 14 + 6)", () => {
    expect(splitDeliveryFee(20, 70)).toEqual({ delivery: 14, collector: 6 });
    expect(splitDeliveryFee(20, 100)).toEqual({ delivery: 20, collector: 0 });
    expect(splitDeliveryFee(20, 0)).toEqual({ delivery: 0, collector: 20 });
    const s = splitDeliveryFee(20.01, 33);
    expect(s.delivery + s.collector).toBeCloseTo(20.01, 2);
  });
  it("reconciles 90 + 10 + 1 + 14 + 6 = 121 with 10 % cashback", () => {
    const seller = 100,
      fee = 1,
      cashback = 10;
    const { delivery, collector } = splitDeliveryFee(20, 70);
    expect(seller - cashback + cashback + fee + delivery + collector).toBe(121);
  });
});

describe("split configuration", () => {
  it("requires whole, non-negative percentages that total exactly 100", () => {
    expect(splitProblem(70, 30)).toBeNull();
    expect(splitProblem(60, 30)).toMatch(/exactly 100/);
    expect(splitProblem(70.5, 29.5)).toMatch(/whole/);
    expect(splitProblem(-10, 110)).toMatch(/negative/);
  });
});

describe("checkout with cash on delivery", () => {
  const settings = { ...DEFAULT_STORE_SETTINGS, retailEnabled: true, codEnabled: true };
  const ok: CodQuote = {
    available: true,
    reason: null,
    deliveryFee: 20,
    platformFee: 1,
    customerTotal: 121,
  };
  const draft = {
    fulfillment: "delivery" as const,
    payment: "cod" as const,
    address: "Sagada",
    notes: "",
  };

  it("allows COD only for delivery with an available server quote", () => {
    expect(checkoutProblem(draft, 101, settings, 0, 1, ok)).toBeNull();
    expect(checkoutProblem({ ...draft, fulfillment: "pickup" }, 101, settings, 0, 1, ok)).toMatch(
      /delivery/,
    );
    expect(checkoutProblem(draft, 101, { ...settings, codEnabled: false }, 0, 1, ok)).toMatch(
      /cash on delivery/i,
    );
    expect(checkoutProblem(draft, 101, settings, 0, 1, null)).toMatch(/Checking/);
    expect(
      checkoutProblem(draft, 101, settings, 0, 1, {
        ...ok,
        available: false,
        reason: "Cash on delivery is temporarily unavailable for this shop",
      }),
    ).toMatch(/temporarily unavailable/);
  });
  it("never requires customer coins for COD", () => {
    expect(checkoutProblem(draft, 101, settings, 0, 1, ok)).toBeNull();
  });
});

describe("customer cancellation", () => {
  it("is allowed while pending and blocked once handed to delivery", () => {
    expect(
      customerCancelBlockedReason({ status: "pending", fulfillment_status: "awaiting" }),
    ).toBeNull();
    expect(
      customerCancelBlockedReason({ status: "approved", fulfillment_status: "out_for_delivery" }),
    ).toMatch(/handed/);
    expect(
      customerCancelBlockedReason({ status: "approved", fulfillment_status: "delivered" }),
    ).toMatch(/handed/);
    expect(
      customerCancelBlockedReason({ status: "approved", fulfillment_status: "preparing" }),
    ).toMatch(/order chat/);
  });
});

describe("3-day seller fallback", () => {
  const base = {
    status: "approved" as const,
    payment_method: "cod" as const,
    fulfillment_status: "completed" as const,
    collector_status: "approved" as const,
    hold_held: true,
    cod_settled_at: null,
    cod_discrepancy: false,
    cod_cash_received_at: null,
    completed_at: "2026-09-01T10:00:00.000Z",
  };
  it("release becomes available exactly 3 days after buyer receipt", () => {
    expect(fallbackReleaseAt(base.completed_at)?.toISOString()).toBe("2026-09-04T10:00:00.000Z");
    expect(canSellerRelease(base, new Date("2026-09-04T09:59:59.000Z"))).toBe(false);
    expect(canSellerRelease(base, new Date("2026-09-04T10:00:00.000Z"))).toBe(true);
    expect(fallbackCountdown(base.completed_at, new Date("2026-09-02T10:00:00.000Z"))).toBe(
      "2 days",
    );
    expect(fallbackCountdown(base.completed_at, new Date("2026-09-04T10:00:01.000Z"))).toBeNull();
  });
  it("is never available without receipt, after settlement, or with a discrepancy", () => {
    const late = new Date("2026-09-10T00:00:00.000Z");
    expect(canSellerRelease({ ...base, completed_at: null }, late)).toBe(false);
    expect(canSellerRelease({ ...base, cod_settled_at: "2026-09-05T00:00:00Z" }, late)).toBe(false);
    expect(canSellerRelease({ ...base, cod_discrepancy: true }, late)).toBe(false);
    expect(canSellerRelease({ ...base, hold_held: false }, late)).toBe(false);
  });
  it("seller cancel is blocked after settlement; collector cash confirm needs handoff + hold", () => {
    expect(canSellerCancel(base)).toBe(true);
    expect(canSellerCancel({ ...base, cod_settled_at: "x" })).toBe(false);
    expect(canCollectorConfirmCash(base)).toBe(true);
    expect(canCollectorConfirmCash({ ...base, fulfillment_status: "ready" })).toBe(false);
    expect(canCollectorConfirmCash({ ...base, hold_held: false })).toBe(false);
    expect(codStageLabel(base)).toMatch(/Buyer received/);
    expect(codStageLabel({ ...base, cod_settled_at: "x" })).toBe("Settled");
    expect(codStageLabel({ ...base, hold_held: false, collector_status: "proposed" })).toMatch(
      /Waiting for collector/,
    );
  });
});

describe("duty workspace helpers", () => {
  const base = {
    status: "approved" as const,
    fulfillment_status: "accepted" as const,
    collector_status: "proposed",
    hold_held: false,
    cash_received_at: null,
    discrepancy: false,
    settled_at: null,
    completed_at: null,
    expected_cash: 121,
  };

  it("tells the collector to approve, and the courier to wait, before the float is held", () => {
    expect(dutyNextStep({ ...base, my_role: "collector" })).toEqual({
      text: "Approve to hold the float, or decline",
      mine: true,
    });
    expect(dutyNextStep({ ...base, my_role: "delivery" }).mine).toBe(false);
  });

  it("hands the next move to the courier once the parcel is out, then to the collector", () => {
    const out = {
      ...base,
      collector_status: "approved",
      hold_held: true,
      fulfillment_status: "out_for_delivery" as const,
    };
    expect(dutyNextStep({ ...out, my_role: "delivery" })).toMatchObject({ mine: true });
    expect(dutyNextStep({ ...out, my_role: "collector" })).toMatchObject({ mine: true });
    const delivered = { ...out, fulfillment_status: "delivered" as const };
    expect(dutyNextStep({ ...delivered, my_role: "delivery" }).mine).toBe(false);
    expect(dutyNextStep({ ...delivered, my_role: "collector" }).mine).toBe(true);
  });

  it("stops once cash is confirmed, flagged or settled", () => {
    const held = {
      ...base,
      my_role: "collector" as const,
      collector_status: "approved",
      hold_held: true,
    };
    expect(
      dutyNextStep({ ...held, cash_received_at: "2026-09-03T00:00:00Z", discrepancy: true }).mine,
    ).toBe(false);
    expect(
      dutyNextStep({ ...held, hold_held: false, settled_at: "2026-09-03T00:00:00Z" }).text,
    ).toMatch(/Settled/);
  });

  it("derives the timeline from existing fields only, marking the first open step", () => {
    const steps = dutySteps({
      ...base,
      my_role: "collector",
      collector_status: "approved",
      hold_held: true,
      fulfillment_status: "out_for_delivery",
    });
    expect(steps.map((s) => s.done)).toEqual([true, true, true, false, false, false]);
    expect(steps.find((s) => s.current)?.label).toBe("Delivered");
    const settled = dutySteps({
      ...base,
      my_role: "collector",
      collector_status: "approved",
      fulfillment_status: "completed",
      cash_received_at: "x",
      settled_at: "x",
    });
    expect(settled.every((s) => s.done)).toBe(true);
  });
});
