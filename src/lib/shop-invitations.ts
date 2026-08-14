/**
 * Shop invitations — inviting an existing Universe member into one shop.
 *
 * An invitation is only an offer: no membership, wallet, role or history is
 * created until the invited person accepts. Authorization (who may invite,
 * who may answer) is re-checked by the database on every call; everything in
 * this module is UI convenience and ranking.
 */
import { supabase } from "@/integrations/supabase/client";
import type { Role } from "@/lib/wavewallet";

export type InvitationStatus =
  | "pending"
  | "accepted"
  | "declined"
  | "expired"
  | "cancelled";

/** A Universe account matched while searching the global directory. */
export interface UniverseCandidate {
  user_id: string;
  full_name: string;
  handle: string | null;
  avatar_path: string | null;
  masked_email: string | null;
  phone: string | null;
  already_member: boolean;
  pending_invitation: boolean;
  pending_application: boolean;
}

/** Manager-facing invitation row for one shop. */
export interface ShopInvitation {
  id: string;
  user_id: string;
  full_name: string;
  handle: string | null;
  avatar_path: string | null;
  inviter_name: string;
  inviter_role: Role | null;
  status: InvitationStatus;
  message: string | null;
  expires_at: string | null;
  responded_at: string | null;
  created_at: string;
}

/** Invitee-facing invitation row. */
export interface MyInvitation {
  id: string;
  ecosystem_id: string;
  ecosystem_name: string;
  inviter_name: string;
  inviter_role: Role | null;
  message: string | null;
  status: InvitationStatus;
  expires_at: string | null;
  created_at: string;
}

/** Shortest query the directory search will answer. */
export const MIN_INVITE_QUERY = 2;

/**
 * Why this candidate cannot be invited right now, or null when they can.
 * Mirrors the database checks so the UI can explain instead of failing.
 */
export function inviteBlockedReason(
  candidate: UniverseCandidate,
  currentUserId?: string | null,
): string | null {
  if (currentUserId && candidate.user_id === currentUserId) return "This is your own account";
  if (candidate.already_member) return "Already a member of this shop";
  if (candidate.pending_invitation) return "Invitation already pending";
  if (candidate.pending_application) return "Already applied to this shop";
  return null;
}

/** One line of identifying detail so similar names can be told apart. */
export function candidateIdentityLine(c: UniverseCandidate): string {
  return [c.handle ? `@${c.handle}` : null, c.masked_email, c.phone]
    .filter(Boolean)
    .join(" · ");
}

export const invitationTone = (s: InvitationStatus) =>
  s === "accepted"
    ? "success"
    : s === "pending"
      ? "warning"
      : s === "declined" || s === "cancelled"
        ? "danger"
        : "neutral";

/** True when a pending invitation is past its expiry instant. */
export function isExpired(inv: { status: InvitationStatus; expires_at: string | null }, now = new Date()): boolean {
  if (inv.status !== "pending" || !inv.expires_at) return false;
  return new Date(inv.expires_at).getTime() < now.getTime();
}

/** Whole days left before a pending invitation expires (0 when past due). */
export function daysLeft(expiresAt: string | null, now = new Date()): number | null {
  if (!expiresAt) return null;
  const ms = new Date(expiresAt).getTime() - now.getTime();
  return ms <= 0 ? 0 : Math.ceil(ms / 86_400_000);
}

/** Searches the global Universe directory for one shop's invite flow. */
export async function searchUniverseMembers(
  ecosystemId: string,
  query: string,
): Promise<UniverseCandidate[]> {
  if (query.trim().length < MIN_INVITE_QUERY) return [];
  const { data, error } = await supabase.rpc("search_universe_members", {
    _ecosystem_id: ecosystemId,
    _q: query.trim(),
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as UniverseCandidate[];
}

/** Sends the invitation. Creates no membership. */
export async function inviteUniverseMember(
  ecosystemId: string,
  userId: string,
  message?: string,
): Promise<void> {
  const note = message?.trim();
  const { error } = await supabase.rpc("invite_universe_member", {
    _ecosystem_id: ecosystemId,
    _user_id: userId,
    ...(note ? { _message: note } : {}),
  });
  if (error) throw new Error(error.message);
}

export async function fetchShopInvitations(
  ecosystemId: string,
  status?: InvitationStatus | "all",
): Promise<ShopInvitation[]> {
  const { data, error } = await supabase.rpc("list_ecosystem_invitations", {
    _ecosystem_id: ecosystemId,
    ...(status ? { _status: status } : {}),
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as ShopInvitation[];
}

export async function cancelInvitation(invitationId: string): Promise<void> {
  const { error } = await supabase.rpc("cancel_member_invitation", {
    _invitation_id: invitationId,
  });
  if (error) throw new Error(error.message);
}

/** Pending invitations addressed to the signed-in member. */
export async function fetchMyInvitations(): Promise<MyInvitation[]> {
  const { data, error } = await supabase.rpc("my_shop_invitations");
  if (error) return [];
  return (data ?? []) as MyInvitation[];
}

/** Accept creates the membership for that one shop; decline creates nothing. */
export async function respondToInvitation(
  invitationId: string,
  accept: boolean,
): Promise<void> {
  const { error } = await supabase.rpc("respond_to_shop_invitation", {
    _invitation_id: invitationId,
    _accept: accept,
  });
  if (error) throw new Error(error.message);
}
