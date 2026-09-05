/**
 * Universe-wide product discovery ("All Products").
 *
 * The database (`universe_product_feed`) is authoritative for visibility and
 * ranking: it only returns in-stock, published/active products of public,
 * non-frozen, non-archived Universe shops, and scores them from the signals
 * that actually exist (30-day sales, 30-day views, ratings, newness, the
 * viewer's own purchases/views, per-shop diversity and a seeded shuffle).
 * This module wraps the RPCs and keeps the pure helpers testable.
 */
import { supabase } from "@/integrations/supabase/client";

export type FeedSection = "all" | "trending" | "new";

export interface FeedProduct {
  kind: "voucher" | "retail";
  id: string;
  name: string;
  description: string | null;
  imagePath: string | null;
  price: number;
  available: number;
  category: string | null;
  brand: string | null;
  sizeLabel: string | null;
  ratingAvg: number;
  ratingCount: number;
  sold30d: number;
  views30d: number;
  createdAt: string;
  shopId: string;
  shopName: string;
  shopSlug: string;
  shopLogoPath: string | null;
  score: number;
  isNew: boolean;
  isTrending: boolean;
}

type Row = {
  kind: string;
  id: string;
  name: string;
  description: string | null;
  image_path: string | null;
  price: number | string;
  available: number;
  category: string | null;
  brand: string | null;
  size_label: string | null;
  rating_avg: number | string | null;
  rating_count: number | null;
  sold_30d: number | null;
  views_30d: number | null;
  created_at: string;
  shop_id: string;
  shop_name: string;
  shop_slug: string;
  shop_logo_path: string | null;
  score: number | string | null;
  is_new: boolean | null;
  is_trending: boolean | null;
};

export function mapFeedRow(r: Row): FeedProduct {
  return {
    kind: r.kind === "retail" ? "retail" : "voucher",
    id: r.id,
    name: r.name,
    description: r.description,
    imagePath: r.image_path,
    price: Number(r.price),
    available: Number(r.available ?? 0),
    category: r.category,
    brand: r.brand,
    sizeLabel: r.size_label,
    ratingAvg: Number(r.rating_avg ?? 0),
    ratingCount: Number(r.rating_count ?? 0),
    sold30d: Number(r.sold_30d ?? 0),
    views30d: Number(r.views_30d ?? 0),
    createdAt: r.created_at,
    shopId: r.shop_id,
    shopName: r.shop_name,
    shopSlug: r.shop_slug,
    shopLogoPath: r.shop_logo_path,
    score: Number(r.score ?? 0),
    isNew: !!r.is_new,
    isTrending: !!r.is_trending,
  };
}

/** Appends a page while dropping anything already shown (keeps the feed free of repeats). */
export function mergeFeedPages(existing: FeedProduct[], next: FeedProduct[]): FeedProduct[] {
  const seen = new Set(existing.map((p) => `${p.kind}:${p.id}`));
  const out = [...existing];
  for (const p of next) {
    const key = `${p.kind}:${p.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}

/** Short badge text for a card, derived only from real signals. */
export function feedBadge(p: Pick<FeedProduct, "isTrending" | "isNew" | "sold30d">): string | null {
  if (p.isTrending) return "Trending";
  if (p.isNew) return "New";
  if (p.sold30d > 0) return `${p.sold30d} sold this month`;
  return null;
}

/** One seed per browser session so paging stays consistent but each visit reshuffles. */
export function sessionSeed(): number {
  if (typeof window === "undefined") return 0;
  const key = "universe-feed-seed";
  const stored = window.sessionStorage.getItem(key);
  if (stored) return Number(stored);
  const seed = Math.floor(Math.random() * 1_000_000);
  window.sessionStorage.setItem(key, String(seed));
  return seed;
}

export const FEED_PAGE_SIZE = 24;

export async function fetchProductFeed(input: {
  section: FeedSection;
  category?: string | null;
  seed: number;
  offset: number;
  limit?: number;
}): Promise<FeedProduct[]> {
  const { data, error } = await supabase.rpc("universe_product_feed", {
    _section: input.section,
    _category: input.category ?? null,
    _seed: input.seed,
    _limit: input.limit ?? FEED_PAGE_SIZE,
    _offset: input.offset,
  } as never);
  if (error) throw new Error(error.message);
  return ((data ?? []) as Row[]).map(mapFeedRow);
}

export async function fetchProductCategories(): Promise<Array<{ category: string; count: number }>> {
  const { data, error } = await supabase.rpc("universe_product_categories" as never);
  if (error) throw new Error(error.message);
  return ((data ?? []) as Array<{ category: string; product_count: number }>).map((c) => ({
    category: c.category,
    count: Number(c.product_count ?? 0),
  }));
}

/** Records that the signed-in member opened a product (fire-and-forget). */
export function recordProductView(kind: "voucher" | "retail", productId: string): void {
  void supabase
    .rpc("record_universe_product_view", { _kind: kind, _product_id: productId } as never)
    .then(() => undefined, () => undefined);
}
