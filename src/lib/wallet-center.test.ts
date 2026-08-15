import { describe, expect, it } from "vitest";
import {
  canSendUpward,
  projectedBalance,
  totalWalletBalance,
  upwardRelationLabel,
  validateInShopTransfer,
  type WalletShop,
} from "@/lib/wallet-center";

const shops: WalletShop[] = [
  { ecosystemId: "a", ecosystemName: "Shop A", balance: 120.5, role: "subreseller" },
  { ecosystemId: "b", ecosystemName: "Shop B", balance: 10, role: "customer" },
];

describe("totalWalletBalance", () => {
  it("adds every shop wallet", () => {
    expect(totalWalletBalance(shops)).toBe(130.5);
  });
  it("is zero with no wallets", () => {
    expect(totalWalletBalance([])).toBe(0);
  });
});

describe("projectedBalance", () => {
  it("subtracts the amount", () => {
    expect(projectedBalance(100, 25)).toBe(75);
  });
  it("never goes negative", () => {
    expect(projectedBalance(10, 40)).toBe(0);
  });
});

describe("canSendUpward", () => {
  it("is true only for a subreseller of the selected shop", () => {
    expect(canSendUpward(shops[0]!)).toBe(true);
    expect(canSendUpward(shops[1]!)).toBe(false);
    expect(canSendUpward(null)).toBe(false);
  });
});

describe("validateInShopTransfer", () => {
  const base = { ecosystemId: "a", recipientId: "r", amount: 50, balance: 100 };
  it("accepts a valid transfer", () => {
    expect(validateInShopTransfer(base)).toBeNull();
  });
  it("requires a shop", () => {
    expect(validateInShopTransfer({ ...base, ecosystemId: null })).toMatch(/shop wallet/);
  });
  it("requires a recipient", () => {
    expect(validateInShopTransfer({ ...base, recipientId: null })).toMatch(/recipient/);
  });
  it("rejects a non-positive amount", () => {
    expect(validateInShopTransfer({ ...base, amount: 0 })).toMatch(/positive/);
  });
  it("rejects more than the wallet holds", () => {
    expect(validateInShopTransfer({ ...base, amount: 500 })).toMatch(/more than/);
  });
});

describe("upwardRelationLabel", () => {
  it("names the relationship", () => {
    expect(upwardRelationLabel("reseller")).toBe("My reseller");
    expect(upwardRelationLabel("admin")).toBe("Shop admin");
  });
});
