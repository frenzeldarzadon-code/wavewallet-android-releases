/**
 * Community layer: shop-scoped social feed, social credits and private messages.
 *
 * Every write goes through a database function that re-checks who the caller is,
 * which shop they belong to and how much they may spend, so nothing here is an
 * authorization boundary. Social credits are their own immutable ledger and are
 * never convertible back into wallet credits or points.
 */
import { supabase } from "@/integrations/supabase/client";
import {
  MAX_UPLOAD_BYTES,
  loadImage,
  optimizeImage,
  optimizedName,
  validateImageFile,
  type CropRect,
  type ImageTarget,
} from "@/lib/image-optimize";

export const SOCIAL_IMAGE_BUCKET = "social-images";
export const MAX_SOCIAL_IMAGE_BYTES = MAX_UPLOAD_BYTES;

/** Uniform 4:3 post image — small enough for mobile data, big enough to read. */
export const SOCIAL_IMAGE_TARGET: ImageTarget = {
  width: 1000,
  height: 750,
  quality: 0.8,
  maxBytes: 320 * 1024,
};

export const SOCIAL_IMAGE_ASPECT = SOCIAL_IMAGE_TARGET.width / SOCIAL_IMAGE_TARGET.height;

export type SocialCurrency = "social" | "points";

/** A configurable paid-promotion level. Prices are snapshotted onto the post. */
export interface PromotionTier {
  id: string;
  name: string;
  description: string;
  price_social: number;
  price_points: number;
  currency: "social" | "points" | "both";
  duration_hours: number;
  priority: number;
  eligibility: "all" | "reseller";
  active: boolean;
  sort_order: number;
  is_default: boolean;
}

export interface SocialState {
  balance: number;
  ecosystem_id: string;
  social_enabled: boolean;
  daily_allowance: number;
  post_cost: number;
  comment_cost: number;
  credit_exchange_rate: number;
  points_exchange_rate: number;
  promotion_enabled: boolean;
  promotion_currency: "social" | "points";
  promotion_cost_social: number;
  promotion_cost_points: number;
  ads_enabled: boolean;
  ad_provider: string;
  ad_reward_amount: number;
  ad_daily_limit: number;
  ads_claimed_today: number;
  image_max_px: number;
  image_max_kb: number;
  promotion_tiers: PromotionTier[];
}


export interface FeedPost {
  id: string;
  author_id: string;
  author_name: string;
  author_handle: string | null;
  author_avatar: string | null;
  body: string;
  image_path: string | null;
  promoted: boolean;
  promotion_tier_name: string | null;
  promotion_expires_at: string | null;

  like_count: number;
  comment_count: number;
  liked_by_me: boolean;
  created_at: string;
  can_delete: boolean;
}

export interface FeedComment {
  id: string;
  author_id: string;
  author_name: string;
  author_handle: string | null;
  author_avatar: string | null;
  body: string;
  created_at: string;
  can_delete: boolean;
}

export interface DmThread {
  thread_id: string;
  member_id: string;
  member_name: string;
  member_handle: string | null;
  member_avatar: string | null;
  last_message_at: string | null;
  preview: string | null;
  unread: number;
  blocked: boolean;
}

export interface DmMessage {
  id: string;
  sender_id: string;
  body: string;
  image_path: string | null;
  created_at: string;
  mine: boolean;
}


export interface SocialActivityRow {
  created_at: string;
  user_id: string;
  user_name: string;
  direction: "credit" | "debit";
  amount: number;
  source: string;
  reason: string;
  balance_after: number;
}

export interface SocialReportRow {
  id: string;
  created_at: string;
  target_type: string;
  target_id: string;
  reason: string;
  status: string;
  reporter_name: string;
  target_name: string;
  content: string | null;
}

export const POST_MAX_CHARS = 2000;
export const COMMENT_MAX_CHARS = 1000;
export const MESSAGE_MAX_CHARS = 2000;

const fail = (message: string): never => {
  throw new Error(message);
};

