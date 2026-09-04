import { describe, expect, it } from "vitest";
import {
  balanceAfterTransfer,
  newTransferKey,
  parseCoinAmount,
  recipientLabel,
  validateUniverseTransfer,
} from "@/lib/universe-transfer";

const base = { senderId: "me", recipientId: "them", amount: 50, balance: 100 };

describe("validateUniverseTransfer", () => {
  it("accepts a valid global-wallet transfer with no shop or upline involved", () => {
    expect(validateUniverseTransfer(base)).toBeNull();
  });
  it("blocks self-transfer", () => {
    expect(validateUniverseTransfer({ ...base, recipientId: "me" })).toMatch(/yourself/);
  });
  it("blocks zero, negative and non-numeric amounts", () => {
    expect(validateUniverseTransfer({ ...base, amount: 0 })).toMatch(/positive/);
    expect(validateUniverseTransfer({ ...base, amount: -5 })).toMatch(/positive/);
    expect(validateUniverseTransfer({ ...base, amount: Number.NaN })).toMatch(/positive/);
  });
  it("blocks more than the global balance", () => {
    expect(validateUniverseTransfer({ ...base, amount: 100.01 })).toMatch(/Universe wallet holds/);
  });
  it("allows sending the whole balance", () => {
    expect(validateUniverseTransfer({ ...base, amount: 100 })).toBeNull();
  });
  it("rejects sub-centavo amounts", () => {
    expect(validateUniverseTransfer({ ...base, amount: 1.005 })).toMatch(/decimals/);
  });
  it("requires a recipient and a signed-in sender", () => {
    expect(validateUniverseTransfer({ ...base, recipientId: null })).toMatch(/who to send/);
    expect(validateUniverseTransfer({ ...base, senderId: null })).toMatch(/Sign in/);
  });
  it("caps the optional note", () => {
    expect(validateUniverseTransfer({ ...base, note: "x".repeat(81) })).toMatch(/note/);
    expect(validateUniverseTransfer({ ...base, note: "thanks" })).toBeNull();
  });
});

describe("amount helpers", () => {
  it("parses keypad input", () => {
    expect(parseCoinAmount("1,250.50")).toBe(1250.5);
    expect(parseCoinAmount("")).toBe(0);
    expect(parseCoinAmount("abc")).toBe(0);
  });
  it("never projects a negative balance", () => {
    expect(balanceAfterTransfer(100, 40)).toBe(60);
    expect(balanceAfterTransfer(10, 40)).toBe(0);
  });
});

describe("recipientLabel / newTransferKey", () => {
  it("prefers the @handle", () => {
    expect(recipientLabel({ full_name: "Ana Cruz", handle: "ana" })).toBe("@ana");
    expect(recipientLabel({ full_name: "Ana Cruz", handle: null })).toBe("Ana Cruz");
  });
  it("issues a fresh key per attempt", () => {
    expect(newTransferKey()).not.toBe(newTransferKey());
  });
});
