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

/** Public post history for a profile. General-audience published posts only. */
export async function fetchProfilePosts(handle: string, limit = 30): Promise<ProfilePost[]> {
  const { data, error } = await supabase.rpc("universe_profile_posts", {
    _handle: handle,
    _limit: limit,
  });
  if (error) fail(error.message);
  return (data ?? []) as ProfilePost[];
}
