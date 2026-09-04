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
import {
  postLinkKey,
  validateVideoFile,
  videoExtension,
  type PostLink,
  type PostMeta,
} from "@/lib/post-meta";

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
  /** Everything the member could spend on a post. Never shown as one number. */
  balance: number;
  /**
   * Legacy promotional credits from the retired daily-allowance model. Still
   * spendable on posts, but they can never be gifted or transferred.
   */
  free_balance: number;
  /** Purchased credits. The only balance that may be gifted. */
  purchased_balance: number;
  /** The member's current shop, or null — Universe members need no shop to post. */
  ecosystem_id: string | null;
  social_enabled: boolean;
  /** Retired: the daily free-credit allowance. Always 0. */
  daily_allowance: number;
  /** Free ORDINARY POSTS per day (not credits). Platform-owner setting. */
  free_posts_per_day: number;
  free_posts_used_today: number;
  free_posts_left: number;
  post_cost: number;
  /** Always 0 — replies and comments are free. Kept for historical settings rows. */
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

/**
 * Every Universe post is public to the whole Universe. The column is kept for
 * compatibility and is always "general".
 */
export type PostAudience = "general";

export interface FeedPost {
  id: string;
  author_id: string;
  author_name: string;
  author_handle: string | null;
  author_avatar: string | null;
  body: string;
  image_path: string | null;
  /** Optional attached video in the same private bucket as photos. */
  video_path?: string | null;
  /** Structured extras: location, feeling/activity, text style, DM invite. */
  meta?: PostMeta | null;
  hashtags?: string[] | null;
  promoted: boolean;
  promotion_tier_name: string | null;
  promotion_expires_at: string | null;

  like_count: number;
  comment_count: number;
  liked_by_me: boolean;
  created_at: string;
  /** Global delete — author or platform owner only. */
  can_delete: boolean;
  audience: PostAudience;
  origin_ecosystem_name: string | null;
  author_role: string | null;
  /** Shop admin may hide this post from their own shop's members. */
  can_hide?: boolean;
}

/** A post a shop admin hid from their own members. Still public elsewhere. */
export interface HiddenPostRow {
  post_id: string;
  ecosystem_id: string;
  hidden_by_name: string;
  reason: string | null;
  hidden_at: string;
  author_name: string;
  author_handle: string | null;
  author_avatar: string | null;
  body: string;
  image_path: string | null;
  post_created_at: string;
}

/** A member suggested while typing an @mention. */
export interface MentionSuggestion {
  user_id: string;
  full_name: string;
  handle: string;
  avatar_path: string | null;
}

/** Public Universe profile — identity only, never wallets or messages. */
export interface UniverseProfile {
  /** Null for the masked platform identity — there is no personal account to link to. */
  user_id: string | null;
  full_name: string;
  handle: string | null;
  avatar_path: string | null;
  cover_path: string | null;
  bio: string | null;
  joined_at: string;
  /**
   * True when this identity is the platform owner seen by anyone else. The
   * database masks the personal record: name becomes the platform identity and
   * handle/avatar/bio are stripped, so no private detail can be reached
   * through a handle or user id.
   */
  is_platform: boolean;
}

/** One shop's decision about a General post. */
export interface DistributionRow {
  id: string;
  post_id: string;
  status: "pending" | "approved" | "rejected";
  note: string | null;
  created_at: string;
  reviewed_at: string | null;
  reviewed_by_name: string | null;
  ecosystem_id: string;
  origin_ecosystem_name: string;
  author_name: string;
  author_handle: string | null;
  author_avatar: string | null;
  body: string;
  image_path: string | null;
  post_created_at: string;
}

/** Author-facing status: shop + decision only, never the private admin note. */
export interface DistributionStatus {
  ecosystem_name: string;
  status: "pending" | "approved" | "rejected";
  reviewed_at: string | null;
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
  /** Null for a top-level comment. */
  parent_id: string | null;
  /** 1 = comment, 2 = reply, 3 = reply to a reply. Never deeper. */
  depth: number;
}

/** Threaded replies stop at three levels, in the UI and in the database. */
export const MAX_REPLY_DEPTH = 3;

/** A reply box is only offered when the answer would still fit in the thread. */
export function canReplyTo(depth: number): boolean {
  return depth < MAX_REPLY_DEPTH;
}

/**
 * Orders a flat comment list into a thread: every reply follows its parent,
 * oldest first, with the depth the database recorded. Orphans (whose parent was
 * removed) fall back to the top level so no reply ever disappears.
 */
