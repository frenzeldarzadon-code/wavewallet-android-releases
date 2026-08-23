import { describe, expect, it } from "vitest";
import {
  isLegacyShop,
  isNewGenerationShop,
  normalizePhMobile,
  normalizeSenderIdentifier,
  validateGoLive,
} from "@/lib/go-live";

describe("shop kind", () => {
  it("separates New Generation from Legacy", () => {
    expect(isNewGenerationShop({ shop_kind: "subscription" })).toBe(true);
    expect(isLegacyShop({ shop_kind: "subscription" })).toBe(false);
    expect(isLegacyShop({ shop_kind: "legacy" })).toBe(true);
    expect(isLegacyShop(null)).toBe(false);
  });
});

describe("normalizePhMobile", () => {
  it("normalises every accepted PH form to 639XXXXXXXXX", () => {
    expect(normalizePhMobile("09171234567")).toBe("639171234567");
    expect(normalizePhMobile("+63 917 123 4567")).toBe("639171234567");
    expect(normalizePhMobile("9171234567")).toBe("639171234567");
  });
  it("rejects anything else", () => {
    expect(normalizePhMobile("12345")).toBeNull();
    expect(normalizePhMobile("")).toBeNull();
  });
});

describe("validateGoLive", () => {
  it("requires a valid sending number and a reference", () => {
    expect(validateGoLive({ payerNumber: "12", reference: "9044057598177" })).toMatch(
      /account number or mobile number/i,
    );
    expect(validateGoLive({ payerNumber: "09171234567", reference: "12" })).toMatch(/reference/);
    expect(validateGoLive({ payerNumber: "09171234567", reference: "9044057598177" })).toBeNull();
  });
  it("accepts any provider sender identifier, not just 09 numbers", () => {
    // MariBank / bank account number
    expect(validateGoLive({ payerNumber: "15976553427", reference: "9044057598177" })).toBeNull();
    // GCash mobile number
    expect(validateGoLive({ payerNumber: "09541230072", reference: "9044057598177" })).toBeNull();
    // Alphanumeric wallet/bank identifier
    expect(validateGoLive({ payerNumber: "ACCT-9931-XY", reference: "9044057598177" })).toBeNull();
  });
  it("requires a payment screenshot when one is expected", () => {
    expect(
      validateGoLive({ payerNumber: "09171234567", reference: "9044057598177", proofPath: "" }),
    ).toMatch(/screenshot/);
    expect(
      validateGoLive({ payerNumber: "09171234567", reference: "9044057598177", proofPath: "u/1.jpg" }),
    ).toBeNull();
  });
});

describe("normalizeSenderIdentifier", () => {
  it("keeps PH mobiles normalised and accepts bank account numbers", () => {
    expect(normalizeSenderIdentifier("09541230072")).toBe("639541230072");
    expect(normalizeSenderIdentifier("15976553427")).toBe("15976553427");
    expect(normalizeSenderIdentifier("ACCT-9931-XY")).toBe("acct9931xy");
  });
  it("still rejects empty or too-short values", () => {
    expect(normalizeSenderIdentifier("")).toBeNull();
    expect(normalizeSenderIdentifier("12")).toBeNull();
  });
});
