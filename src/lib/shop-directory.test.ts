import { describe, expect, it } from "vitest";
import {
  effectiveShopLocation,
  isCompleteShopCode,
  isDiscoverable,
  normalizeShopCode,
  shopCodeIssue,
  shopSignupLink,
} from "@/lib/shop-directory";

describe("shop id", () => {
  it("keeps digits only", () => {
    expect(normalizeShopCode("123-4567")).toBe("1234567");
    expect(normalizeShopCode(" 123 4567 ")).toBe("1234567");
    expect(normalizeShopCode("12345678901")).toBe("1234567");
  });

  it("guides before submission", () => {
    expect(shopCodeIssue("")).toBe("Enter the 7-digit Shop ID.");
    expect(shopCodeIssue("1234")).toBe("A Shop ID is exactly 7 digits.");
    expect(shopCodeIssue("1234567")).toBeNull();
    expect(isCompleteShopCode("123 4567")).toBe(true);
  });

  it("builds a direct shop sign-up link", () => {
    expect(shopSignupLink("https://wallet.example.com/", "1234567")).toBe(
      "https://wallet.example.com/?shop=1234567",
    );
  });
});

describe("effective shop location", () => {
  const admin = { province: "Mountain Province", cityMunicipality: "Sagada" };

  it("falls back to the operator address", () => {
    expect(effectiveShopLocation({}, admin)).toEqual(admin);
  });

  it("prefers the shop address when filled", () => {
    const loc = effectiveShopLocation(
      { province: "Benguet", cityMunicipality: "La Trinidad" },
      admin,
    );
    expect(loc).toEqual({ province: "Benguet", cityMunicipality: "La Trinidad" });
  });

  it("falls back again when the shop address is cleared", () => {
    expect(effectiveShopLocation({ province: "", cityMunicipality: "  " }, admin)).toEqual(admin);
  });

  it("hides shops with no effective address", () => {
    expect(isDiscoverable(effectiveShopLocation({}, {}))).toBe(false);
    expect(isDiscoverable(effectiveShopLocation({}, admin))).toBe(true);
  });
});
