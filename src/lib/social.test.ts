import { describe, expect, it } from "vitest";
import {
  availableTiers,
  canAfford,
  chargeSummary,
  commentCharge,
  exchangeGain,
  postCharge,
  relativeTime,
  sourceLabel,
  tierDuration,
  validateCommentBody,
  validateMessageBody,
  validatePostBody,
  type PromotionTier,
} from "@/lib/social";

const tier = (over: Partial<PromotionTier> = {}): PromotionTier => ({
  id: "t1",
  name: "Featured",
  description: "",
  price_social: 30,
  price_points: 15,
  currency: "both",
  duration_hours: 48,
  priority: 5,
  eligibility: "all",
  active: true,
  sort_order: 1,
  is_default: false,
  ...over,
});

const state = {
  balance: 5,
  post_cost: 1,
  comment_cost: 1,
  credit_exchange_rate: 2,
  points_exchange_rate: 2,
  promotion_currency: "social" as const,
  promotion_cost_social: 20,
  promotion_cost_points: 20,
};

describe("post charges", () => {
  it("charges one social credit for a normal post", () => {
    expect(postCharge(state, false)).toEqual({ amount: 1, currency: "social" });
  });

  it("charges the promotion fee in social credits by default", () => {
    expect(postCharge(state, true)).toEqual({ amount: 20, currency: "social" });
  });

  it("charges points when the platform configures points promotions", () => {
    expect(postCharge({ ...state, promotion_currency: "points" }, true)).toEqual({
      amount: 20,
      currency: "points",
    });
  });

  it("never deducts both currencies for one promotion", () => {
    const charge = postCharge({ ...state, promotion_currency: "points" }, true);
    expect(charge.currency).toBe("points");
    expect(charge.amount).toBe(20);
  });
});

describe("comment charges", () => {
  it("charges a social credit on a normal post", () => {
    expect(commentCharge(state, false)).toBe(1);
  });

  it("is free on a promoted post, as disclosed before publishing", () => {
    expect(commentCharge(state, true)).toBe(0);
  });
});

describe("affordability", () => {
  it("checks the social balance for social charges", () => {
    expect(canAfford(state, { amount: 20, currency: "social" }, 999)).toBe(false);
    expect(canAfford({ ...state, balance: 25 }, { amount: 20, currency: "social" }, 0)).toBe(true);
  });

  it("checks the points balance for points charges", () => {
    expect(canAfford(state, { amount: 20, currency: "points" }, 10)).toBe(false);
    expect(canAfford(state, { amount: 20, currency: "points" }, 40)).toBe(true);
  });

  it("always allows free actions", () => {
    expect(canAfford({ ...state, balance: 0 }, { amount: 0, currency: "social" }, 0)).toBe(true);
  });
});

describe("exchange", () => {
  it("gives two social credits per wallet credit", () => {
    expect(exchangeGain(state, "credit", 3)).toBe(6);
  });

  it("gives two social credits per point", () => {
    expect(exchangeGain(state, "points", 5)).toBe(10);
  });

  it("ignores negative and fractional amounts", () => {
    expect(exchangeGain(state, "credit", -4)).toBe(0);
    expect(exchangeGain(state, "credit", 2.9)).toBe(4);
  });
});

describe("disclosure copy", () => {
  it("states the exact deduction", () => {
    expect(chargeSummary(20, "social")).toContain("20 social credits");
    expect(chargeSummary(20, "points")).toContain("points");
  });

  it("states free actions plainly", () => {
    expect(chargeSummary(0, "social")).toContain("free");
  });
});

describe("validation", () => {
  it("rejects empty bodies", () => {
    expect(validatePostBody("  ")).not.toBeNull();
    expect(validateCommentBody("")).not.toBeNull();
    expect(validateMessageBody("")).not.toBeNull();
  });

  it("rejects oversized posts", () => {
    expect(validatePostBody("x".repeat(2001))).not.toBeNull();
    expect(validatePostBody("hello")).toBeNull();
  });
});

describe("presentation helpers", () => {
  it("labels ledger sources", () => {
    expect(sourceLabel("daily_allowance")).toBe("Daily allowance");
    expect(sourceLabel("promotion")).toBe("Promotion");
    expect(sourceLabel("unknown_source")).toBe("unknown_source");
  });

  it("formats relative time", () => {
    const now = new Date("2026-01-10T12:00:00Z");
    expect(relativeTime("2026-01-10T11:59:40Z", now)).toBe("just now");
    expect(relativeTime("2026-01-10T11:30:00Z", now)).toBe("30m");
    expect(relativeTime("2026-01-10T09:00:00Z", now)).toBe("3h");
    expect(relativeTime("2026-01-08T12:00:00Z", now)).toBe("2d");
  });
});


describe("promotion tiers", () => {
  it("charges the tier price in the chosen currency", () => {
    expect(postCharge(state, true, tier(), "points")).toEqual({ amount: 15, currency: "points" });
    expect(postCharge(state, true, tier(), "social")).toEqual({ amount: 30, currency: "social" });
  });

  it("ignores the requested currency when the tier only accepts one", () => {
    expect(postCharge(state, true, tier({ currency: "points" }), "social")).toEqual({
      amount: 15,
      currency: "points",
    });
  });

  it("falls back to the shop promotion price when no tier is chosen", () => {
    expect(postCharge(state, true, null, "social")).toEqual({ amount: 20, currency: "social" });
  });

  it("hides inactive and reseller-only tiers from ordinary members", () => {
    const tiers = [
      tier({ id: "a" }),
      tier({ id: "b", active: false }),
      tier({ id: "c", eligibility: "reseller" }),
    ];
    expect(availableTiers({ promotion_tiers: tiers, role: "customer" }).map((t) => t.id)).toEqual([
      "a",
    ]);
    expect(availableTiers({ promotion_tiers: tiers, role: "reseller" }).map((t) => t.id)).toEqual([
      "a",
      "c",
    ]);
  });

  it("describes durations in plain language", () => {
    expect(tierDuration(1)).toBe("1 hour");
    expect(tierDuration(24)).toBe("1 day");
    expect(tierDuration(72)).toBe("3 days");
  });
});
