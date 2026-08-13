import { describe, expect, it } from "vitest";
import { RELEASE_WARNING, STATUS_LABEL, amountDue, formatPhp } from "@/lib/credit-purchases";

describe("amountDue", () => {
  it("charges the full list price with no discount", () => {
    expect(amountDue(10, 0)).toBe(10);
  });

  it("charges nothing at the default 100% admin benefit", () => {
    expect(amountDue(250, 100)).toBe(0);
  });

  it("applies a partial discount and rounds to centavos", () => {
    expect(amountDue(10, 33)).toBe(6.7);
    expect(amountDue(99.99, 50)).toBe(50);
  });

  it("clamps nonsense discounts instead of inventing negative prices", () => {
    expect(amountDue(10, 150)).toBe(0);
    expect(amountDue(10, -20)).toBe(10);
  });
});

describe("formatPhp", () => {
  it("always shows two decimals with the configured currency", () => {
    expect(formatPhp(0)).toBe("PHP 0.00");
    expect(formatPhp(1234.5, "PHP")).toBe("PHP 1,234.50");
  });
});

describe("status labels", () => {
  it("never presents a pending payment as released credits", () => {
    expect(STATUS_LABEL.pending).toMatch(/pending/i);
    expect(STATUS_LABEL.rejected).toMatch(/rejected/i);
    expect(STATUS_LABEL.frozen).toMatch(/frozen/i);
    expect(STATUS_LABEL.approved).toMatch(/released/i);
  });

  it("warns that released credits can still be frozen", () => {
    expect(RELEASE_WARNING).toMatch(/freeze or withhold/i);
  });
});
