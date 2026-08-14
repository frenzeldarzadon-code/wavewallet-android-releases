/**
 * Public storefront — what a visitor who is not a member may see.
 *
 * Every read here goes through a database function that only ever exposes the
 * shop's public catalogue, public ratings and public contact details. Wallets,
 * orders, member lists, inventory codes and transaction history are never part
 * of these payloads, and browsing one shop can never reach another shop's data.
 */
import { supabase } from "@/integrations/supabase/client";

export interface PublicShop {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  facebook_page_url: string | null;
  admin_name: string | null;
  member_count: number;
  product_count: number;
  sales_count: number;
  rating_avg: number;
  rating_count: number;
  voucher_enabled: boolean;
  retail_enabled: boolean;
  storefront_public: boolean;
  has_admin: boolean;
  is_member: boolean;
  pending_application: boolean;
}

export interface PublicProduct {
  kind: "retail" | "voucher";
  id: string;
  name: string;
  description: string | null;
  image_path: string | null;
  price: number;
  available: number;
  rating_avg: number;
  rating_count: number;
}

export interface PublicReview {
  id: string;
  author_name: string;
  rating: number;
  comment: string | null;
  created_at: string;
}

export interface PublicShopSummary {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  member_count: number;
  rating_avg: number;
  rating_count: number;
  voucher_enabled: boolean;
  retail_enabled: boolean;
}

export async function fetchPublicShop(slug: string): Promise<PublicShop | null> {
  const { data, error } = await supabase.rpc("public_shop_overview", { _slug: slug });
  if (error) throw new Error(error.message);
  const row = (data as PublicShop[] | null)?.[0];
  return row ? { ...row, rating_avg: Number(row.rating_avg) } : null;
}

export async function fetchPublicProducts(slug: string): Promise<PublicProduct[]> {
  const { data, error } = await supabase.rpc("public_shop_products", { _slug: slug });
  if (error) throw new Error(error.message);
  return ((data ?? []) as PublicProduct[]).map((p) => ({
    ...p,
    price: Number(p.price),
    rating_avg: Number(p.rating_avg),
  }));
}

export async function fetchPublicReviews(slug: string): Promise<PublicReview[]> {
  const { data, error } = await supabase.rpc("public_shop_reviews", { _slug: slug });
  if (error) throw new Error(error.message);
  return (data ?? []) as PublicReview[];
}

export async function fetchPublicShops(query?: string): Promise<PublicShopSummary[]> {
  const { data, error } = await supabase.rpc("list_public_shops", {
    ...(query?.trim() ? { _q: query.trim() } : {}),
  });
  if (error) throw new Error(error.message);
  return ((data ?? []) as PublicShopSummary[]).map((s) => ({
    ...s,
    rating_avg: Number(s.rating_avg),
  }));
}

/** Only members and real customers of the shop can leave a review. */
export async function rateShop(
  ecosystemId: string,
  rating: number,
  comment?: string,
): Promise<void> {
  const { error } = await supabase.rpc("rate_shop", {
    _ecosystem_id: ecosystemId,
    _rating: rating,
    ...(comment?.trim() ? { _comment: comment.trim() } : {}),
  });
  if (error) throw new Error(error.message);
}

/** What a visitor may do next on a storefront they are looking at. */
export function visitorAction(
  shop: Pick<PublicShop, "is_member" | "pending_application" | "has_admin">,
  signedIn: boolean,
): "open" | "pending" | "join" | "sign-in" | "unavailable" {
  if (shop.is_member) return "open";
  if (!shop.has_admin) return "unavailable";
  if (!signedIn) return "sign-in";
  if (shop.pending_application) return "pending";
  return "join";
}
