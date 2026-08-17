/**
 * Universe-wide member directory.
 *
 * Any Universe member may look up any other member by name or @handle and
 * narrow the list by Province -> City/Municipality -> Barangay. The database
 * function returns identity and area only: no balances, no phone or email, no
 * internal roles, no reseller lineage and never the exact street or house
 * number.
 */
import { supabase } from "@/integrations/supabase/client";

export interface DirectoryMember {
  id: string;
  full_name: string;
  handle: string | null;
  avatar_path: string | null;
  province: string | null;
  city_municipality: string | null;
  barangay: string | null;
}

export interface DirectoryFilters {
  query: string;
  province: string;
  cityMunicipality: string;
  barangay: string;
}

export const EMPTY_FILTERS: DirectoryFilters = {
  query: "",
  province: "",
  cityMunicipality: "",
  barangay: "",
};

/**
 * A search needs something to go on: either two characters of a name/@handle,
 * or at least a province. This is what the "Proceed" button obeys.
 */
export function canSearch(f: DirectoryFilters): boolean {
  return f.query.trim().length >= 2 || f.province.trim().length > 0;
}

export function searchHint(f: DirectoryFilters): string {
  if (canSearch(f)) return "Ready — tap Proceed to load matching members.";
  return "Type at least 2 characters of a name or @handle, or choose a province.";
}

export function activeFilterCount(f: DirectoryFilters): number {
  return [f.province, f.cityMunicipality, f.barangay].filter((v) => v.trim()).length;
}

export async function searchDirectory(
  f: DirectoryFilters,
  limit = 30,
): Promise<DirectoryMember[]> {
  const { data, error } = await supabase.rpc("universe_directory", {
    ...(f.query.trim() ? { _query: f.query.trim() } : {}),
    ...(f.province.trim() ? { _province: f.province.trim() } : {}),
    ...(f.cityMunicipality.trim() ? { _city_municipality: f.cityMunicipality.trim() } : {}),
    ...(f.barangay.trim() ? { _barangay: f.barangay.trim() } : {}),
    _limit: limit,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as DirectoryMember[];
}