export function threadComments(comments: FeedComment[]): FeedComment[] {
  const byParent = new Map<string, FeedComment[]>();
  const ids = new Set(comments.map((c) => c.id));
  for (const c of comments) {
    const key = c.parent_id && ids.has(c.parent_id) ? c.parent_id : "root";
    const list = byParent.get(key) ?? [];
    list.push(c);
    byParent.set(key, list);
  }
  const out: FeedComment[] = [];
  const walk = (key: string, depth: number) => {
    for (const c of byParent.get(key) ?? []) {
      out.push({ ...c, depth: Math.min(depth, MAX_REPLY_DEPTH) });
      walk(c.id, depth + 1);
    }
  };
  walk("root", 1);
  return out;
}

export interface DmParticipant {
  id: string;
  name: string;
  handle: string | null;
  avatar: string | null;
  role: "customer" | "seller" | "delivery" | "collector";
}

export interface DmThread {
  thread_id: string;
  /** Direct threads only — the other member. Empty for order chats. */
  member_id: string | null;
  member_name: string | null;
  member_handle: string | null;
  member_avatar: string | null;
  last_message_at: string | null;
  preview: string | null;
  unread: number;
  blocked: boolean;
  member_online: boolean;
  /** `direct` = one-to-one; `order` = Retail order-linked group chat (R6). */
  kind: "direct" | "order";
  order_id: string | null;
  title: string | null;
  participants: DmParticipant[];
}

