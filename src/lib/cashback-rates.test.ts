import { describe, expect, it } from "vitest";
import { adminRemainder, describeSplit, validateCashbackRate } from "./cashback-rates";

describe("individual cashback rates", () => {
  it("accepts whole percentages inside 0–100", () => {
    expect(validateCashbackRate(0)).toBeNull();
    expect(validateCashbackRate(30)).toBeNull();
    expect(validateCashbackRate(100)).toBeNull();
  });

  it("rejects out-of-range and fractional rates", () => {
    expect(validateCashbackRate(-1)).not.toBeNull();
    expect(validateCashbackRate(101)).not.toBeNull();
    expect(validateCashbackRate(12.5)).not.toBeNull();
    expect(validateCashbackRate(Number.NaN)).not.toBeNull();
  });

  it("gives the admin the remainder and never less than zero", () => {
    expect(adminRemainder(10, 20)).toBe(70);
    expect(adminRemainder(0, 0)).toBe(100);
    expect(adminRemainder(60, 40)).toBe(0);
    expect(adminRemainder(80, 40)).toBe(0);
  });

  it("splits a purchase so the parts always add up to the amount", () => {
    const s = describeSplit(10, 10, 20);
    expect(s.reseller).toBe(1);
    expect(s.subreseller).toBe(2);
    expect(s.admin).toBe(7);
    expect(s.reseller + s.subreseller + s.admin).toBe(10);
  });

  it("gives the admin everything when nobody in the chain earns", () => {
    const s = describeSplit(100, 0, 0);
    expect(s.admin).toBe(100);
  });
});
