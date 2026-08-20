/**
 * Shop ID, municipality discovery and joining.
 *
 * A New Generation shop carries a stable, human-facing 7-digit Shop ID. It is
 * NOT the internal id, it is never reused, and it is the only handle a guest or
 * a member needs to find and join a shop.
 *
 * This is a convenience discovery mechanism, never a public marketplace: the
 * database only ever returns a shop's name, its general location and its Shop
 * ID. Membership itself is still granted by the normal join operation.
 *
 * Legacy shops are untouched — they keep their slug + signup token links.
 */
import { supabase } from "@/integrations/supabase/client";
import { requireOnline } from "@/lib/offline-guard";

export interface ShopSummary {
  id: string;
  name: string;
  shopCode: string;
  province: string | null;
  cityMunicipality: string | null;
}

export interface MunicipalityOption {
  province: string;
  cityMunicipality: string;
  shopCount: number;
}

/* ------------------------------------------------------------------ */
/* Pure helpers (unit-tested)                                          */
/* ------------------------------------------------------------------ */

export const SHOP_CODE_LENGTH = 7;

/** Keeps digits only, so "123-4567" and "123 4567" both work. */
export function normalizeShopCode(value: string): string {
  return (value ?? "").replace(/\D+/g, "").slice(0, SHOP_CODE_LENGTH);
}

/** Guidance shown BEFORE submitting — never only as an error afterwards. */
export function shopCodeIssue(value: string): string | null {
  const code = normalizeShopCode(value);
  if (!code) return "Enter the 7-digit Shop ID.";
  if (code.length !== SHOP_CODE_LENGTH) return "A Shop ID is exactly 7 digits.";
  return null;
}

export const isCompleteShopCode = (value: string) =>
  normalizeShopCode(value).length === SHOP_CODE_LENGTH;

/**
 * Where a shop appears in municipality discovery: its own Shop Address when
 * filled, otherwise the shop admin's address. Cleared Shop Address falls back
 * to the admin again — one operator can run shops in different towns without
 * touching their personal address.
 */
export function effectiveShopLocation(
  shop: { province?: string | null; cityMunicipality?: string | null },
  admin: { province?: string | null; cityMunicipality?: string | null },
): { province: string | null; cityMunicipality: string | null } {
  const pick = (a?: string | null, b?: string | null) => a?.trim() || b?.trim() || null;
  return {
    province: pick(shop.province, admin.province),
    cityMunicipality: pick(shop.cityMunicipality, admin.cityMunicipality),
  };
}

/** A shop only appears in discovery when it has an effective municipality. */
export function isDiscoverable(loc: {
  province: string | null;
  cityMunicipality: string | null;
}): boolean {
  return Boolean(loc.province && loc.cityMunicipality);
}

/** The direct, shop-specific sign-up link an admin can copy and share. */
export function shopSignupLink(origin: string, shopCode: string): string {
  return `${origin.replace(/\/$/, "")}/?shop=${normalizeShopCode(shopCode)}`;
}

/* ------------------------------------------------------------------ */
/* Data access                                                         */
/* ------------------------------------------------------------------ */

type Row = {
  id: string;
  name: string;
  shop_code: string;
  province: string | null;
  city_municipality: string | null;
};

const toSummary = (r: Row): ShopSummary => ({
  id: r.id,
  name: r.name,
  shopCode: r.shop_code,
  province: r.province,
  cityMunicipality: r.city_municipality,
});

/** Resolves a 7-digit Shop ID. Returns null when nothing matches. */
export async function findShopByCode(code: string): Promise<ShopSummary | null> {
  const clean = normalizeShopCode(code);
  if (clean.length !== SHOP_CODE_LENGTH) return null;
  const { data, error } = await supabase.rpc("find_shop_by_code", { _code: clean });
  if (error) throw new Error(error.message);
  const row = (data as Row[] | null)?.[0];
  return row ? toSummary(row) : null;
}

/** Municipalities that actually have a discoverable shop — no sample values. */
export async function fetchDiscoveryMunicipalities(): Promise<MunicipalityOption[]> {
  const { data, error } = await supabase.rpc("shop_discovery_municipalities");
  if (error) throw new Error(error.message);
  return ((data ?? []) as { province: string; city_municipality: string; shop_count: number }[]).map(
    (r) => ({
      province: r.province,
      cityMunicipality: r.city_municipality,
      shopCount: Number(r.shop_count ?? 0),
    }),
  );
}

/** Operators in the chosen municipality — name and Shop ID only. */
export async function fetchShopsInMunicipality(
  province: string,
  cityMunicipality: string,
): Promise<ShopSummary[]> {
  const { data, error } = await supabase.rpc("shops_in_municipality", {
    _province: province,
    _city: cityMunicipality,
  });
  if (error) throw new Error(error.message);
  return ((data ?? []) as Row[]).map(toSummary);
}

/** Joins by Shop ID. The database re-checks every membership rule. */
export async function joinShopByCode(code: string): Promise<string> {
  requireOnline();
  const problem = shopCodeIssue(code);
  if (problem) throw new Error(problem);
  const { data, error } = await supabase.rpc("join_shop_by_code", {
    _code: normalizeShopCode(code),
  });
  if (error) throw new Error(error.message);
  return data as string;
}

/** Shop Address of a New Generation shop. Blank fields clear the address. */
export async function saveShopAddress(
  ecosystemId: string,
  address: {
    province?: string;
    cityMunicipality?: string;
    barangay?: string;
    street?: string;
  },
): Promise<void> {
  requireOnline();
  const { error } = await supabase.rpc("set_shop_address", {
    _ecosystem_id: ecosystemId,
    _province: address.province ?? "",
    _city_municipality: address.cityMunicipality ?? "",
    _barangay: address.barangay ?? "",
    _street: address.street ?? "",
  });
  if (error) throw new Error(error.message);
}
