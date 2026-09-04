/**
 * Universe social graph: follows and friendships.
 *
 * Two independent relationships. Following is one-way and needs no consent;
 * friendship is a request the other person must accept. Neither grants any
 * access to private messages, wallets, shop balances or shop history — those
 * stay behind their own database policies.
 */
import { supabase } from "@/integrations/supabase/client";

export type FriendStatus = "none" | "requested" | "incoming" | "friends";

export interface Relationship {
  following: boolean;
  follows_me: boolean;
  follower_count: number;
  friend_status: FriendStatus;
  friend_request_id: string | null;
  friend_count: number;
}

export const EMPTY_RELATIONSHIP: Relationship = {
  following: false,
  follows_me: false,
  follower_count: 0,
  friend_status: "none",
  friend_request_id: null,
  friend_count: 0,
};

export interface ProfilePost {
  id: string;
  body: string;
  image_path: string | null;
  created_at: string;
  like_count: number;
  comment_count: number;
  audience: string;
}

export interface GraphEntry {
  kind: "friend" | "following" | "follower";
  relation_id: string;
  user_id: string;
  full_name: string;
  handle: string | null;
  avatar_path: string | null;
  status: "friends" | "requested" | "incoming" | "following" | "follower";
  created_at: string;
}

function fail(message: string): never {
  throw new Error(message);
}

/** Button wording for the friend control, derived from the relationship state. */
export function friendActionLabel(status: FriendStatus): string {
  switch (status) {
    case "friends":
      return "Friends";
    case "requested":
      return "Request sent";
    case "incoming":
      return "Accept request";
    default:
      return "Add friend";
  }
}

export function followActionLabel(following: boolean): string {
  return following ? "Following" : "Follow";
}

/** A pending request the other person sent is accepted, never duplicated. */
export function friendActionKind(status: FriendStatus): "send" | "accept" | "remove" | "none" {
  if (status === "none") return "send";
  if (status === "incoming") return "accept";
  if (status === "friends") return "remove";
  return "none";
}

export async function fetchRelationship(userId: string): Promise<Relationship> {
  const { data, error } = await supabase.rpc("universe_relationship", { _user: userId });
  if (error) fail(error.message);
  return { ...EMPTY_RELATIONSHIP, ...((data as Partial<Relationship> | null) ?? {}) };
}

export async function setFollowing(userId: string, follow: boolean) {
  const { error } = await supabase.rpc("follow_member", { _user: userId, _follow: follow });
  if (error) fail(error.message);
}

/** Loads the viewer's follow state for every visible post author in one query. */
export async function fetchFollowingIds(userIds: string[]): Promise<Set<string>> {
  const uniqueIds = [...new Set(userIds.filter(Boolean))];
  if (uniqueIds.length === 0) return new Set();
  const { data, error } = await supabase
    .from("social_follows")
    .select("followee_id")
    .in("followee_id", uniqueIds);
  if (error) fail(error.message);
  return new Set((data ?? []).map((row) => row.followee_id));
}

export async function sendFriendRequest(userId: string) {
  const { error } = await supabase.rpc("send_friend_request", { _user: userId });
  if (error) fail(error.message);
}

export async function respondFriendRequest(requestId: string, accept: boolean) {
  const { error } = await supabase.rpc("respond_friend_request", {
    _id: requestId,
    _accept: accept,
  });
  if (error) fail(error.message);
}

export async function removeFriend(userId: string) {
  const { error } = await supabase.rpc("remove_friend", { _user: userId });
  if (error) fail(error.message);
}

export async function fetchSocialGraph(): Promise<GraphEntry[]> {
  const { data, error } = await supabase.rpc("my_social_graph");
  if (error) fail(error.message);
  return (data ?? []) as GraphEntry[];
}

/** Follow + friend state for one member, as returned by the batch lookup. */
export interface RelationshipLite {
  following: boolean;
  friend_status: FriendStatus;
  friend_request_id: string | null;
}

/**
 * One round trip for a whole search result page: the same rules as
 * `universe_relationship`, so a "Add friend" button here and on the profile
 * page can never disagree.
 */
export async function fetchRelationshipBatch(
  userIds: string[],
): Promise<Map<string, RelationshipLite>> {
  const ids = [...new Set(userIds.filter(Boolean))];
  const out = new Map<string, RelationshipLite>();
  if (ids.length === 0) return out;
  const { data, error } = await supabase.rpc("universe_relationship_batch", { _users: ids });
  if (error) fail(error.message);
  for (const row of (data ?? []) as Array<{
    user_id: string;
    following: boolean;
    friend_status: string;
    friend_request_id: string | null;
  }>) {
    out.set(row.user_id, {
      following: !!row.following,
      friend_status: (row.friend_status as FriendStatus) ?? "none",
      friend_request_id: row.friend_request_id ?? null,
    });
  }
  return out;
}

/** A Universe member with presence, from the app-wide heartbeat (member_presence). */
export interface OnlineMember {
  id: string;
  full_name: string;
  handle: string | null;
  avatar_path: string | null;
  /** Server-decided: seen within presence_online_window(). */
  online: boolean;
  /** Minute-rounded, never exact. */
  lastSeenAt: string | null;
}

/**
 * Members active in the last 7 days, online first then most recent. Blocked
 * members (either direction) and deleted accounts never appear. Presence is
 * never fabricated: a member with no heartbeat is simply absent.
 */
export async function fetchOnlineMembers(limit = 40): Promise<OnlineMember[]> {
  const { data, error } = await supabase.rpc("universe_online_members", { _limit: limit });
  if (error) fail(error.message);
  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    id: String(r["id"]),
    full_name: String(r["full_name"] ?? "Member"),
    handle: (r["handle"] as string | null) ?? null,
    avatar_path: (r["avatar_path"] as string | null) ?? null,
    online: !!r["online"],
    lastSeenAt: (r["last_seen_at"] as string | null) ?? null,
  }));
}

/** Public post history for a profile. Every Universe post is public, so all active posts. */
export async function fetchProfilePosts(handle: string, limit = 30): Promise<ProfilePost[]> {
  const { data, error } = await supabase.rpc("universe_profile_posts", {
    _handle: handle,
    _limit: limit,
  });
  if (error) fail(error.message);
  return (data ?? []) as ProfilePost[];
}
