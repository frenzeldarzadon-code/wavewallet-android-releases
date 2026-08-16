import { describe, expect, it } from "vitest";
import { daysUntil, subscriptionStateLabel, subscriptionStateTone } from "@/lib/subscription-shops";

describe("subscription shop state", () => {
  it("labels every lifecycle state in plain language", () => {
    expect(subscriptionStateLabel("review")).toBe("Review (5 days)");
    expect(subscriptionStateLabel("expiring_soon")).toBe("Expiring soon");
    expect(subscriptionStateLabel(null)).toBe("Not started");
  });

  it("warns before expiry and flags frozen shops as danger", () => {
    expect(subscriptionStateTone("active")).toBe("success");
    expect(subscriptionStateTone("expiring_soon")).toBe("warning");
    expect(subscriptionStateTone("review")).toBe("warning");
    expect(subscriptionStateTone("frozen")).toBe("danger");
    expect(subscriptionStateTone("expired")).toBe("danger");
  });

  it("counts whole days remaining and never invents a date", () => {
    const inFive = new Date(Date.now() + 5 * 86_400_000 - 1000).toISOString();
    expect(daysUntil(inFive)).toBe(5);
    expect(daysUntil(null)).toBeNull();
    expect(daysUntil(new Date(Date.now() - 86_400_000).toISOString())).toBeLessThanOrEqual(0);
  });
});

describe("upgrade proration rule (30-day month)", () => {
  // Mirrors public.subscription_quote so the documented maths stays visible.
  const quote = (oldPrice: number, daysLeft: number, newPrice: number) => {
    const daily = Math.round((oldPrice / 30) * 10_000) / 10_000;
    const unused = Math.min(Math.round(daily * daysLeft * 100) / 100, newPrice);
    return { unused, due: Math.max(0, Math.round((newPrice - unused) * 100) / 100 ) };
  };

  it("credits unused value against the first month of the new plan", () => {
    expect(quote(100, 15, 150)).toEqual({ unused: 50, due: 100 });
  });

  it("never charges below zero and never refunds", () => {
    expect(quote(200, 30, 50).due).toBe(0);
  });

  it("charges the full price when nothing is left of the old period", () => {
    expect(quote(100, 0, 150)).toEqual({ unused: 0, due: 150 });
  });
});
