import { describe, expect, it } from "vitest";
import { voucherCost } from "./wallet";
import { amountDue } from "./credit-purchases";

describe("admin voucher shop discount", () => {
  it("charges an admin 0 credits at 100% off", () => {
    expect(voucherCost(10, 100)).toBe(0);
  });

  it("charges resellers and customers their own rates", () => {
    expect(voucherCost(10, 20)).toBe(8); // reseller
    expect(voucherCost(10, 10)).toBe(9); // subreseller
    expect(voucherCost(10, 0)).toBe(10); // customer
  });

  it("clamps out-of-range discounts", () => {
    expect(voucherCost(10, 150)).toBe(0);
    expect(voucherCost(10, -50)).toBe(10);
  });

  it("keeps credit allocation pricing independent of the voucher discount", () => {
    // Voucher discount 100% must not zero out the allocation price on its own.
    expect(amountDue(10, 0)).toBe(10);
    expect(amountDue(10, 100)).toBe(0);
  });
});
