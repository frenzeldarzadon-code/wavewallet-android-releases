import { describe, expect, it } from "vitest";
import {
  planLabel,
  planPriceLabel,
  requestMonthlyRate,
  requestRateLabel,
} from "@/lib/subscription-plan-label";

describe("plan labels for the platform owner", () => {
  it("shows the selected plan and its configured price", () => {
    expect(planLabel("Starter", 499)).toContain("Starter");
    expect(planLabel("Starter", 499)).toMatch(/499/);
  });

  it("never invents ₱0.00/mo when the price is missing", () => {
    expect(planPriceLabel(null)).toBe("price not set");
    expect(planLabel("Starter", null)).toBe("Starter · price not set");
  });

  it("treats a genuine zero price as a free plan", () => {
    expect(planPriceLabel(0)).toBe("Free plan");
  });

  it("says so plainly when a legacy record has no plan at all", () => {
    expect(planLabel(null, null)).toBe("No plan selected");
  });

  it("prefers the rate persisted with the request, then its plan price", () => {
    expect(requestMonthlyRate({ monthly_rate: 250, plan_price: 999 })).toBe(250);
    expect(requestMonthlyRate({ monthly_rate: null, plan_price: 999 })).toBe(999);
    expect(requestMonthlyRate({})).toBeNull();
  });

  it("renders the request rate without a fake zero", () => {
    expect(requestRateLabel({ monthly_rate: 250 })).toMatch(/250/);
    expect(requestRateLabel({})).toBe("");
    expect(requestRateLabel({ monthly_rate: 0 })).toBe(" @ free plan");
  });
});
