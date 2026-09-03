/**
 * Customer marketplace discovery helpers — pure, presentation-only.
 *
 * Search, category filtering, sorting and incremental paging all run over the
 * shop's already-loaded customer-safe product list (`list_retail_products`,
 * one shop at a time). Nothing here touches prices: the Retail Price shown to
 * the buyer still comes from the existing `sellerToCustomer` mirror and the
 * database remains the only authority at checkout.
 */
import { useEffect, useState } from "react";
import { sellerToCustomer, type RetailProduct } from "@/lib/retail";

export type CatalogSort = "featured" | "price-asc" | "price-desc" | "popular" | "rating" | "name";

export interface CatalogQuery {
  search: string;
  category: string | null;
  sort: CatalogSort;
  inStockOnly: boolean;
}

export const DEFAULT_CATALOG_QUERY: CatalogQuery = {
  search: "",
  category: null,
  sort: "featured",
  inStockOnly: false,
};

/** Products rendered per "Show more" step so a long catalog never paints at once. */
export const CATALOG_PAGE_SIZE = 24;

export const CATALOG_SORT_LABELS: Record<CatalogSort, string> = {
  featured: "Featured",
  popular: "Best selling",
  rating: "Top rated",
  "price-asc": "Price: low to high",
  "price-desc": "Price: high to low",
  name: "Name A–Z",
};

export interface CatalogCategory {
  name: string;
  count: number;
}

/** Distinct categories with product counts, most stocked first, then A–Z. */
export function catalogCategories(products: RetailProduct[]): CatalogCategory[] {
  const counts = new Map<string, number>();
  for (const p of products) {
    const c = (p.category ?? "").trim();
    if (!c) continue;
    counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

const haystack = (p: RetailProduct) =>
  [p.name, p.brand, p.variant, p.size_label, p.category, p.description]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

/** Every whitespace-separated search token must appear somewhere in the product. */
export function matchesSearch(p: RetailProduct, search: string): boolean {
  const tokens = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true;
  const text = haystack(p);
  return tokens.every((t) => text.includes(t));
}

/**
 * Featured order: in-stock first, then best sellers, then rating, then name —
 * so a phone-sized first screen shows things the buyer can actually order.
 */
function featuredRank(a: RetailProduct, b: RetailProduct): number {
  const stock = Number(b.stock > 0) - Number(a.stock > 0);
  if (stock) return stock;
  const sold = (b.sold_count ?? 0) - (a.sold_count ?? 0);
  if (sold) return sold;
  const rating = (b.rating_avg ?? 0) - (a.rating_avg ?? 0);
  if (rating) return rating;
  return a.name.localeCompare(b.name);
}

export function applyCatalogQuery(
  products: RetailProduct[],
  q: CatalogQuery,
  feePercent: number,
): RetailProduct[] {
  const list = products.filter(
    (p) =>
      (!q.category || (p.category ?? "").trim() === q.category) &&
      (!q.inStockOnly || p.stock > 0) &&
      matchesSearch(p, q.search),
  );
  const retail = (p: RetailProduct) => sellerToCustomer(p.price, feePercent);
  return list.sort((a, b) => {
    switch (q.sort) {
      case "price-asc":
        return retail(a) - retail(b) || a.name.localeCompare(b.name);
      case "price-desc":
        return retail(b) - retail(a) || a.name.localeCompare(b.name);
      case "popular":
        return (b.sold_count ?? 0) - (a.sold_count ?? 0) || a.name.localeCompare(b.name);
      case "rating":
        return (
          (b.rating_avg ?? 0) - (a.rating_avg ?? 0) ||
          (b.rating_count ?? 0) - (a.rating_count ?? 0) ||
          a.name.localeCompare(b.name)
        );
      case "name":
        return a.name.localeCompare(b.name);
      default:
        return featuredRank(a, b);
    }
  });
}

/** True when any discovery control differs from the defaults. */
export const catalogQueryActive = (q: CatalogQuery) =>
  q.search.trim() !== "" || q.category !== null || q.inStockOnly || q.sort !== "featured";

/** Short secondary line under a product name: brand · variant · size. */
export function productSubtitle(p: Pick<RetailProduct, "brand" | "variant" | "size_label">) {
  return [p.brand, p.variant, p.size_label].filter(Boolean).join(" · ");
}

/** Concise availability copy for a card badge. */
export function availabilityLabel(stock: number): {
  label: string;
  tone: "success" | "warning" | "danger";
} {
  if (stock <= 0) return { label: "Sold out", tone: "danger" };
  if (stock <= 5) return { label: `Only ${stock} left`, tone: "warning" };
  return { label: "In stock", tone: "success" };
}

/** Value that lags `value` by `delay` ms — keeps search filtering off the keystroke path. */
export function useDebouncedValue<T>(value: T, delay = 220): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(t);
  }, [value, delay]);
  return debounced;
}
