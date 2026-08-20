import { describe, expect, it } from "vitest";
import { isLegacyShop, isNewGenerationShop, normalizePhMobile, validateGoLive } from "@/lib/go-live";

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
    expect(validateGoLive({ payerNumber: "123", reference: "9044057598177" })).toMatch(/GCash number/);
    expect(validateGoLive({ payerNumber: "09171234567", reference: "12" })).toMatch(/reference/);
    expect(validateGoLive({ payerNumber: "09171234567", reference: "9044057598177" })).toBeNull();
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
