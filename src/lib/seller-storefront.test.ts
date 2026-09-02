import { describe, expect, it } from "vitest";
import { groupStorefrontRows } from "./seller-storefront";

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
    expect(Object.keys(out!)).toEqual(["sellerId", "sellerName", "sellerHandle", "avatarPath", "shops"]);
  });
});
