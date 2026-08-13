/**
 * Optional social accounts on a member profile.
 *
 * Nothing here is required of a member. Every link is owned by the member who
 * created it: the database only ever lets the owner add, edit or remove their
 * own rows, and other members of the same shop can read a link only when the
 * owner marked it public. Links are never attached to recipient/credit search
 * results — that lookup deliberately returns identity fields only.
 */
import { supabase } from "@/integrations/supabase/client";

export type SocialPlatform =
  | "facebook"
  | "instagram"
  | "tiktok"
  | "x"
  | "youtube"
  | "website"
  | "custom";

export interface SocialLink {
  id: string;
  platform: SocialPlatform;
  url: string;
  label: string;
  is_public: boolean;
  sort_order: number;
}

/** A link as shown to someone else — no visibility flag leaves the owner's view. */
export type PublicSocialLink = Pick<SocialLink, "id" | "platform" | "url" | "label" | "sort_order">;

export const PLATFORMS: {
  value: SocialPlatform;
  label: string;
  hosts: string[];
  placeholder: string;
}[] = [
  {
    value: "facebook",
    label: "Facebook",
    hosts: ["facebook.com", "fb.com", "m.facebook.com"],
    placeholder: "https://facebook.com/yourpage",
  },
  {
    value: "instagram",
    label: "Instagram",
    hosts: ["instagram.com"],
    placeholder: "https://instagram.com/yourname",
  },
  {
    value: "tiktok",
    label: "TikTok",
    hosts: ["tiktok.com"],
    placeholder: "https://tiktok.com/@yourname",
  },
  { value: "x", label: "X (Twitter)", hosts: ["x.com", "twitter.com"], placeholder: "https://x.com/yourname" },
  {
    value: "youtube",
    label: "YouTube",
    hosts: ["youtube.com", "youtu.be"],
    placeholder: "https://youtube.com/@yourchannel",
  },
  { value: "website", label: "Website", hosts: [], placeholder: "https://yoursite.com" },
  { value: "custom", label: "Other link", hosts: [], placeholder: "https://example.com/you" },
];

export const MAX_LINKS = 8;
export const LABEL_MAX = 40;

export function platformLabel(platform: SocialPlatform): string {
  return PLATFORMS.find((p) => p.value === platform)?.label ?? "Link";
}

/**
 * Normalizes what a member typed into an https URL, or returns null when it is
 * not a usable web address. Anything that is not http(s) — `javascript:`,
 * `data:`, mailto and friends — is rejected outright.
 */
export function normalizeUrl(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  parsed.protocol = "https:";
  parsed.hash = "";
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(parsed.hostname)) return null;
  const url = parsed.toString().replace(/\/$/, "");
  return url.length > 300 ? null : url;
}

/** Returns an error message, or null when the link is acceptable. */
export function validateLink(platform: SocialPlatform, input: string): string | null {
  const url = normalizeUrl(input);
  if (!url) return "Enter a full web address, for example https://example.com/you";
  const spec = PLATFORMS.find((p) => p.value === platform);
  if (spec && spec.hosts.length > 0) {
    const host = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
    const ok = spec.hosts.some((h) => host === h || host.endsWith(`.${h}`));
    if (!ok) return `That does not look like a ${spec.label} address`;
  }
  return null;
}

export function validateLabel(label: string): string | null {
  return label.trim().length > LABEL_MAX ? `Keep the label under ${LABEL_MAX} characters` : null;
}

/** Short, readable form of a URL for the link chip. */
export function prettyUrl(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/\/$/, "");
    return `${u.hostname.replace(/^www\./, "")}${path}`;
  } catch {
    return url;
  }
}

/** Props that make an outbound link safe to open from our app. */
export const EXTERNAL_LINK_PROPS = {
  target: "_blank",
  rel: "noopener noreferrer nofollow ugc",
} as const;

// ------------------------------------------------------------------ data access

export async function fetchMyLinks(userId: string): Promise<SocialLink[]> {
  const { data, error } = await supabase
    .from("member_social_links")
    .select("id, platform, url, label, is_public, sort_order")
    .eq("user_id", userId)
    .order("sort_order")
    .order("created_at");
  if (error) throw new Error(error.message);
  return (data ?? []) as SocialLink[];
}

/** Only links the member chose to make public (their own always visible to them). */
export async function fetchPublicLinks(userId: string): Promise<PublicSocialLink[]> {
  const { data, error } = await supabase.rpc("public_social_links", { _user_id: userId });
  if (error) throw new Error(error.message);
  return (data ?? []) as PublicSocialLink[];
}

export async function addLink(input: {
  ecosystemId: string;
  userId: string;
  platform: SocialPlatform;
  url: string;
  label?: string;
  isPublic: boolean;
  sortOrder: number;
}): Promise<void> {
  const problem = validateLink(input.platform, input.url);
  if (problem) throw new Error(problem);
  const { error } = await supabase.from("member_social_links").insert({
    ecosystem_id: input.ecosystemId,
    user_id: input.userId,
    platform: input.platform,
    url: normalizeUrl(input.url)!,
    label: (input.label ?? "").trim(),
    is_public: input.isPublic,
    sort_order: input.sortOrder,
  });
  if (error) throw new Error(friendly(error.message));
}

export async function updateLink(
  id: string,
  patch: { platform?: SocialPlatform; url?: string; label?: string; isPublic?: boolean },
): Promise<void> {
  if (patch.url !== undefined) {
    const problem = validateLink(patch.platform ?? "custom", patch.url);
    if (problem) throw new Error(problem);
  }
  const next = {
    ...(patch.platform ? { platform: patch.platform } : {}),
    ...(patch.url !== undefined ? { url: normalizeUrl(patch.url)! } : {}),
    ...(patch.label !== undefined ? { label: patch.label.trim() } : {}),
    ...(patch.isPublic !== undefined ? { is_public: patch.isPublic } : {}),
  };
  const { error } = await supabase.from("member_social_links").update(next).eq("id", id);
  if (error) throw new Error(friendly(error.message));
}

export async function removeLink(id: string): Promise<void> {
  const { error } = await supabase.from("member_social_links").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

function friendly(message: string): string {
  if (message.includes("member_social_links_unique_url")) return "You already added that link";
  if (message.includes("member_social_links_url_check")) return "That web address is not valid";
  return message;
}
