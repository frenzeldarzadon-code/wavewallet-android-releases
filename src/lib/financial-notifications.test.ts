import { describe, expect, it } from "vitest";
import {
  FINANCIAL_CATEGORIES,
  deliverySummary,
  deviceLabel,
  isFinancialKind,
} from "@/lib/financial-notifications";
import { NOTIFICATION_CATEGORIES, toggleCategory } from "@/lib/notifications";

describe("financial notification categories", () => {
  it("covers every money event we notify about", () => {
    const kinds = FINANCIAL_CATEGORIES.map((c) => c.kind);
    for (const expected of [
      "cash_in",
      "purchase",
      "cashback",
      "transfer",
      "points",
      "reward_redemption",
      "refund",
      "withdrawal",
      "wallet_adjustment",
    ]) {
      expect(kinds).toContain(expected);
    }
  });

  it("exposes financial and social categories together, without duplicates", () => {
    const kinds = NOTIFICATION_CATEGORIES.map((c) => c.kind);
    expect(new Set(kinds).size).toBe(kinds.length);
    expect(kinds).toContain("cash_in");
    expect(kinds).toContain("dm_message");
  });

  it("recognises financial kinds only", () => {
    expect(isFinancialKind("cash_in")).toBe(true);
    expect(isFinancialKind("social_like")).toBe(false);
  });

  it("lets a person mute a money category without losing the others", () => {
    const disabled = toggleCategory([], "cash_in", false);
    expect(disabled).toEqual(["cash_in"]);
    expect(toggleCategory(disabled, "cash_in", true)).toEqual([]);
  });
});

describe("delivery wording", () => {
  it("never claims a send that did not happen", () => {
    expect(deliverySummary(null)).toBe("Saved to your list");
    expect(deliverySummary("skipped")).toBe("Saved to your list");
    expect(deliverySummary("pending")).toBe("Alert queued");
    expect(deliverySummary("failed")).toBe("Alert could not be delivered");
    expect(deliverySummary("pending,sent")).toBe("Alert sent");
  });
});

describe("device labels", () => {
  it("names common devices in plain language", () => {
    expect(deviceLabel("Mozilla/5.0 (Linux; Android 14; Pixel)")).toBe("Android phone");
    expect(deviceLabel("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)")).toBe("iPhone");
    expect(deviceLabel("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)")).toBe("Mac");
    expect(deviceLabel("Mozilla/5.0 (Windows NT 10.0)")).toBe("Windows PC");
    expect(deviceLabel("something unknown")).toBe("This browser");
  });
});
