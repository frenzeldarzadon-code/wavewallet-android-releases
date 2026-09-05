import { describe, expect, it } from "vitest";
import { feedBadge, mapFeedRow, mergeFeedPages, type FeedProduct } from "./universe-products";

const p = (over: Partial<FeedProduct>): FeedProduct => ({
  kind: "retail",
  id: "a",
  name: "Soap",
  description: null,
  imagePath: null,
  price: 10,
  available: 5,
  category: "Personal care",
  brand: null,
  sizeLabel: null,
  ratingAvg: 0,
  ratingCount: 0,
  sold30d: 0,
  views30d: 0,
  createdAt: "2026-09-01T00:00:00Z",
  shopId: "s",
  shopName: "Shop",
  shopSlug: "shop",
  shopLogoPath: null,
  score: 1,
  isNew: false,
  isTrending: false,
  ...over,
});

describe("universe product feed helpers", () => {
  it("never repeats a product across pages, even when the ranking shifts", () => {
    const merged = mergeFeedPages([p({ id: "a" }), p({ id: "b" })], [p({ id: "b" }), p({ id: "c" })]);
    expect(merged.map((x) => x.id)).toEqual(["a", "b", "c"]);
  });

  it("treats a voucher and a retail product with the same id as distinct", () => {
    expect(mergeFeedPages([p({ id: "x", kind: "voucher" })], [p({ id: "x", kind: "retail" })])).toHaveLength(2);
  });

  it("labels cards only from real signals", () => {
    expect(feedBadge(p({ isTrending: true, isNew: true }))).toBe("Trending");
    expect(feedBadge(p({ isNew: true }))).toBe("New");
    expect(feedBadge(p({ sold30d: 4 }))).toBe("4 sold this month");
    expect(feedBadge(p({}))).toBeNull();
  });

  it("maps numeric strings from the database", () => {
    const m = mapFeedRow({
      kind: "voucher", id: "v", name: "1 Day", description: null, image_path: null, price: "20.00",
      available: 3, category: "Vouchers", brand: null, size_label: null, rating_avg: "4.50", rating_count: 2,
      sold_30d: 9, views_30d: null, created_at: "2026-09-01T00:00:00Z", shop_id: "s", shop_name: "S",
      shop_slug: "s", shop_logo_path: null, score: "3.2", is_new: true, is_trending: null,
    });
    expect(m).toMatchObject({ kind: "voucher", price: 20, ratingAvg: 4.5, views30d: 0, score: 3.2, isNew: true, isTrending: false });
  });
});
