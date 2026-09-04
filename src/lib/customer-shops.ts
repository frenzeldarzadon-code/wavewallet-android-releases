/**
 * Customer shop entitlements — pure helpers.
 *
 * Universe is the customer portal. A member relates to a shop in two separate
 * ways that must never be confused:
 *
 *  - membership (an active row in ecosystem_memberships), controlled by the
 *    shop admin's existing rules; and
 *  - customer entitlement, earned by actually buying that shop's vouchers.
 *
 * Live Monitoring is available through either: an active member of a shop, or
 * anyone who owns a voucher that shop issued. Browsing a shop never grants
 * anything. The server function that lists shops re-derives every input from
 * the caller's own rows; this module only merges them.
 */

export interface CustomerShop {
  id: string;
  name: string;
  slug: string;
  logoPath: string | null;
  /** Active membership role in this shop, or null when the member never joined. */
  role: string | null;
  /** Vouchers this shop issued and sold to the caller. */
  ownedVouchers: number;
  /** Points balance in this shop's rewards program. */
  points: number;
  /** True when the shop has a hotspot controller connected (needed for live data). */
  controllerConfigured: boolean;
}

export interface CustomerShopInputs {
  memberships: Array<{ ecosystem_id: string; role: string }>;
  vouchers: Array<{ ecosystem_id: string }>;
  points: Array<{ ecosystem_id: string; balance: number | string | null }>;
  shops: Array<{
    id: string;
    name: string;
    slug: string;
    logo_path?: string | null;
    archived_at?: string | null;
  }>;
  controllers: Array<{ ecosystem_id: string }>;
}

/** Ecosystem ids the caller relates to through membership, purchase or points. */
export function relatedShopIds(i: Pick<CustomerShopInputs, "memberships" | "vouchers" | "points">) {
  const ids = new Set<string>();
  for (const m of i.memberships) ids.add(m.ecosystem_id);
  for (const v of i.vouchers) ids.add(v.ecosystem_id);
  for (const p of i.points) ids.add(p.ecosystem_id);
  return [...ids];
}

/** Merges the caller's own rows into one list, dropping archived shops. */
export function mergeCustomerShops(i: CustomerShopInputs): CustomerShop[] {
  const roles = new Map<string, string>();
  for (const m of i.memberships) roles.set(m.ecosystem_id, m.role);
  const owned = new Map<string, number>();
  for (const v of i.vouchers) owned.set(v.ecosystem_id, (owned.get(v.ecosystem_id) ?? 0) + 1);
  const points = new Map<string, number>();
  for (const p of i.points) points.set(p.ecosystem_id, Number(p.balance ?? 0));
  const controllers = new Set(i.controllers.map((c) => c.ecosystem_id));

  return i.shops
    .filter((s) => !s.archived_at)
    .map((s) => ({
      id: s.id,
      name: s.name,
      slug: s.slug,
      logoPath: s.logo_path ?? null,
      role: roles.get(s.id) ?? null,
      ownedVouchers: owned.get(s.id) ?? 0,
      points: points.get(s.id) ?? 0,
      controllerConfigured: controllers.has(s.id),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Existing rule: active member OR owns a voucher the shop issued. */
export function canMonitor(s: Pick<CustomerShop, "role" | "ownedVouchers">): boolean {
  return s.role !== null || s.ownedVouchers > 0;
}

export function monitorableShops(list: CustomerShop[]): CustomerShop[] {
  return list.filter(canMonitor);
}

/** Reward Shops: every shop where the member holds points or has bought/joined. */
export function rewardShops(list: CustomerShop[]): CustomerShop[] {
  return list.filter((s) => s.points > 0 || canMonitor(s));
}

/* ------------------------------------------------------------------ */
/* Purchase history — originating shop labels                          */
/* ------------------------------------------------------------------ */

/**
 * Label of the shop a purchase was made in. Resolved from the shop id the sale
 * row recorded at purchase time (`voucher_sales.ecosystem_id`), never from the
 * buyer's or seller's current affiliation.
 */
export interface PurchaseShopLabel {
  id: string;
  name: string;
  slug: string;
  logoPath: string | null;
  /** True when the Universe storefront can still be opened. */
  storefrontOpen: boolean;
}

export interface PurchaseShopLabels {
  shops: Record<string, PurchaseShopLabel>;
  /** Seller display names keyed by profile id (only sellers of the caller's own purchases). */
  sellers: Record<string, string>;
}

export const UNAVAILABLE_SHOP_LABEL = "Shop unavailable";

/** Builds the label map from raw shop rows; archived shops keep their name but lose the link. */
export function buildPurchaseShopLabels(
  shops: Array<{
    id: string;
    name: string;
    slug: string;
    logo_path?: string | null;
    archived_at?: string | null;
    public_storefront_enabled?: boolean | null;
  }>,
  sellers: Array<{ id: string; full_name: string | null }>,
): PurchaseShopLabels {
  const out: PurchaseShopLabels = { shops: {}, sellers: {} };
  for (const s of shops) {
    out.shops[s.id] = {
      id: s.id,
      name: s.name,
      slug: s.slug,
      logoPath: s.logo_path ?? null,
      storefrontOpen: !s.archived_at && s.public_storefront_enabled !== false,
    };
  }
  for (const p of sellers) if (p.full_name) out.sellers[p.id] = p.full_name;
  return out;
}

/** Shop label for a purchase, or a graceful placeholder when it cannot be resolved. */
export function purchaseShopFor(
  labels: PurchaseShopLabels | null | undefined,
  ecosystemId: string | null | undefined,
): PurchaseShopLabel | null {
  if (!labels || !ecosystemId) return null;
  return labels.shops[ecosystemId] ?? null;
}
