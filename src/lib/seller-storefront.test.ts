import { describe, expect, it } from "vitest";
import { defaultStoreName, groupShopSearchRows, groupStorefrontRows } from "./seller-storefront";

const row = (over: Partial<Parameters<typeof groupStorefrontRows>[0][number]> = {}) => ({
  seller_id: "s1",
  seller_name: "Ana",
  seller_handle: "ana",
  avatar_path: null,
  shop_id: "shop-a",
  shop_name: "Shop A",
  shop_slug: "shop-a",
  product_id: "p1",
  product_name: "1 Day",
  description: null,
  price: 20,
  available: 5,
  ...over,
});

describe("groupStorefrontRows", () => {
  it("returns null when the seller sells nothing", () => {
    expect(groupStorefrontRows([])).toBeNull();
  });

  it("groups products under their shop and keeps identity fields only", () => {
    const out = groupStorefrontRows([
      row(),
      row({ product_id: "p2", product_name: "7 Days", price: "100" as unknown as number }),
      row({ shop_id: "shop-b", shop_name: "Shop B", shop_slug: "shop-b", product_id: "p3" }),
    ]);
    expect(out).not.toBeNull();
    expect(out!.sellerHandle).toBe("ana");
    expect(out!.shops.map((s) => s.id)).toEqual(["shop-a", "shop-b"]);
    expect(out!.shops[0]!.products.map((p) => p.price)).toEqual([20, 100]);
    expect(out!.shops[0]!.products.every((p) => p.imagePath === null)).toBe(true);
    expect(Object.keys(out!)).toEqual([
      "sellerId",
      "sellerName",
      "sellerHandle",
      "avatarPath",
      "storeName",
      "shops",
    ]);
  });

  it("falls back to a default storefront name and honours a customised one", () => {
    expect(groupStorefrontRows([row()])!.storeName).toBe("Ana's Store");
    expect(groupStorefrontRows([row({ store_name: "  " })])!.storeName).toBe("Ana's Store");
    expect(groupStorefrontRows([row({ store_name: "Ana WiFi Hub" })])!.storeName).toBe("Ana WiFi Hub");
    expect(defaultStoreName(" Ana ")).toBe("Ana's Store");
  });
});


describe("groupShopSearchRows", () => {
  const srow = (over: Partial<Parameters<typeof groupShopSearchRows>[0][number]> = {}) => ({
    shop_id: "shop-a",
    shop_name: "Shop A",
    shop_slug: "shop-a",
    shop_description: null,
    product_id: "p1",
    product_name: "1 Day",
    product_description: null,
    price: 20,
    available: 3,
    product_matches: true,
    ...over,
  });

  it("keeps shops with no products and groups products per shop", () => {
    const out = groupShopSearchRows([
      srow(),
      srow({ product_id: "p2", product_name: "7 Days", product_matches: false, price: "100" as unknown as number }),
      srow({ shop_id: "shop-b", shop_name: "Shop B", shop_slug: "shop-b", product_id: null, product_name: null, price: null, available: null, product_matches: null }),
    ]);
    expect(out.map((s) => s.id)).toEqual(["shop-a", "shop-b"]);
    expect(out[0]!.products.map((p) => [p.name, p.price, p.matches])).toEqual([["1 Day", 20, true], ["7 Days", 100, false]]);
    expect(out[1]!.products).toEqual([]);
  });

  it("exposes only public shop/product fields (no hierarchy, rates or wallets)", () => {
    const [shop] = groupShopSearchRows([srow()]);
    expect(Object.keys(shop!).sort()).toEqual(["description", "id", "name", "products", "slug"]);
    expect(Object.keys(shop!.products[0]!).sort()).toEqual(["available", "description", "id", "matches", "name", "price"]);
  });
});
