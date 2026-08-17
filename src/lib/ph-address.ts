/**
 * Philippine address, captured to Barangay level.
 *
 * Province, City/Municipality and Barangay are required when a member fills in
 * an address; Street and House/Unit number are always optional and must never
 * block a signup. The exact street and house number are private: they are never
 * returned by the Universe member directory.
 */

export interface AddressDraft {
  province: string;
  cityMunicipality: string;
  barangay: string;
  street?: string;
  houseNumber?: string;
}

/** Provinces and NCR districts, used for a controlled selector rather than free text. */
export const PH_PROVINCES: readonly string[] = [
  "Abra","Agusan del Norte","Agusan del Sur","Aklan","Albay","Antique","Apayao","Aurora",
  "Basilan","Bataan","Batanes","Batangas","Benguet","Biliran","Bohol","Bukidnon","Bulacan",
  "Cagayan","Camarines Norte","Camarines Sur","Camiguin","Capiz","Catanduanes","Cavite","Cebu",
  "Cotabato","Davao de Oro","Davao del Norte","Davao del Sur","Davao Occidental","Davao Oriental",
  "Dinagat Islands","Eastern Samar","Guimaras","Ifugao","Ilocos Norte","Ilocos Sur","Iloilo",
  "Isabela","Kalinga","La Union","Laguna","Lanao del Norte","Lanao del Sur","Leyte","Maguindanao del Norte",
  "Maguindanao del Sur","Marinduque","Masbate","Metro Manila","Misamis Occidental","Misamis Oriental",
  "Mountain Province","Negros Occidental","Negros Oriental","Northern Samar","Nueva Ecija","Nueva Vizcaya",
  "Occidental Mindoro","Oriental Mindoro","Palawan","Pampanga","Pangasinan","Quezon","Quirino","Rizal",
  "Romblon","Samar","Sarangani","Siquijor","Sorsogon","South Cotabato","Southern Leyte","Sultan Kudarat",
  "Sulu","Surigao del Norte","Surigao del Sur","Tarlac","Tawi-Tawi","Zambales","Zamboanga del Norte",
  "Zamboanga del Sur","Zamboanga Sibugay",
] as const;

export function isKnownProvince(value: string): boolean {
  const v = value.trim().toLowerCase();
  return PH_PROVINCES.some((p) => p.toLowerCase() === v);
}

/**
 * Returns a message when the required part of the address is missing, or null
 * when it is complete. Street and house number are never checked.
 */
export function addressIssue(draft: AddressDraft): string | null {
  if (!draft.province.trim()) return "Choose your province.";
  if (!isKnownProvince(draft.province)) return "Choose your province from the list.";
  if (!draft.cityMunicipality.trim()) return "Enter your city or municipality.";
  if (!draft.barangay.trim()) return "Enter your barangay.";
  if (draft.cityMunicipality.trim().length > 80) return "That city or municipality name is too long.";
  if (draft.barangay.trim().length > 80) return "That barangay name is too long.";
  if ((draft.street ?? "").trim().length > 120) return "That street name is too long.";
  if ((draft.houseNumber ?? "").trim().length > 40) return "That house or unit number is too long.";
  return null;
}

/** True when a member has completed the required part of their address. */
export function hasRequiredAddress(
  p: { province?: string | null; city_municipality?: string | null; barangay?: string | null } | null,
): boolean {
  return Boolean(p?.province?.trim() && p?.city_municipality?.trim() && p?.barangay?.trim());
}

/** Public one-line area label: barangay, city, province. Never street or house number. */
export function areaLabel(
  p: { province?: string | null; city_municipality?: string | null; barangay?: string | null } | null,
): string {
  const parts = [p?.barangay, p?.city_municipality, p?.province]
    .map((s) => (s ?? "").trim())
    .filter(Boolean);
  return parts.join(", ");
}

/** Full address for the owner's own eyes, including the optional parts. */
export function fullAddressLabel(p: {
  house_number?: string | null;
  street?: string | null;
  barangay?: string | null;
  city_municipality?: string | null;
  province?: string | null;
}): string {
  const parts = [p.house_number, p.street, p.barangay, p.city_municipality, p.province]
    .map((s) => (s ?? "").trim())
    .filter(Boolean);
  return parts.join(", ");
}
