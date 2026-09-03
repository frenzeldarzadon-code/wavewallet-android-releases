/**
 * Shop type — one explicit management setting derived from the shop record
 * that already exists (`shop_kind` + the two store flags). The database is
 * authoritative (`shop_type`, `set_shop_type`, `create_universe_shop`); this
 * module only mirrors the classification for the UI and wraps the RPCs.
 *
 *   new_generation   shop_kind = 'subscription' — isolated shop wallets,
 *                    never part of Universe commerce.
 *   universe_voucher Universe shop selling WiFi voucher codes.
 *   universe_retail  Universe shop selling physical goods (Retail/COD).
 *
 * `universe_mixed` / `universe_unset` are legacy states that need an admin
 * decision; they are surfaced, never silently reclassified.
 */
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";

export type ShopType = "new_generation" | "universe_voucher" | "universe_retail";
export type ShopTypeState = ShopType | "universe_mixed" | "universe_unset";

export const SHOP_TYPES: ShopType[] = ["new_generation", "universe_voucher", "universe_retail"];

export interface ShopTypeInfo {
  type: ShopType;
  label: string;
  short: string;
  tagline: string;
  description: string;
  /** Semantic tone keys — mapped to theme tokens in the card component. */
  tone: "brand" | "success" | "warning";
}

export const SHOP_TYPE_INFO: Record<ShopType, ShopTypeInfo> = {
  new_generation: {
    type: "new_generation",
    label: "New Generation",
    short: "New Generation",
    tagline: "Isolated hotspot shop",
    description:
      "WiFi vouchers with a Shop ID, plan and shop-only wallets. Completely separate from Universe commerce — coins never leave this shop.",
    tone: "warning",
  },
  universe_voucher: {
    type: "universe_voucher",
    label: "Universe Voucher",
    short: "Universe · Vouchers",
    tagline: "WiFi vouchers on the Universe",
    description:
      "Sell WiFi voucher codes to any Universe member. Uses members' Universe wallets, discovery, resellers and cashback.",
    tone: "brand",
  },
  universe_retail: {
    type: "universe_retail",
    label: "Universe Retail",
    short: "Universe · Retail",
    tagline: "Physical goods on the Universe",
    description:
      "Sell products with photos, stock, wholesale prices, cash-on-delivery, delivery and collectors. Uses Universe wallets and Retail cashback.",
    tone: "success",
  },
};

export function shopTypeLabel(t: ShopTypeState | null | undefined): string {
  if (!t) return "Shop";
  if (t === "universe_mixed") return "Universe · needs a type";
  if (t === "universe_unset") return "Universe · no store enabled";
  return SHOP_TYPE_INFO[t].label;
}

/** Same rule as the database `shop_type()` function. */
export function deriveShopType(
  shop: Pick<Tables<"ecosystems">, "shop_kind" | "store_voucher_enabled" | "store_retail_enabled">,
): ShopTypeState {
  if (shop.shop_kind === "subscription") return "new_generation";
  if (shop.store_retail_enabled && !shop.store_voucher_enabled) return "universe_retail";
  if (shop.store_voucher_enabled && !shop.store_retail_enabled) return "universe_voucher";
  if (shop.store_voucher_enabled && shop.store_retail_enabled) return "universe_mixed";
  return "universe_unset";
}

export const isUniverseType = (t: ShopTypeState | null | undefined) =>
  t === "universe_voucher" || t === "universe_retail" || t === "universe_mixed" || t === "universe_unset";

/** Which admin areas a shop of this type manages. */
export function showsVoucherTools(t: ShopTypeState | null | undefined): boolean {
  // Unknown / loading → keep the voucher tools (today's default) rather than blanking the console.
  return t !== "universe_retail";
}
export function showsRetailTools(t: ShopTypeState | null | undefined): boolean {
  return t === "universe_retail" || t === "universe_mixed";
}

/** Where a freshly created shop lands. */
export function homeRouteFor(t: ShopType): "/admin" | "/admin/retail" | "/admin/products" {
  if (t === "universe_retail") return "/admin/retail";
  if (t === "universe_voucher") return "/admin/products";
  return "/admin";
}

export async function setShopType(
  ecosystemId: string,
  type: Extract<ShopType, "universe_voucher" | "universe_retail">,
): Promise<ShopTypeState> {
  const { data, error } = await supabase.rpc("set_shop_type", {
    _ecosystem_id: ecosystemId,
    _shop_type: type,
  });
  if (error) throw new Error(error.message);
  return data as ShopTypeState;
}

export async function createUniverseShop(input: {
  name: string;
  type: Extract<ShopType, "universe_voucher" | "universe_retail">;
  description?: string;
}): Promise<Tables<"ecosystems">> {
  const { data, error } = await supabase.rpc("create_universe_shop", {
    _name: input.name,
    _shop_type: input.type,
    ...(input.description ? { _description: input.description } : {}),
  });
  if (error) throw new Error(error.message);
  return data as unknown as Tables<"ecosystems">;
}

/** Makes the new shop the active one so the console opens inside it. */
export async function switchToShop(ecosystemId: string): Promise<void> {
  const { error } = await supabase.rpc("switch_ecosystem", { _ecosystem_id: ecosystemId });
  if (error) throw new Error(error.message);
}

/**
 * Shop type for each of the caller's shops, keyed by ecosystem id. Reads only
 * the ecosystems RLS already lets the member see; shops that are not readable
 * are simply absent from the map.
 */
export async function fetchShopTypes(ecosystemIds: string[]): Promise<Record<string, ShopTypeState>> {
  if (ecosystemIds.length === 0) return {};
  const { data } = await supabase
    .from("ecosystems")
    .select("id, shop_kind, store_voucher_enabled, store_retail_enabled")
    .in("id", ecosystemIds);
  const out: Record<string, ShopTypeState> = {};
  for (const row of (data ?? []) as {
    id: string;
    shop_kind: string | null;
    store_voucher_enabled: boolean;
    store_retail_enabled: boolean;
  }[]) {
    out[row.id] = deriveShopType({
      shop_kind: row.shop_kind ?? "universe",
      store_voucher_enabled: row.store_voucher_enabled,
      store_retail_enabled: row.store_retail_enabled,
    });
  }
  return out;
}
