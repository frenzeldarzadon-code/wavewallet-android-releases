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
import type { PresenceInfo } from "@/lib/presence";

export interface StorefrontProduct {
  id: string;
  name: string;
  description: string | null;
  price: number;
  available: number;
  /** Points price in the SELLING shop's points; null/0 = not redeemable with points. */
  pointsPrice?: number | null;
  /** Voucher uploads are not supported yet; reserved for existing public product imagery. */
  imagePath?: string | null;
}

export interface StorefrontShop {
  id: string;
  name: string;
  slug: string;
  /** Selling shop's coins-per-point ratio; 0/null = this shop awards no points. */
  creditsPerPoint?: number | null;
  products: StorefrontProduct[];
}

/**
 * A Universe RETAIL shop the seller is authorized for. Retail goods use the
 * existing cart/checkout flow on the shop's retail store page, so the profile
 * only shows the shop card and links there (with this seller attributed).
 */
export interface RetailStorefrontShop {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  logoPath: string | null;
  productCount: number;
  acceptingOrders: boolean;
}

export interface SellerStorefront {
  sellerId: string;
  sellerName: string;
  sellerHandle: string;
  avatarPath: string | null;
  /** Customer-facing storefront name; defaults to "<Name>'s Store" until customised. */
  storeName: string;
  /** Universe Voucher shops (immediate purchase). */
  shops: StorefrontShop[];
  /** Universe Retail shops (cart/checkout on the shop's retail store). */
  retailShops: RetailStorefrontShop[];
}

/** Default storefront name used when a seller has not customised theirs. */
export function defaultStoreName(fullName: string): string {
  return `${fullName.trim()}'s Store`;
}

type SellerIdentity = {
  seller_id: string;
  seller_name: string;
  seller_handle: string;
  avatar_path: string | null;
  store_name?: string | null;
};

type Row = SellerIdentity & {
  shop_id: string;
  shop_name: string;
  shop_slug: string;
  product_id: string;
  product_name: string;
  description: string | null;
  price: number;
  available: number;
  points_price?: number | null;
  credits_per_point?: number | null;
};

type RetailRow = SellerIdentity & {
  shop_id: string;
  shop_name: string;
  shop_slug: string;
  shop_description: string | null;
  logo_path: string | null;
  product_count: number | null;
  accepting_orders: boolean | null;
};

function identityOf(first: SellerIdentity): Omit<SellerStorefront, "shops" | "retailShops"> {
  return {
    sellerId: first.seller_id,
    sellerName: first.seller_name,
    sellerHandle: first.seller_handle,
    avatarPath: first.avatar_path,
    storeName: first.store_name?.trim() || defaultStoreName(first.seller_name),
  };
}

/**
 * Pure: groups the flat voucher rows by shop (database order) and attaches the
 * seller's Retail shops. A shop never appears twice: voucher rows and retail
 * rows come from mutually exclusive store flags, and a legacy "mixed" shop is
 * kept once in each list only because it genuinely offers both kinds.
 */
export function groupStorefrontRows(rows: Row[], retailRows: RetailRow[] = []): SellerStorefront | null {
  const first: SellerIdentity | undefined = rows[0] ?? retailRows[0];
  if (!first) return null;
  const shops = new Map<string, StorefrontShop>();
  for (const r of rows) {
    let shop = shops.get(r.shop_id);
    if (!shop) {
      shop = {
        id: r.shop_id,
        name: r.shop_name,
        slug: r.shop_slug,
        creditsPerPoint: r.credits_per_point == null ? null : Number(r.credits_per_point),
        products: [],
      };
      shops.set(r.shop_id, shop);
    }
    shop.products.push({
      id: r.product_id,
      name: r.product_name,
      description: r.description,
      price: Number(r.price),
      available: Number(r.available ?? 0),
      pointsPrice: r.points_price == null ? null : Number(r.points_price),
      imagePath: null,
    });
  }
  const retail = new Map<string, RetailStorefrontShop>();
  for (const r of retailRows) {
    if (retail.has(r.shop_id)) continue;
    retail.set(r.shop_id, {
      id: r.shop_id,
      name: r.shop_name,
      slug: r.shop_slug,
      description: r.shop_description,
      logoPath: r.logo_path,
      productCount: Number(r.product_count ?? 0),
      acceptingOrders: r.accepting_orders !== false,
    });
  }
  return {
    ...identityOf(first),
    shops: [...shops.values()],
    retailShops: [...retail.values()],
  };
}

/** True when the seller has at least one shop of any kind to show. */
export function hasStorefront(store: SellerStorefront | null): store is SellerStorefront {
  return !!store && (store.shops.length > 0 || store.retailShops.length > 0);
}

/**
 * Public storefront of one seller (by @handle): every Universe shop — Voucher
 * and Retail — they are an authorized seller of. Null when they sell nothing.
 */
export async function fetchSellerStorefront(handle: string): Promise<SellerStorefront | null> {
  const [voucher, retail] = await Promise.all([
    supabase.rpc("seller_storefront", { _handle: handle }),
    supabase.rpc("seller_storefront_retail", { _handle: handle }),
  ]);
  if (voucher.error) throw new Error(voucher.error.message);
  if (retail.error) throw new Error(retail.error.message);
  return groupStorefrontRows((voucher.data ?? []) as Row[], (retail.data ?? []) as RetailRow[]);
}

export interface ShopSeller extends PresenceInfo {
  sellerId: string;
  sellerName: string;
  sellerHandle: string;
  avatarPath: string | null;
  storeName: string;
}

/**
 * Authorized sellers of a Universe shop — identity + storefront name + coarse
 * presence. The server already orders by presence (online → most recent →
 * name); authorization/eligibility rules are unchanged.
 */
export async function fetchUniverseSellers(slug: string): Promise<ShopSeller[]> {
  const { data, error } = await supabase.rpc("universe_sellers_for_shop", { _slug: slug });
  if (error) throw new Error(error.message);
  return ((data ?? []) as {
    seller_id: string;
    seller_name: string;
    seller_handle: string;
    avatar_path: string | null;
    store_name?: string | null;
    online?: boolean | null;
    last_seen_at?: string | null;
  }[]).map((r) => ({
    sellerId: r.seller_id,
    sellerName: r.seller_name,
    sellerHandle: r.seller_handle,
    avatarPath: r.avatar_path,
    storeName: r.store_name?.trim() || defaultStoreName(r.seller_name),
    online: !!r.online,
    lastSeenAt: r.last_seen_at ?? null,
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
