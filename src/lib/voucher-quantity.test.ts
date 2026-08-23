import { describe, expect, it } from "vitest";
import { commitQuantity, quantityFromInput, sanitizeQuantityInput } from "./voucher-quantity";

describe("voucher quantity input", () => {
  it("keeps digits only and drops leading zeros", () => {
    expect(sanitizeQuantityInput("5a0")).toBe("50");
    expect(sanitizeQuantityInput("-3")).toBe("3");
    expect(sanitizeQuantityInput("1.5")).toBe("15");
    expect(sanitizeQuantityInput("007")).toBe("7");
    expect(sanitizeQuantityInput("abc")).toBe("");
  });

  it("lets the field be empty mid-edit", () => {
    expect(quantityFromInput("", 50)).toBeNull();
    expect(commitQuantity("", 50)).toBe(1);
  });

  it("accepts a typed quantity up to the existing limit", () => {
    expect(quantityFromInput("50", 50)).toBe(50);
    expect(quantityFromInput("12", 50)).toBe(12);
  });

  it("clamps above the limit and never returns 0 or negatives", () => {
    expect(quantityFromInput("999", 50)).toBe(50);
    expect(quantityFromInput("0", 50)).toBeNull();
    expect(commitQuantity("0", 50)).toBe(1);
    expect(commitQuantity("-4", 50)).toBe(4);
  });

  it("respects a stock limit of a single voucher", () => {
    expect(quantityFromInput("9", 1)).toBe(1);
  });
});
