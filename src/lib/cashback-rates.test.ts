import { describe, expect, it } from "vitest";
import {
  adminRemainder,
  describeSplit,
  parentShare,
  validateCashbackRate,
} from "./cashback-rates";

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

  it("gives the admin everything outside the parent reseller total", () => {
    expect(adminRemainder(30, 20)).toBe(70);
    expect(adminRemainder(30, 30)).toBe(70);
    expect(adminRemainder(0)).toBe(100);
    expect(adminRemainder(100, 100)).toBe(0);
  });

  it("carves the subreseller share out of the parent total", () => {
    expect(parentShare(30, 20)).toBe(10);
    expect(parentShare(30, 10)).toBe(20);
    expect(parentShare(30, 30)).toBe(0);
    expect(parentShare(30, 0)).toBe(30);
  });

  it("splits a 100-credit purchase exactly as specified", () => {
    expect(describeSplit(100, 30, 20)).toEqual({ subreseller: 20, reseller: 10, admin: 70 });
    expect(describeSplit(100, 30, 10)).toEqual({ subreseller: 10, reseller: 20, admin: 70 });
    expect(describeSplit(100, 30, 30)).toEqual({ subreseller: 30, reseller: 0, admin: 70 });
    expect(describeSplit(100, 30, 0)).toEqual({ subreseller: 0, reseller: 30, admin: 70 });
  });

  it("never lets the subreseller exceed the parent total", () => {
    const s = describeSplit(100, 30, 50);
    expect(s.subreseller).toBe(30);
    expect(s.reseller).toBe(0);
    expect(s.admin).toBe(70);
  });

  it("gives the admin everything when nobody in the chain earns", () => {
    const s = describeSplit(100, 0, 0);
    expect(s.admin).toBe(100);
    expect(s.reseller + s.subreseller).toBe(0);
  });

  it("keeps the parts adding up to the purchase amount", () => {
    const s = describeSplit(250, 30, 20);
    expect(s.reseller + s.subreseller + s.admin).toBe(250);
  });
});
