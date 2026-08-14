import { describe, expect, it } from "vitest";
import {
  destinationOptions,
  quoteShopTransfer,
  validateShopTransfer,
  type ShopWallet,
} from "@/lib/shop-transfers";

const wallets: ShopWallet[] = [
  { ecosystemId: "a", ecosystemName: "Shop A", balance: 100 },
  { ecosystemId: "b", ecosystemName: "Shop B", balance: 0 },
];

describe("quoteShopTransfer", () => {
  it("deducts the flat fee from the amount", () => {
    expect(quoteShopTransfer(100, 5)).toEqual({ amount: 100, fee: 5, net: 95 });
  });
  it("never returns a negative net", () => {
    expect(quoteShopTransfer(3, 5).net).toBe(0);
  });
});

describe("validateShopTransfer", () => {
  const base = { fromEcosystemId: "a", toEcosystemId: "b", amount: 50, balance: 100, fee: 5 };
  it("accepts a valid transfer", () => {
    expect(validateShopTransfer(base)).toBeNull();
  });
  it("rejects the same shop twice", () => {
    expect(validateShopTransfer({ ...base, toEcosystemId: "a" })).toMatch(/different shops/);
  });
  it("rejects an amount at or below the fee", () => {
    expect(validateShopTransfer({ ...base, amount: 5 })).toMatch(/fee/);
  });
  it("rejects more than the source wallet holds", () => {
    expect(validateShopTransfer({ ...base, amount: 200 })).toMatch(/source shop wallet/);
  });
  it("requires both shops", () => {
    expect(validateShopTransfer({ ...base, toEcosystemId: null })).toMatch(/source and a destination/);
  });
});

describe("destinationOptions", () => {
  it("excludes the source shop", () => {
    expect(destinationOptions(wallets, "a").map((w) => w.ecosystemId)).toEqual(["b"]);
  });
});