// ---------------------------------------------------------------- pure logic

/** Cost and currency of the next post, given the caller's promote choice. */
export function postCharge(
  state: Pick<
    SocialState,
    "post_cost" | "promotion_currency" | "promotion_cost_social" | "promotion_cost_points"
  >,
  promote: boolean,
  tier?: PromotionTier | null,
  currency?: SocialCurrency,
): { amount: number; currency: SocialCurrency } {
  if (!promote) return { amount: state.post_cost, currency: "social" };
  if (tier) {
    const cur: SocialCurrency =
      tier.currency === "both" ? (currency ?? "social") : (tier.currency as SocialCurrency);
    return {
      amount: cur === "points" ? tier.price_points : tier.price_social,
      currency: cur,
    };
  }
  return state.promotion_currency === "points"
    ? { amount: state.promotion_cost_points, currency: "points" }
    : { amount: state.promotion_cost_social, currency: "social" };
}

/** Tiers the member may actually buy right now. */
export function availableTiers(state: Pick<SocialState, "promotion_tiers">): PromotionTier[] {
  return (state.promotion_tiers ?? []).filter((t) => t.active);
}

/** Human duration of a promotion tier, for the pre-purchase disclosure. */
export function tierDuration(hours: number): string {
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"}`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"}`;
}

/** True only when a real rewarded-ad provider is configured and enabled. */
export function adsAvailable(
  state: Pick<SocialState, "ads_enabled" | "ad_provider" | "ad_daily_limit" | "ads_claimed_today">,
): boolean {
  return (
    state.ads_enabled &&
    state.ad_provider.trim().length > 0 &&
    state.ads_claimed_today < state.ad_daily_limit
  );
}


/** Replies to a promoted post are free — this is disclosed before publishing. */
export function commentCharge(
  state: Pick<SocialState, "comment_cost">,
  postIsPromoted: boolean,
): number {
  return postIsPromoted ? 0 : state.comment_cost;
}

export function currencyLabel(currency: "social" | "points"): string {
  return currency === "points" ? "points" : "social credits";
}

/** Human confirmation line shown before anything is deducted. */
export function chargeSummary(amount: number, currency: "social" | "points"): string {
  if (amount <= 0) return "This is free — nothing will be deducted.";
  return `This will deduct ${amount} ${amount === 1 ? currencyLabel(currency).replace(/s$/, "") : currencyLabel(currency)}.`;
}

export function canAfford(
  state: Pick<SocialState, "balance">,
  charge: { amount: number; currency: "social" | "points" },
  pointsBalance: number,
): boolean {
  if (charge.amount <= 0) return true;
  return charge.currency === "points"
    ? pointsBalance >= charge.amount
    : state.balance >= charge.amount;
}

export function exchangeGain(
  state: Pick<SocialState, "credit_exchange_rate" | "points_exchange_rate">,
  kind: "credit" | "points",
  amount: number,
): number {
  const rate = kind === "credit" ? state.credit_exchange_rate : state.points_exchange_rate;
  return Math.max(0, Math.trunc(amount)) * rate;
}

export function validatePostBody(body: string): string | null {
  const b = body.trim();
  if (!b) return "Write something first";
  if (b.length > POST_MAX_CHARS) return `Posts can be at most ${POST_MAX_CHARS} characters`;
  return null;
}

export function validateCommentBody(body: string): string | null {
  const b = body.trim();
  if (!b) return "Write a reply first";
  if (b.length > COMMENT_MAX_CHARS) return `Replies can be at most ${COMMENT_MAX_CHARS} characters`;
  return null;
}

export function validateMessageBody(body: string): string | null {
  const b = body.trim();
  if (!b) return "Write a message first";
  if (b.length > MESSAGE_MAX_CHARS) return "That message is too long";
  return null;
}

const SOURCE_LABELS: Record<string, string> = {
  daily_allowance: "Daily allowance",
  credit_exchange: "Credit exchange",
  points_exchange: "Points exchange",
  ad_reward: "Rewarded ad",
  admin_grant: "Admin grant",
  post: "Post",
  comment: "Reply",
  promotion: "Promotion",
};

export function sourceLabel(source: string): string {
  return SOURCE_LABELS[source] ?? source;
}

/** Compact relative time used across the feed and message list. */
export function relativeTime(iso: string, now: Date = new Date()): string {
  const diff = Math.max(0, now.getTime() - new Date(iso).getTime());
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(iso).toLocaleDateString();
}

// ------------------------------------------------------------------- reads

export async function fetchSocialState(): Promise<SocialState> {
  const { data, error } = await supabase.rpc("social_state");
  if (error) fail(error.message);
  return data as unknown as SocialState;
}

export async function fetchFeed(before?: string): Promise<FeedPost[]> {
  const { data, error } = await supabase.rpc("social_feed", {
    _limit: 30,
    ...(before ? { _before: before } : {}),
  });
  if (error) fail(error.message);
  return (data ?? []) as FeedPost[];
}

export async function fetchComments(postId: string): Promise<FeedComment[]> {
  const { data, error } = await supabase.rpc("social_post_comments", { _post_id: postId });
  if (error) fail(error.message);
  return (data ?? []) as FeedComment[];
}

// ------------------------------------------------------------------ writes

export async function createPost(input: {
  body: string;
  imagePath?: string | null;
  promote: boolean;
  tierId?: string | null;
  currency?: SocialCurrency;
}): Promise<{
  post_id: string;
  charged: number;
  currency: string;
  tier: string | null;
  expires_at: string | null;
  balance: number;
}> {
  const { data, error } = await supabase.rpc("social_create_post", {
    _body: input.body.trim(),
    ...(input.imagePath ? { _image_path: input.imagePath } : {}),
    _promote: input.promote,
    ...(input.tierId ? { _tier_id: input.tierId } : {}),
    ...(input.currency ? { _currency: input.currency } : {}),
  });
  if (error) fail(error.message);
  return data as unknown as {
    post_id: string;
    charged: number;
    currency: string;
    tier: string | null;
    expires_at: string | null;
    balance: number;
  };
}

export async function createComment(postId: string, body: string) {
  const { data, error } = await supabase.rpc("social_create_comment", {
    _post_id: postId,
    _body: body.trim(),
  });
  if (error) fail(error.message);
  return data as unknown as { comment_id: string; charged: number; balance: number };
}

export async function toggleLike(postId: string) {
  const { data, error } = await supabase.rpc("social_toggle_like", { _post_id: postId });
  if (error) fail(error.message);
  return data as unknown as { liked: boolean; likes: number };
}

export async function deletePost(postId: string, reason?: string) {
  const { error } = await supabase.rpc("social_delete_post", {
    _post_id: postId,
    ...(reason ? { _reason: reason } : {}),
  });
  if (error) fail(error.message);
}

export async function deleteComment(commentId: string, reason?: string) {
  const { error } = await supabase.rpc("social_delete_comment", {
    _comment_id: commentId,
    ...(reason ? { _reason: reason } : {}),
  });
  if (error) fail(error.message);
}

export async function reportContent(
  targetType: "post" | "comment" | "message" | "member",
  targetId: string,
  reason: string,
) {
  const { error } = await supabase.rpc("social_report", {
    _target_type: targetType,
    _target_id: targetId,
    _reason: reason.trim(),
  });
  if (error) fail(error.message);
}

export async function setBlocked(memberId: string, blocked: boolean) {
  const { error } = await supabase.rpc("social_set_block", {
    _member_id: memberId,
    _blocked: blocked,
  });
  if (error) fail(error.message);
}

export async function exchangeForSocialCredits(kind: "credit" | "points", amount: number) {
  const { data, error } = await supabase.rpc("social_exchange", { _kind: kind, _amount: amount });
  if (error) fail(error.message);
  return data as unknown as { granted: number; balance: number; tx_id: string };
}

/** Only ever succeeds for an ad event a trusted server already marked verified. */
export async function claimAdReward(provider: string, eventId: string) {
  const { data, error } = await supabase.rpc("social_claim_ad_reward", {
    _provider: provider,
    _provider_event_id: eventId,
  });
  if (error) fail(error.message);
  return data as unknown as { granted: number; balance: number };
}

// -------------------------------------------------------------- messages

export async function fetchThreads(): Promise<DmThread[]> {
  const { data, error } = await supabase.rpc("dm_thread_list");
  if (error) fail(error.message);
  return (data ?? []) as DmThread[];
}

export async function fetchMessages(threadId: string): Promise<DmMessage[]> {
  const { data, error } = await supabase.rpc("dm_messages_for", { _thread_id: threadId });
  if (error) fail(error.message);
  return (data ?? []) as DmMessage[];
}

export async function sendMessage(memberId: string, body: string, imagePath?: string | null) {
  const { data, error } = await supabase.rpc("dm_send", {
    _member_id: memberId,
    _body: body.trim(),
    ...(imagePath ? { _image_path: imagePath } : {}),
  });
  if (error) fail(error.message);
  return data as unknown as { thread_id: string; message_id: string };
}

export async function openThread(memberId: string): Promise<string> {
  const { data, error } = await supabase.rpc("dm_open_thread", { _member_id: memberId });
  if (error) fail(error.message);
  return data as unknown as string;
}

export async function unreadCount(): Promise<number> {
  const { data, error } = await supabase.rpc("dm_unread_count");
  if (error) return 0;
  return Number(data ?? 0);
}

// --------------------------------------------------------------- moderation

export async function fetchSocialActivity(ecosystemId?: string | null) {
  const { data, error } = await supabase.rpc("social_admin_activity", {
    ...(ecosystemId ? { _ecosystem_id: ecosystemId } : {}),
    _limit: 200,
  });
  if (error) fail(error.message);
  return (data ?? []) as SocialActivityRow[];
}

export async function fetchSocialReports(ecosystemId?: string | null) {
  const { data, error } = await supabase.rpc("social_admin_reports", {
    ...(ecosystemId ? { _ecosystem_id: ecosystemId } : {}),
  });
  if (error) fail(error.message);
  return (data ?? []) as SocialReportRow[];
}

export async function reviewReport(reportId: string, status: "actioned" | "dismissed") {
  const { error } = await supabase.rpc("social_review_report", {
    _report_id: reportId,
    _status: status,
  });
  if (error) fail(error.message);
}

// ------------------------------------------------------------------ images

export function validateSocialImage(file: File): string | null {
  return validateImageFile(file);
}

/**
 * Crops, resizes and compresses in the browser, then stores the optimised bytes
 * at `{ecosystem}/{user}/{uuid}.webp`. Originals never reach storage.
 */
export async function uploadSocialImage(input: {
  ecosystemId: string;
  userId: string;
  file: File;
  crop?: CropRect;
  preloaded?: HTMLImageElement;
}): Promise<string> {
  const problem = validateSocialImage(input.file);
  if (problem) throw new Error(problem);
  const source = input.preloaded ?? (await loadImage(input.file));
  const { blob, mime } = await optimizeImage(source, SOCIAL_IMAGE_TARGET, input.crop);
  const path = `${input.ecosystemId}/${input.userId}/${optimizedName(crypto.randomUUID(), mime)}`;
  const { error } = await supabase.storage
    .from(SOCIAL_IMAGE_BUCKET)
    .upload(path, blob, { contentType: mime, upsert: false });
  if (error) throw new Error(error.message);
  return path;
}

export async function deleteSocialImage(path?: string | null): Promise<void> {
  if (!path) return;
  await supabase.storage.from(SOCIAL_IMAGE_BUCKET).remove([path]);
}

const urlCache = new Map<string, { url: string; expires: number }>();

export async function socialImageUrl(path?: string | null): Promise<string | null> {
  if (!path) return null;
  const hit = urlCache.get(path);
  if (hit && hit.expires > Date.now()) return hit.url;
  const { data, error } = await supabase.storage
    .from(SOCIAL_IMAGE_BUCKET)
    .createSignedUrl(path, 3600);
  if (error || !data?.signedUrl) return null;
  urlCache.set(path, { url: data.signedUrl, expires: Date.now() + 55 * 60 * 1000 });
  return data.signedUrl;
}

// -------------------------------------------------- community configuration

export interface EcosystemSocialSettings {
  social_enabled: boolean;
  daily_allowance: number | null;
  post_cost: number | null;
  comment_cost: number | null;
  credit_exchange_rate: number | null;
  points_exchange_rate: number | null;
  promotion_enabled: boolean | null;
}

/** Effective (platform default + shop override) settings for a shop. */
export async function fetchEcosystemSocialOverride(
  ecosystemId: string,
): Promise<EcosystemSocialSettings | null> {
  const { data, error } = await supabase
    .from("ecosystem_social_settings")
    .select(
      "social_enabled, daily_allowance, post_cost, comment_cost, credit_exchange_rate, points_exchange_rate, promotion_enabled",
    )
    .eq("ecosystem_id", ecosystemId)
    .maybeSingle();
  if (error) fail(error.message);
  return (data as EcosystemSocialSettings | null) ?? null;
}

export async function saveEcosystemSocialSettings(
  input: EcosystemSocialSettings & { ecosystemId?: string },
) {
  const { error } = await supabase.rpc("update_ecosystem_social_settings", {
    _social_enabled: input.social_enabled,
    _daily_allowance: input.daily_allowance,
    _post_cost: input.post_cost,
    _comment_cost: input.comment_cost,
    _credit_exchange_rate: input.credit_exchange_rate,
    _points_exchange_rate: input.points_exchange_rate,
    _promotion_enabled: input.promotion_enabled,
    ...(input.ecosystemId ? { _ecosystem_id: input.ecosystemId } : {}),
  });
  if (error) fail(error.message);
}

export async function fetchPromotionTiers(ecosystemId: string | null): Promise<PromotionTier[]> {
  if (!ecosystemId) {
    const { data, error } = await supabase
      .from("social_promotion_tiers")
      .select("*")
      .is("ecosystem_id", null)
      .order("sort_order");
    if (error) fail(error.message);
    return ((data ?? []) as unknown as PromotionTier[]).map((t) => ({ ...t, is_default: true }));
  }
  const { data, error } = await supabase.rpc("social_tiers_for", { _eco: ecosystemId });
  if (error) fail(error.message);
  return (data ?? []) as unknown as PromotionTier[];
}

export async function savePromotionTier(
  tier: Omit<PromotionTier, "id" | "is_default"> & { id?: string | null; ecosystemId?: string | null },
): Promise<string> {
  const { data, error } = await supabase.rpc("upsert_social_promotion_tier", {
    _name: tier.name.trim(),
    _description: tier.description ?? "",
    _price_social: tier.price_social,
    _price_points: tier.price_points,
    _currency: tier.currency,
    _duration_hours: tier.duration_hours,
    _priority: tier.priority,
    _eligibility: tier.eligibility,
    _active: tier.active,
    _sort_order: tier.sort_order,
    ...(tier.id ? { _tier_id: tier.id } : {}),
    ...(tier.ecosystemId ? { _ecosystem_id: tier.ecosystemId } : {}),
  });
  if (error) fail(error.message);
  return data as unknown as string;
}

export async function disablePromotionTier(tierId: string) {
  const { error } = await supabase.rpc("delete_social_promotion_tier", { _tier_id: tierId });
  if (error) fail(error.message);
}

/** Explicit, authorised refund of a promotion charge. Never automatic. */
export async function refundPromotion(postId: string, reason: string) {
  const { data, error } = await supabase.rpc("social_refund_promotion", {
    _post_id: postId,
    _reason: reason.trim(),
  });
  if (error) fail(error.message);
  return data as unknown as { refunded: number; currency: string; tx_id: string };
}