export interface DmMessage {
  id: string;
  sender_id: string;
  body: string;
  image_path: string | null;
  created_at: string;
  mine: boolean;
  sender_name?: string | null;
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

/**
 * Cost of the next post: always nothing.
 *
 * Universe social activity is free. Posting and promoting never consume
 * WaveWallet coins, social credits or points — the database function
 * `social_create_post` enforces the same rule and never writes a debit. The
 * signature is kept so callers can still describe a promotion tier.
 */
export function postCharge(
  _state: Pick<SocialState, "post_cost" | "free_posts_left">,
  _promote: boolean,
  _tier?: PromotionTier | null,
  _currency?: SocialCurrency,
): { amount: number; currency: SocialCurrency; free: boolean } {
  return { amount: 0, currency: "social", free: true };
}

/** Tiers the member may actually buy right now. */
export function availableTiers(input: {
  promotion_tiers: PromotionTier[];
  role?: string | null;
}): PromotionTier[] {
  const privileged =
    input.role === "reseller" ||
    input.role === "subreseller" ||
    input.role === "admin" ||
    input.role === "super_admin";
  return (input.promotion_tiers ?? [])
    .filter((t) => t.active && (t.eligibility !== "reseller" || privileged))
    .sort((a, b) => a.sort_order - b.sort_order);
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

/**
 * Replies and comments never consume social credits, on any post, in any shop.
 * The database enforces the same rule; this exists so the UI can say so.
 */
export function commentCharge(): number {
  return 0;
}

/** Likes and direct messages are free, always. Never make them chargeable. */
export const LIKE_COST = 0;
export const DM_COST = 0;

/** The most a member may gift in one go — matches the database guard. */
export const MAX_GIFT = 1000;

/** Plain-language disclosure shown before the member writes a post. */
export function freePostDisclosure(
  _state?: Partial<Pick<SocialState, "free_posts_left" | "free_posts_per_day" | "post_cost">>,
): string[] {
  return [
    "Posting in the Universe is free.",
    "Promotions, likes, replies and messages are free too — your coins are only ever spent on vouchers and transfers you choose.",
  ];
}

/**
 * Whether a gift may be attempted, and why not when it may not.
 * Only PURCHASED social credits can ever be gifted — a member holding nothing
 * but legacy promotional credits can never gift, whatever their total says.
 */
export function giftIssue(input: {
  purchased_balance: number;
  amount: number;
  isSelf: boolean;
}): string | null {
  if (input.isSelf) return "You cannot gift social credits to yourself";
  if (input.purchased_balance <= 0)
    return "You have no purchased social credits. Free promotional credits cannot be gifted.";
  if (!Number.isFinite(input.amount) || input.amount <= 0)
    return "Enter how many social credits to gift";
  if (!Number.isInteger(input.amount)) return "Gift whole social credits only";
  if (input.amount > MAX_GIFT) return `You can gift at most ${MAX_GIFT} social credits at a time`;
  if (input.amount > input.purchased_balance)
    return `You only have ${input.purchased_balance} purchased social credit${input.purchased_balance === 1 ? "" : "s"} to gift`;
  return null;
}

/** True when the Gift action should be offered at all. */
export function canGift(
  state: Pick<SocialState, "purchased_balance"> | null,
  isSelf: boolean,
): boolean {
  return !isSelf && (state?.purchased_balance ?? 0) > 0;
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

export async function fetchFeed(before?: string, hashtag?: string | null): Promise<FeedPost[]> {
  const { data, error } = await supabase.rpc("social_feed", {
    _limit: 30,
    ...(before ? { _before: before } : {}),
    ...(hashtag ? { _hashtag: hashtag } : {}),
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


export interface CreatePostResult {
  post_id: string;
  charged: number;
  currency: string;
  tier: string | null;
  expires_at: string | null;
  balance: number;
  audience: PostAudience;
  pending_shops: number;
  live_shops: number;
}

/**
 * Publish a post. Every Universe post is public to every Universe member —
 * the database ignores any audience/shop input and always publishes
 * Universe-wide, with no shop membership or approval involved.
 */
export async function createPost(input: {
  body: string;
  imagePath?: string | null;
  videoPath?: string | null;
  meta?: PostMeta | null;
  promote: boolean;
  tierId?: string | null;
  currency?: SocialCurrency;
}): Promise<CreatePostResult> {
  const { data, error } = await supabase.rpc("social_create_post", {
    _body: input.body.trim(),
    ...(input.imagePath ? { _image_path: input.imagePath } : {}),
    ...(input.videoPath ? { _video_path: input.videoPath } : {}),
    ...(input.meta && Object.keys(input.meta).length > 0
      ? { _meta: input.meta as unknown as Record<string, never> }
      : {}),
    _promote: input.promote,
    ...(input.tierId ? { _tier_id: input.tierId } : {}),
    ...(input.currency ? { _currency: input.currency } : {}),
  });
  if (error) fail(error.message);
  return data as unknown as CreatePostResult;
}

/** Queue of General posts awaiting (or already given) a decision in one shop. */
export async function fetchGeneralQueue(
  ecosystemId?: string | null,
  status: "pending" | "approved" | "rejected" | "all" = "pending",
): Promise<DistributionRow[]> {
  const { data, error } = await supabase.rpc("social_general_queue", {
    ...(ecosystemId ? { _eco: ecosystemId } : {}),
    _status: status,
  });
  if (error) fail(error.message);
  return (data ?? []) as DistributionRow[];
}

export async function reviewDistribution(
  id: string,
  status: "approved" | "rejected",
  note?: string,
) {
  const { error } = await supabase.rpc("social_review_distribution", {
    _id: id,
    _status: status,
    ...(note && note.trim() ? { _note: note.trim() } : {}),
  });
  if (error) fail(error.message);
}

export async function fetchDistributionStatus(postId: string): Promise<DistributionStatus[]> {
  const { data, error } = await supabase.rpc("social_post_distribution_status", {
    _post_id: postId,
  });
  if (error) fail(error.message);
  return (data ?? []) as DistributionStatus[];
}

export async function createComment(postId: string, body: string, parentId?: string | null) {
  const { data, error } = await supabase.rpc("social_create_comment", {
    _post_id: postId,
    _body: body.trim(),
    ...(parentId ? { _parent_id: parentId } : {}),
  });
  if (error) fail(error.message);
  return data as unknown as {
    comment_id: string;
    charged: number;
    balance: number;
    depth: number;
  };
}

/**
 * Shop-scoped visibility control. Hides (or restores) a post for the members of
 * one shop only — the post stays public in the Universe and in every other
 * shop. The database checks that the caller really moderates that shop and
 * records who acted, when and why.
 */
export async function hidePostForShop(
  postId: string,
  hidden: boolean,
  reason?: string,
  ecosystemId?: string | null,
) {
  const { error } = await supabase.rpc("social_hide_post_for_shop", {
    _post_id: postId,
    _hidden: hidden,
    ...(reason && reason.trim() ? { _reason: reason.trim() } : {}),
    ...(ecosystemId ? { _eco: ecosystemId } : {}),
  });
  if (error) fail(error.message);
}

export async function fetchHiddenPosts(ecosystemId?: string | null): Promise<HiddenPostRow[]> {
  const { data, error } = await supabase.rpc("social_hidden_posts", {
    ...(ecosystemId ? { _eco: ecosystemId } : {}),
  });
  if (error) fail(error.message);
  return (data ?? []) as HiddenPostRow[];
}

/** Handle/name autocomplete for @mentions. */
export async function searchHandles(query: string): Promise<MentionSuggestion[]> {
  const q = query.trim();
  if (!q) return [];
  const { data, error } = await supabase.rpc("social_handle_search", { _q: q, _limit: 8 });
  if (error) return [];
  return (data ?? []) as MentionSuggestion[];
}

/** Public Universe profile by handle. Returns null when nobody uses it. */
export async function fetchUniverseProfile(handle: string): Promise<UniverseProfile | null> {
  const { data, error } = await supabase.rpc("universe_profile", { _handle: handle });
  if (error) fail(error.message);
  const rows = (data ?? []) as UniverseProfile[];
  return rows[0] ?? null;
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

// `social_exchange` is retired: Universe social activity is free, so coins and
// points are never exchanged for social credits. The database refuses the call.

export interface GiftResult {
  amount: number;
  recipient_name: string;
  /** The sender's remaining PURCHASED balance after the gift. */
  purchased_balance: number;
  balance: number;
  tx_id: string;
}

/**
 * Gift PURCHASED social credits to a post's author.
 * The database refuses to touch promotional balances and rejects self-gifts,
 * over-spends and duplicate concurrent gifts, so a failure here is authoritative.
 */
export async function giftSocialCredits(input: {
  postId: string;
  amount: number;
  note?: string;
}): Promise<GiftResult> {
  const { data, error } = await supabase.rpc("social_gift_credits", {
    _post_id: input.postId,
    _amount: input.amount,
    ...(input.note ? { _note: input.note } : {}),
  });
  if (error) fail(error.message);
  return data as unknown as GiftResult;
}

export interface GiftAuditRow {
  created_at: string;
  post_id: string | null;
  sender_name: string;
  recipient_name: string;
  amount: number;
  sender_balance_after: number;
}

/** Platform-owner audit of paid social-credit gifts and the balances they came from. */
export async function fetchGiftAudit(limit = 100): Promise<GiftAuditRow[]> {
  const { data, error } = await supabase.rpc("social_gift_audit", { _limit: limit });
  if (error) fail(error.message);
  return (data ?? []) as unknown as GiftAuditRow[];
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
  return ((data ?? []) as unknown as Array<Record<string, unknown>>).map((t) => ({
    thread_id: String(t["thread_id"]),
    member_id: (t["member_id"] as string | null) ?? null,
    member_name: (t["member_name"] as string | null) ?? null,
    member_handle: (t["member_handle"] as string | null) ?? null,
    member_avatar: (t["member_avatar"] as string | null) ?? null,
    last_message_at: (t["last_message_at"] as string | null) ?? null,
    preview: (t["preview"] as string | null) ?? null,
    unread: Number(t["unread"] ?? 0),
    blocked: !!t["blocked"],
    member_online: !!t["member_online"],
    kind: t["kind"] === "order" ? "order" : "direct",
    order_id: (t["order_id"] as string | null) ?? null,
    title: (t["title"] as string | null) ?? null,
    participants: Array.isArray(t["participants"]) ? (t["participants"] as DmParticipant[]) : [],
  }));
}

/** Display name of a thread: the other member for DMs, the order title for order chats. */
export const threadTitle = (t: DmThread) =>
  t.kind === "order" ? (t.title ?? "Order chat") : (t.member_name ?? "Member");

/** Order number / status / shop for an order chat the caller belongs to. */
export interface OrderChatContext {
  thread_id: string;
  order_no: string;
  status: string;
  fulfillment_status: string | null;
  shop_name: string | null;
  shop_slug: string | null;
}

/** One round trip for every order chat in the list; the database only answers for active participants. */
export async function fetchOrderChatContext(
  threadIds: string[],
): Promise<Map<string, OrderChatContext>> {
  const out = new Map<string, OrderChatContext>();
  const ids = [...new Set(threadIds.filter(Boolean))];
  if (ids.length === 0) return out;
  const { data, error } = await supabase.rpc("dm_order_chat_context", { _thread_ids: ids });
  if (error) fail(error.message);
  for (const r of (data ?? []) as OrderChatContext[]) out.set(r.thread_id, r);
  return out;
}

/** "Order #123 · Delivering · Sari-Sari ni Aling Nena" — a glanceable label for order chats. */
export function orderChatLabel(t: DmThread, ctx?: OrderChatContext | null): string {
  if (!ctx) return threadTitle(t);
  const state = (ctx.fulfillment_status && ctx.fulfillment_status !== "none"
    ? ctx.fulfillment_status
    : ctx.status
  )
    .replace(/_/g, " ")
    .replace(/^\w/, (c) => c.toUpperCase());
  return [`Order ${ctx.order_no}`, state, ctx.shop_name].filter(Boolean).join(" · ");
}

export type ThreadFilter = "all" | "direct" | "order";

export function filterThreads(threads: DmThread[], filter: ThreadFilter): DmThread[] {
  return filter === "all" ? threads : threads.filter((t) => t.kind === filter);
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

/** Order-linked group chat (R6): only active order participants may post. */
export async function sendThreadMessage(threadId: string, body: string, imagePath?: string | null) {
  const { data, error } = await supabase.rpc("dm_send_thread", {
    _thread_id: threadId,
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
/**
 * Storage folder for a member's community media. Members without a shop store
 * under `universe/<user>/`; shop members keep their shop folder so shop admins
 * can moderate media posted under their shop.
 */
export const UNIVERSE_MEDIA_FOLDER = "universe";
export function socialMediaFolder(ecosystemId: string | null | undefined): string {
  return ecosystemId ?? UNIVERSE_MEDIA_FOLDER;
}

export async function uploadSocialImage(input: {
  ecosystemId: string | null | undefined;
  userId: string;
  file: File;
  crop?: CropRect;
  preloaded?: HTMLImageElement;
}): Promise<string> {
  const problem = validateSocialImage(input.file);
  if (problem) throw new Error(problem);
  const source = input.preloaded ?? (await loadImage(input.file));
  const { blob, mime } = await optimizeImage(source, SOCIAL_IMAGE_TARGET, input.crop);
  const path = `${socialMediaFolder(input.ecosystemId)}/${input.userId}/${optimizedName(crypto.randomUUID(), mime)}`;
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

export function validateSocialVideo(file: File): string | null {
  return validateVideoFile(file);
}

/**
 * Uploads a short video next to the member's photos: same private bucket, same
 * `${shop}/${member}/` folder, so the existing storage policies apply unchanged.
 * Videos are stored as uploaded (no transcoding) and capped at 25 MB.
 */
export async function uploadSocialVideo(input: {
  ecosystemId: string | null | undefined;
  userId: string;
  file: File;
}): Promise<string> {
  const problem = validateSocialVideo(input.file);
  if (problem) throw new Error(problem);
  const path = `${socialMediaFolder(input.ecosystemId)}/${input.userId}/${crypto.randomUUID()}.${videoExtension(input.file.type)}`;
  const { error } = await supabase.storage
    .from(SOCIAL_IMAGE_BUCKET)
    .upload(path, input.file, { contentType: input.file.type, upsert: false });
  if (error) throw new Error(error.message);
  return path;
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
  const opt = <T>(key: string, value: T | null) =>
    value === null || value === undefined ? {} : { [key]: value };
  const { error } = await supabase.rpc("update_ecosystem_social_settings", {
    _social_enabled: input.social_enabled,
    ...opt("_daily_allowance", input.daily_allowance),
    ...opt("_post_cost", input.post_cost),
    ...opt("_comment_cost", input.comment_cost),
    ...opt("_credit_exchange_rate", input.credit_exchange_rate),
    ...opt("_points_exchange_rate", input.points_exchange_rate),
    ...opt("_promotion_enabled", input.promotion_enabled),
    ...opt("_ecosystem_id", input.ecosystemId ?? null),
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
  tier: Omit<PromotionTier, "id" | "is_default"> & {
    id?: string | null;
    ecosystemId?: string | null;
  },
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

// --------------------------------------------------- general-post presentation

/** Operator badge shown on a post, or null for ordinary members. */
export function roleBadge(role: string | null | undefined): string | null {
  switch (role) {
    case "super_admin":
      return "Platform";
    case "admin":
      return "Shop admin";
    case "reseller":
      return "Reseller";
    case "subreseller":
      return "Subreseller";
    default:
      return null;
  }
}

/**
 * Why the member cannot submit yet, or null when the post is ready to publish.
 * Every Universe post is public to the whole Universe, so there is no audience
 * or shop choice to validate.
 */
export function postReadiness(input: {
  body: string;
  promote: boolean;
  tierChosen: boolean;
  affordable: boolean;
}): string | null {
  const bodyProblem = validatePostBody(input.body);
  if (bodyProblem) return bodyProblem;
  if (input.promote && !input.tierChosen) return "Choose a promotion type";
  if (!input.affordable) return "You do not have enough to cover this";
  return null;
}

/** One-line status of a General post for its author, e.g. "Live in 2 shops · 1 pending". */
export function distributionSummary(rows: DistributionStatus[]): string {
  if (rows.length === 0) return "No shops yet";
  const n = (s: DistributionStatus["status"]) => rows.filter((r) => r.status === s).length;
  const parts: string[] = [`Live in ${n("approved")} shop${n("approved") === 1 ? "" : "s"}`];
  if (n("pending") > 0) parts.push(`${n("pending")} pending`);
  if (n("rejected") > 0) parts.push(`${n("rejected")} declined`);
  return parts.join(" · ");
}

// ------------------------------------------------------- link / recommend

/** A shop or product a member may recommend inside a post, or the resolved card of one. */
export interface LinkCard {
  kind: "shop" | "product";
  shop_id: string;
  shop_name: string;
  shop_slug: string;
  /** "retail", "voucher" or "retail+voucher" — what the shop sells in the Universe. */
  shop_type: string;
  logo_path: string | null;
  cover_path: string | null;
  product_id: string | null;
  product_kind: "retail" | "voucher" | null;
  product_name: string | null;
  image_path: string | null;
  /** Current customer price (coins); Retail already includes the platform fee. */
  price: number | null;
  /** Stock / unused vouchers when known (resolver only). */
  available?: number | null;
}

function normalizeLinkCard(row: Record<string, unknown>): LinkCard {
  return {
    kind: row["kind"] === "product" ? "product" : "shop",
    shop_id: String(row["shop_id"]),
    shop_name: String(row["shop_name"] ?? ""),
    shop_slug: String(row["shop_slug"] ?? ""),
    shop_type: String(row["shop_type"] ?? "voucher"),
    logo_path: (row["logo_path"] as string | null) ?? null,
    cover_path: (row["cover_path"] as string | null) ?? null,
    product_id: (row["product_id"] as string | null) ?? null,
    product_kind:
      row["product_kind"] === "retail" || row["product_kind"] === "voucher"
        ? row["product_kind"]
        : null,
    product_name: (row["product_name"] as string | null) ?? null,
    image_path: (row["image_path"] as string | null) ?? null,
    price: row["price"] === null || row["price"] === undefined ? null : Number(row["price"]),
    available:
      row["available"] === null || row["available"] === undefined ? null : Number(row["available"]),
  };
}

/** Picker search — publicly visible Universe shops or their published products. */
export async function searchLinkTargets(
  kind: "shop" | "product",
  query: string,
  limit = 20,
): Promise<LinkCard[]> {
  const { data, error } = await supabase.rpc("universe_link_search", {
    _kind: kind,
    _limit: limit,
    ...(query.trim() ? { _q: query.trim() } : {}),
  });
  if (error) fail(error.message);
  return ((data ?? []) as Record<string, unknown>[]).map(normalizeLinkCard);
}

/** The reference a picked card stores in the post's extras. */
export function linkFromCard(card: LinkCard): PostLink {
  if (card.kind === "product" && card.product_id && card.product_kind) {
    return {
      kind: "product",
      shop_id: card.shop_id,
      product_id: card.product_id,
      product_kind: card.product_kind,
    };
  }
  return { kind: "shop", shop_id: card.shop_id };
}

/**
 * Resolves linked references to current card data. Items that are no longer
 * publicly visible are simply absent, so callers hide the card.
 */
export async function fetchLinkCards(links: PostLink[]): Promise<Map<string, LinkCard>> {
  const out = new Map<string, LinkCard>();
  const unique = new Map<string, PostLink>();
  for (const l of links) unique.set(postLinkKey(l), l);
  if (unique.size === 0) return out;
  const { data, error } = await supabase.rpc("social_link_cards", {
    _links: [...unique.values()] as unknown as Record<string, never>[],
  });
  if (error) fail(error.message);
  for (const raw of (data ?? []) as Record<string, unknown>[]) {
    const card = normalizeLinkCard(raw);
    out.set(postLinkKey(linkFromCard(card)), card);
  }
  return out;
}

/** "Voucher shop" / "Retail shop" / "Retail & voucher shop". */
export function shopTypeLabel(shopType: string): string {
  if (shopType === "retail+voucher") return "Retail & voucher shop";
  if (shopType === "retail") return "Retail shop";
  return "Voucher shop";
}
