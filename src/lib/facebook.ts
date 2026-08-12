/**
 * Per-ecosystem Facebook support page.
 *
 * The URL is never hard-coded: it lives on the tenant's `ecosystems` row and is
 * set by the platform owner through `set_ecosystem_facebook`, which validates,
 * audit-logs and enforces super-admin-only writes. Admins read only their own
 * ecosystem row (RLS), so tenant isolation is enforced by the database.
 */
import { supabase } from "@/integrations/supabase/client";

const FACEBOOK_HOSTS = [
  "facebook.com",
  "www.facebook.com",
  "m.facebook.com",
  "web.facebook.com",
  "fb.com",
  "www.fb.com",
  "fb.me",
  "m.me",
  "messenger.com",
  "www.messenger.com",
];

/** Returns null when the value is a usable Facebook page URL, otherwise the problem. */
export function validateFacebookUrl(value: string): string | null {
  const raw = value.trim();
  if (!raw) return null; // empty clears the link — always allowed
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "Enter a full address, for example https://facebook.com/yourpage";
  }
  if (url.protocol !== "https:") return "The address must start with https://";
  if (!FACEBOOK_HOSTS.includes(url.hostname.toLowerCase()))
    return "That is not a Facebook page address.";
  if (url.pathname.replace(/\/+$/, "").length <= 1) return "Include the page path, not just the domain.";
  return null;
}

export const isFacebookUrl = (value: string) => Boolean(value.trim()) && validateFacebookUrl(value) === null;

/** Safe display label for the link — falls back to the page path. */
export function facebookLabel(url: string | null | undefined, name?: string | null): string {
  const clean = (name ?? "").trim();
  if (clean) return clean;
  if (!url) return "Facebook page";
  try {
    return new URL(url).pathname.replace(/^\/+|\/+$/g, "") || "Facebook page";
  } catch {
    return "Facebook page";
  }
}

export interface EcosystemFacebook {
  id: string;
  name: string;
  facebook_page_url: string | null;
  facebook_page_name: string | null;
}

/** Platform-owner view: RLS returns every tenant. */
export async function fetchEcosystemFacebookPages(): Promise<EcosystemFacebook[]> {
  const { data, error } = await supabase
    .from("ecosystems")
    .select("id, name, facebook_page_url, facebook_page_name")
    .is("archived_at", null)
    .order("name");
  if (error) throw new Error(error.message);
  return (data as EcosystemFacebook[] | null) ?? [];
}

export async function setEcosystemFacebook(
  ecosystemId: string,
  url: string,
  pageName: string,
): Promise<void> {
  const problem = validateFacebookUrl(url);
  if (problem) throw new Error(problem);
  const { error } = await supabase.rpc("set_ecosystem_facebook", {
    _ecosystem_id: ecosystemId,
    _url: url.trim() || undefined,
    _page_name: pageName.trim() || undefined,
  });
  if (error) throw new Error(error.message);
}
