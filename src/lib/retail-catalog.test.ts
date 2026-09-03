import { describe, expect, it } from "vitest";
import {
  DEFAULT_CATALOG_QUERY,
  applyCatalogQuery,
  availabilityLabel,
  catalogCategories,
  catalogQueryActive,
  matchesSearch,
  productSubtitle,
} from "@/lib/retail-catalog";
import { sellerToCustomer, type RetailProduct } from "@/lib/retail";

const product = (o: Partial<RetailProduct> & { id: string; name: string }): RetailProduct => ({
  description: null,
  image_path: null,
  price: 10,
  stock: 10,
  sold_count: 0,
  public_visible: true,
  rating_avg: 0,
  rating_count: 0,
  ...o,
});

const catalog: RetailProduct[] = [
  product({ id: "a", name: "Lucky Me Pancit Canton", brand: "Lucky Me", category: "Noodles", price: 15, sold_count: 40, rating_avg: 4.5, rating_count: 12 }),
  product({ id: "b", name: "Coke Mismo", brand: "Coca-Cola", category: "Drinks", price: 20, sold_count: 90, rating_avg: 4.0, rating_count: 30 }),
  product({ id: "c", name: "Bear Brand Milk", brand: "Nestlé", category: "Drinks", price: 100, stock: 0, sold_count: 200, rating_avg: 4.9, rating_count: 5 }),
  product({ id: "d", name: "Safeguard Soap", category: "  ", price: 35, stock: 3 }),
];

describe("catalogCategories", () => {
  it("counts non-blank categories, most products first", () => {
    expect(catalogCategories(catalog)).toEqual([
      { name: "Drinks", count: 2 },
      { name: "Noodles", count: 1 },
    ]);
  });
});

describe("matchesSearch", () => {
  it("matches every token across name, brand, category", () => {
    expect(matchesSearch(catalog[0]!, "lucky canton")).toBe(true);
    expect(matchesSearch(catalog[0]!, "noodles")).toBe(true);
    expect(matchesSearch(catalog[0]!, "lucky coke")).toBe(false);
    expect(matchesSearch(catalog[0]!, "   ")).toBe(true);
  });
});

describe("applyCatalogQuery", () => {
  it("featured order puts in-stock products first, then best sellers", () => {
    const ids = applyCatalogQuery(catalog, DEFAULT_CATALOG_QUERY, 1).map((p) => p.id);
    expect(ids).toEqual(["b", "a", "d", "c"]);
  });

  it("filters by category and stock", () => {
    expect(
      applyCatalogQuery(catalog, { ...DEFAULT_CATALOG_QUERY, category: "Drinks" }, 1).map((p) => p.id),
    ).toEqual(["b", "c"]);
    expect(
      applyCatalogQuery(catalog, { ...DEFAULT_CATALOG_QUERY, category: "Drinks", inStockOnly: true }, 1).map(
        (p) => p.id,
      ),
    ).toEqual(["b"]);
  });

  it("sorts by the customer Retail Price (fee-inclusive), never mutating input order semantics", () => {
    const asc = applyCatalogQuery(catalog, { ...DEFAULT_CATALOG_QUERY, sort: "price-asc" }, 1);
    expect(asc.map((p) => p.id)).toEqual(["a", "b", "d", "c"]);
    // Seller Cut ₱100 → Retail ₱101 with a 1% fee: the sort key is the Retail Price.
    expect(sellerToCustomer(asc[3]!.price, 1)).toBe(101);
    const desc = applyCatalogQuery(catalog, { ...DEFAULT_CATALOG_QUERY, sort: "price-desc" }, 1);
    expect(desc[0]!.id).toBe("c");
  });

  it("sorts by popularity, rating and name", () => {
    expect(applyCatalogQuery(catalog, { ...DEFAULT_CATALOG_QUERY, sort: "popular" }, 0)[0]!.id).toBe("c");
    expect(applyCatalogQuery(catalog, { ...DEFAULT_CATALOG_QUERY, sort: "rating" }, 0)[0]!.id).toBe("c");
    expect(applyCatalogQuery(catalog, { ...DEFAULT_CATALOG_QUERY, sort: "name" }, 0)[0]!.id).toBe("c");
  });

  it("combines search with filters", () => {
    const r = applyCatalogQuery(catalog, { ...DEFAULT_CATALOG_QUERY, search: "milk", category: "Drinks" }, 0);
    expect(r.map((p) => p.id)).toEqual(["c"]);
  });
});

describe("presentation helpers", () => {
  it("reports when discovery controls are active", () => {
    expect(catalogQueryActive(DEFAULT_CATALOG_QUERY)).toBe(false);
    expect(catalogQueryActive({ ...DEFAULT_CATALOG_QUERY, search: " x" })).toBe(true);
    expect(catalogQueryActive({ ...DEFAULT_CATALOG_QUERY, sort: "name" })).toBe(true);
  });

  it("builds subtitles and availability badges", () => {
    expect(productSubtitle({ brand: "Nestlé", variant: null, size_label: "300ml" })).toBe("Nestlé · 300ml");
    expect(availabilityLabel(0)).toEqual({ label: "Sold out", tone: "danger" });
    expect(availabilityLabel(3)).toEqual({ label: "Only 3 left", tone: "warning" });
    expect(availabilityLabel(50)).toEqual({ label: "In stock", tone: "success" });
  });
});
