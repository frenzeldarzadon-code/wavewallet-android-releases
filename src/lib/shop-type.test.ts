import { describe, expect, it } from "vitest";
import {
  deriveShopType,
  homeRouteFor,
  shopTypeLabel,
  showsRetailTools,
  showsVoucherTools,
} from "./shop-type";

const eco = (o: Partial<Parameters<typeof deriveShopType>[0]>) => ({
  shop_kind: "universe",
  store_voucher_enabled: true,
  store_retail_enabled: false,
  ...o,
});

describe("deriveShopType", () => {
  it("classifies New Generation regardless of store flags (isolation)", () => {
    expect(deriveShopType(eco({ shop_kind: "subscription" }))).toBe("new_generation");
    expect(
      deriveShopType(eco({ shop_kind: "subscription", store_retail_enabled: true })),
    ).toBe("new_generation");
  });
  it("classifies Universe voucher and retail exclusively", () => {
    expect(deriveShopType(eco({}))).toBe("universe_voucher");
    expect(
      deriveShopType(eco({ store_voucher_enabled: false, store_retail_enabled: true })),
    ).toBe("universe_retail");
  });
  it("surfaces legacy mixed / unset states instead of guessing", () => {
    expect(deriveShopType(eco({ store_retail_enabled: true }))).toBe("universe_mixed");
    expect(deriveShopType(eco({ store_voucher_enabled: false }))).toBe("universe_unset");
    expect(shopTypeLabel("universe_mixed")).toMatch(/needs a type/);
  });
  it("treats legacy shop_kind like Universe (matches is_legacy_shop mapping)", () => {
    expect(deriveShopType(eco({ shop_kind: "legacy" }))).toBe("universe_voucher");
  });
});

describe("tool visibility", () => {
  it("retail shops never show voucher tools; voucher/NG shops never show retail tools", () => {
    expect(showsVoucherTools("universe_retail")).toBe(false);
    expect(showsRetailTools("universe_retail")).toBe(true);
    expect(showsVoucherTools("universe_voucher")).toBe(true);
    expect(showsRetailTools("universe_voucher")).toBe(false);
    expect(showsVoucherTools("new_generation")).toBe(true);
    expect(showsRetailTools("new_generation")).toBe(false);
  });
  it("keeps the voucher console while the type is still loading", () => {
    expect(showsVoucherTools(null)).toBe(true);
    expect(showsRetailTools(null)).toBe(false);
  });
  it("routes each type to its own management home", () => {
    expect(homeRouteFor("universe_retail")).toBe("/admin/retail");
    expect(homeRouteFor("universe_voucher")).toBe("/admin/products");
    expect(homeRouteFor("new_generation")).toBe("/admin");
  });
});
