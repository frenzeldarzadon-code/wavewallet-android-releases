import { describe, expect, it } from "vitest";
import { voucherArtworkUrl } from "./voucher-artwork";

describe("voucherArtworkUrl", () => {
  it("chooses a stable bundled asset for the same voucher", () => {
    expect(voucherArtworkUrl("shop-a-product-a")).toBe(voucherArtworkUrl("shop-a-product-a"));
    expect(voucherArtworkUrl("shop-a-product-a")).toContain("/__l5e/assets-v1/");
  });

  it("keeps artwork inside the existing app asset pipeline", () => {
    for (const seed of ["1 hour", "1 day", "7 days", "30 days"]) {
      expect(voucherArtworkUrl(seed).startsWith("/__l5e/assets-v1/")).toBe(true);
    }
  });
});