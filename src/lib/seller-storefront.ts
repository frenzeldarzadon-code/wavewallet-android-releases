/**
 * Universe seller storefronts.
 *
 * A Universe shop's admin, resellers and subresellers are its authorized
 * sellers. Each seller's public profile shows the shop products they may sell;
 * a purchase made there is attributed to that seller by the database, which
 * re-checks the authorization on every purchase.
 *
 * Everything here is identity + product data only: no roles, rates, uplines,
 * wallets or private shop relationships ever reach the client.
 */
import { supabase } from "@/integrations/supabase/client";

export interface StorefrontProduct {
  id: string;
  name: string;
  description: string | null;
  price: number;
  available: number;
  /** Points price in the SELLING shop's points; null/0 = not redeemable with points. */
  pointsPrice?: number | null;
}

export interface StorefrontShop {
  id: string;
  name: string;
  slug: string;
  products: StorefrontProduct[];
}

export interface SellerStorefront {
  sellerId: string;
  sellerName: string;
  sellerHandle: string;
  avatarPath: string | null;
  /** Customer-facing storefront name; defaults to "<Name>'s Store" until customised. */
  storeName: string;
  shops: StorefrontShop[];
}

/** Default storefront name used when a seller has not customised theirs. */
export function defaultStoreName(fullName: string): string {
  return `${fullName.trim()}'s Store`;
}

type Row = {
  seller_id: string;
  seller_name: string;
  seller_handle: string;
  avatar_path: string | null;
  store_name?: string | null;
  shop_id: string;
  shop_name: string;
  shop_slug: string;
  product_id: string;
  product_name: string;
  description: string | null;
  price: number;
  available: number;
  points_price?: number | null;
};

/** Pure: groups the flat database rows by shop, keeping the database order. */
export function groupStorefrontRows(rows: Row[]): SellerStorefront | null {
  const first = rows[0];
  if (!first) return null;
  const shops = new Map<string, StorefrontShop>();
  for (const r of rows) {
    let shop = shops.get(r.shop_id);
    if (!shop) {
      shop = { id: r.shop_id, name: r.shop_name, slug: r.shop_slug, products: [] };
      shops.set(r.shop_id, shop);
    }
    shop.products.push({
      id: r.product_id,
      name: r.product_name,
      description: r.description,
      price: Number(r.price),
      available: Number(r.available ?? 0),
      pointsPrice: r.points_price == null ? null : Number(r.points_price),
    });
  }
  return {
    sellerId: first.seller_id,
    sellerName: first.seller_name,
    sellerHandle: first.seller_handle,
    avatarPath: first.avatar_path,
    storeName: first.store_name?.trim() || defaultStoreName(first.seller_name),
    shops: [...shops.values()],
  };
}

/** Public storefront of one seller (by @handle). Null when they sell nothing. */
export async function fetchSellerStorefront(handle: string): Promise<SellerStorefront | null> {
  const { data, error } = await supabase.rpc("seller_storefront", { _handle: handle });
  if (error) throw new Error(error.message);
  return groupStorefrontRows((data ?? []) as Row[]);
}

export interface ShopSeller {
  sellerId: string;
  sellerName: string;
  sellerHandle: string;
  avatarPath: string | null;
  storeName: string;
}

/** Authorized sellers of a Universe shop — identity + storefront name only. */
export async function fetchUniverseSellers(slug: string): Promise<ShopSeller[]> {
  const { data, error } = await supabase.rpc("universe_sellers_for_shop", { _slug: slug });
  if (error) throw new Error(error.message);
  return ((data ?? []) as {
    seller_id: string;
    seller_name: string;
    seller_handle: string;
    avatar_path: string | null;
    store_name?: string | null;
  }[]).map((r) => ({
    sellerId: r.seller_id,
    sellerName: r.seller_name,
    sellerHandle: r.seller_handle,
    avatarPath: r.avatar_path,
    storeName: r.store_name?.trim() || defaultStoreName(r.seller_name),
  }));
}

// ---------------------------------------------------------------------------
// Universe discovery: search Universe shops by shop name or voucher name.
// ---------------------------------------------------------------------------

export interface DiscoveredProduct extends StorefrontProduct {
  /** True when this product's name matched the search term. */
  matches: boolean;
}

export interface DiscoveredShop extends Omit<StorefrontShop, "products"> {
  description: string | null;
  products: DiscoveredProduct[];
}

type SearchRow = {
  shop_id: string;
  shop_name: string;
  shop_slug: string;
  shop_description: string | null;
  product_id: string | null;
  product_name: string | null;
  product_description: string | null;
  price: number | null;
  available: number | null;
  product_matches: boolean | null;
};

/** Pure: groups flat search rows by shop; shops without products are kept. */
export function groupShopSearchRows(rows: SearchRow[]): DiscoveredShop[] {
  const shops = new Map<string, DiscoveredShop>();
  for (const r of rows) {
    let shop = shops.get(r.shop_id);
    if (!shop) {
      shop = {
        id: r.shop_id,
        name: r.shop_name,
        slug: r.shop_slug,
        description: r.shop_description,
        products: [],
      };
      shops.set(r.shop_id, shop);
    }
    if (r.product_id && r.product_name) {
      shop.products.push({
        id: r.product_id,
        name: r.product_name,
        description: r.product_description,
        price: Number(r.price ?? 0),
        available: Number(r.available ?? 0),
        matches: Boolean(r.product_matches),
      });
    }
  }
  return [...shops.values()];
}

/** Signed-in only. Public shop + voucher fields; never hierarchy or rates. */
export async function searchUniverseShops(q: string, limit = 20): Promise<DiscoveredShop[]> {
  const { data, error } = await supabase.rpc("universe_shop_search", { _q: q, _limit: limit });
  if (error) throw new Error(error.message);
  return groupShopSearchRows((data ?? []) as SearchRow[]);
}
