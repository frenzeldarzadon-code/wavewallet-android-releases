/**
 * One login, many independent shop memberships.
 *
 * A person keeps a single auth identity, but their role, wallets, downline and
 * history belong to a `(user_id, ecosystem_id)` membership. Everything here is
 * UI convenience: the database decides which memberships exist, which shop may
 * become active, and what each membership may read or write.
 */
import { supabase } from "@/integrations/supabase/client";
import type { Role } from "@/lib/wavewallet";

export interface Membership {
  ecosystemId: string;
  ecosystemName: string;
  ecosystemSlug: string;
  role: Role;
  membershipState: "pending" | "active" | "rejected" | "removed";
  status: "active" | "suspended";
  isActive: boolean;
}

export interface JoinableEcosystem {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  pending: boolean;
}

export interface MyApplicationRow {
  ecosystemId: string;
  ecosystemName: string;
  status: "pending" | "approved" | "rejected";
  decisionReason: string | null;
  createdAt: string;
}

type MembershipRow = {
  ecosystem_id: string;
  ecosystem_name: string;
  ecosystem_slug: string;
  role: Role;
  membership_state: Membership["membershipState"];
  status: Membership["status"];
  is_active: boolean;
};

/** Approved memberships of the signed-in person, newest context first. */
export async function fetchMyMemberships(): Promise<Membership[]> {
  const { data, error } = await supabase.rpc("my_memberships");
  if (error) return [];
  return ((data ?? []) as MembershipRow[]).map((r) => ({
    ecosystemId: r.ecosystem_id,
    ecosystemName: r.ecosystem_name,
    ecosystemSlug: r.ecosystem_slug,
    role: r.role,
    membershipState: r.membership_state,
    status: r.status,
    isActive: r.is_active,
  }));
}

/**
 * Switches the active shop. The database refuses any ecosystem the caller has
 * no approved membership in, so a forged id changes nothing.
 */
export async function switchEcosystem(ecosystemId: string): Promise<void> {
  const { error } = await supabase.rpc("switch_ecosystem", { _ecosystem_id: ecosystemId });
  if (error) throw new Error(error.message);
}

/** Shops the member could still ask to join (excludes shops they already belong to). */
export async function fetchJoinableEcosystems(): Promise<JoinableEcosystem[]> {
  const { data, error } = await supabase.rpc("joinable_ecosystems");
  if (error) return [];
  return ((data ?? []) as (JoinableEcosystem & { pending: boolean })[]).map((r) => ({
    id: r.id,
    name: r.name,
    slug: r.slug,
    description: r.description ?? null,
    pending: !!r.pending,
  }));
}

/** Requests membership in another shop. Requires approval exactly like signup. */
export async function requestJoinEcosystem(ecosystemId: string): Promise<void> {
  const { error } = await supabase.rpc("request_join_ecosystem", { _ecosystem_id: ecosystemId });
  if (error) throw new Error(error.message);
}

/** The member's own applications, one row per shop. */
export async function fetchMyApplications(): Promise<MyApplicationRow[]> {
  const { data, error } = await supabase.rpc("my_applications");
  if (error) return [];
  return ((data ?? []) as {
    ecosystem_id: string;
    ecosystem_name: string;
    status: MyApplicationRow["status"];
    decision_reason: string | null;
    created_at: string;
  }[]).map((r) => ({
    ecosystemId: r.ecosystem_id,
    ecosystemName: r.ecosystem_name,
    status: r.status,
    decisionReason: r.decision_reason,
    createdAt: r.created_at,
  }));
}

/* ------------------------------------------------------------------ */
/* Pure helpers (unit-tested)                                          */
/* ------------------------------------------------------------------ */

/** Only approved, non-suspended memberships may become the active context. */
export function switchableMemberships(list: Membership[]): Membership[] {
  return list.filter((m) => m.membershipState === "active" && m.status === "active");
}

/** The switcher is only worth showing when there is somewhere else to go. */
export function shouldShowSwitcher(list: Membership[]): boolean {
  return switchableMemberships(list).length > 1;
}

/** Guards a switch request in the UI; the database re-checks it regardless. */
export function canSwitchTo(list: Membership[], ecosystemId: string): boolean {
  return switchableMemberships(list).some((m) => m.ecosystemId === ecosystemId);
}

/** The role that applies inside one shop — never a person's "global" role. */
export function roleInEcosystem(list: Membership[], ecosystemId: string): Role | null {
  return (
    switchableMemberships(list).find((m) => m.ecosystemId === ecosystemId)?.role ?? null
  );
}

/** Active membership, or null while the person belongs to no shop yet. */
export function activeMembership(list: Membership[]): Membership | null {
  return list.find((m) => m.isActive) ?? null;
}

/* ------------------------------------------------------------------ */
/* Leaving a shop                                                      */
/* ------------------------------------------------------------------ */

export interface LeavePreview {
  ecosystemId: string;
  ecosystemName: string;
  role: Role;
  needsStepDown: boolean;
  dependentSubresellers: number;
  otherShops: number;
  blockedReason: string | null;
}

/** What leaving this shop would mean — position, dependants, where you land next. */
export async function fetchLeavePreview(ecosystemId: string): Promise<LeavePreview> {
  const { data, error } = await supabase.rpc("leave_shop_preview", {
    _ecosystem_id: ecosystemId,
  });
  if (error) throw new Error(error.message);
  const r = data as {
    ecosystem_id: string;
    ecosystem_name: string;
    role: Role;
    needs_step_down: boolean;
    dependent_subresellers: number;
    other_shops: number;
    blocked_reason: string | null;
  };
  return {
    ecosystemId: r.ecosystem_id,
    ecosystemName: r.ecosystem_name,
    role: r.role,
    needsStepDown: !!r.needs_step_down,
    dependentSubresellers: Number(r.dependent_subresellers ?? 0),
    otherShops: Number(r.other_shops ?? 0),
    blockedReason: r.blocked_reason,
  };
}

/**
 * Leaves a shop. Sellers must step down first; the database resets any
 * dependent subresellers to ordinary customers and never deletes accounts,
 * wallets or history.
 */
export async function leaveShop(
  ecosystemId: string,
  stepDown = false,
): Promise<{ nextEcosystemId: string | null; subresellersReset: number }> {
  const { data, error } = await supabase.rpc("leave_shop", {
    _ecosystem_id: ecosystemId,
    _step_down: stepDown,
  });
  if (error) throw new Error(error.message);
  const r = (data ?? {}) as { next_ecosystem_id: string | null; subresellers_reset: number };
  return {
    nextEcosystemId: r.next_ecosystem_id ?? null,
    subresellersReset: Number(r.subresellers_reset ?? 0),
  };
}
