/**
 * Organization restructuring — Reseller <-> Subreseller.
 *
 * A restructure NEVER creates a new account and never touches money: the same
 * profile keeps its ecosystem, wallet balance, credit ledger, points, voucher
 * history, earnings and audit trail. Only the role row and the parent-reseller
 * link change, and only from that moment forward — historical commission and
 * upline attribution stay exactly as they were recorded.
 *
 * The rules below mirror `public.restructure_member_role`, which re-evaluates
 * everything authoritatively inside one atomic database transaction.
 */
import { supabase } from "@/integrations/supabase/client";
import type { Role } from "@/lib/wavewallet";

export type RestructurableRole = "reseller" | "subreseller";
/** Roles a restructure can move a member to — includes stepping down to a plain customer. */
export type RestructureTargetRole = RestructurableRole | "customer";

export const MIN_REASON_LENGTH = 5;

export interface RestructureChild {
  id: string;
  name: string;
  email: string;
}

/** Snapshot of the member, as returned by `public.role_restructure_check`. */
export interface RestructureCheck {
  user_id: string;
  ecosystem_id: string;
  full_name: string;
  email: string;
  current_role: Role | null;
  parent_reseller_id: string | null;
  parent_reseller_name: string | null;
  children: RestructureChild[];
  child_count: number;
  credits: number;
  points: number;
  points_held: number;
  eligible: boolean;
  target_role: RestructurableRole | null;
}

export interface RestructurePlan {
  /** Role the member should end up with. */
  newRole: RestructureTargetRole;
  /** Required when demoting to subreseller: the parent reseller. */
  parentResellerId?: string | null;
  /** child id -> new parent reseller id, required for every child on demotion. */
  childReassignments?: Record<string, string | undefined>;
  reason: string;
}

export interface RestructureVerdict {
  ok: boolean;
  /** Plain-language reasons the change cannot be confirmed yet. */
  blockers: string[];
  /** Things the operator should be aware of before confirming. */
  notes: string[];
}

export function isRestructurable(role: Role | null | undefined): role is RestructurableRole {
  return role === "reseller" || role === "subreseller";
}

export function oppositeRole(role: RestructurableRole): RestructurableRole {
  return role === "reseller" ? "subreseller" : "reseller";
}

/** Roles a member currently holding `role` may be moved to. */
export function targetRolesFor(role: RestructurableRole): RestructureTargetRole[] {
  return [oppositeRole(role), "customer"];
}

/** Pure validation used by the confirmation screen before anything is sent. */
export function evaluateRestructure(
  check: Pick<
    RestructureCheck,
    "user_id" | "current_role" | "children" | "parent_reseller_name"
  >,
  plan: RestructurePlan,
): RestructureVerdict {
  const blockers: string[] = [];
  const notes: string[] = [];

  if (!isRestructurable(check.current_role)) {
    blockers.push("Only resellers and subresellers can be restructured here.");
    return { ok: false, blockers, notes };
  }
  if (plan.newRole === check.current_role) {
    blockers.push("This member already has that role.");
  }

  const reason = plan.reason.trim();
  if (reason.length < MIN_REASON_LENGTH) {
    blockers.push(`Write a reason of at least ${MIN_REASON_LENGTH} characters.`);
  }

  // Stepping down (to subreseller or customer) requires every owned subreseller
  // to be handed over to another reseller first.
  if (plan.newRole === "subreseller" || plan.newRole === "customer") {
    for (const child of check.children) {
      const next = plan.childReassignments?.[child.id] ?? "";
      if (!next) {
        blockers.push(`Reassign ${child.name} to another reseller first.`);
      } else if (next === check.user_id || next === child.id) {
        blockers.push(`Choose a different reseller for ${child.name}.`);
      }
    }
  }

  if (plan.newRole === "subreseller") {
    const parent = plan.parentResellerId ?? "";
    if (!parent) {
      blockers.push("Choose the parent reseller who will own this subreseller.");
    } else if (parent === check.user_id) {
      blockers.push("A member cannot be their own parent reseller.");
    }

    if (check.children.length > 0 && blockers.length === 0) {
      notes.push(
        check.children.length === 1
          ? "1 subreseller will be moved to the reseller you selected."
          : `${check.children.length} subresellers will be moved to the resellers you selected.`,
      );
    }
    notes.push("The member stops earning upline commission on future sales.");
  } else if (plan.newRole === "customer") {
    if (check.children.length > 0 && blockers.length === 0) {
      notes.push(
        check.children.length === 1
          ? "1 subreseller will be moved to the reseller you selected."
          : `${check.children.length} subresellers will be moved to the resellers you selected.`,
      );
    }
    notes.push(
      "They keep the same login and can buy vouchers straight away as a normal customer.",
    );
    notes.push(
      "Wholesale discount, sales commission and every reseller-only action are removed from now on.",
    );
  } else {
    if (check.parent_reseller_name) {
      notes.push(
        `The parent link to ${check.parent_reseller_name} is removed for future transactions. Past commissions stay attributed to them.`,
      );
    }
    notes.push("The member becomes a top-level reseller with no upline.");
  }

  notes.push("Wallet credits, points and all history are unchanged (financial impact: zero).");

  return { ok: blockers.length === 0, blockers, notes };
}

/** Reads the live restructure snapshot for a member. */
export async function fetchRestructureCheck(userId: string): Promise<RestructureCheck> {
  const { data, error } = await supabase.rpc("role_restructure_check", { _user_id: userId });
  if (error) throw new Error(error.message);
  const raw = data as unknown as RestructureCheck;
  return {
    ...raw,
    children: raw.children ?? [],
    credits: Number(raw.credits ?? 0),
    points: Number(raw.points ?? 0),
    points_held: Number(raw.points_held ?? 0),
  };
}

export interface RestructureResult {
  user_id: string;
  previous_role: RestructurableRole;
  new_role: RestructureTargetRole;
  new_parent_id: string | null;
  reassigned_children: Array<{ child_id: string; child_name: string; new_parent_id: string }>;
}

/** Performs the role change atomically in the database. */
export async function restructureMemberRole(
  userId: string,
  plan: RestructurePlan,
): Promise<RestructureResult> {
  const reassignments = Object.entries(plan.childReassignments ?? {})
    .filter(([, parent]) => !!parent)
    .map(([child_id, new_parent_id]) => ({ child_id, new_parent_id }));

  const parent = plan.newRole === "subreseller" ? (plan.parentResellerId ?? "") : "";
  const { data, error } = await supabase.rpc("restructure_member_role", {
    _user_id: userId,
    _new_role: plan.newRole,
    _reason: plan.reason.trim(),
    _child_reassignments: reassignments as unknown as never,
    ...(parent ? { _parent_reseller_id: parent } : {}),
  });
  if (error) throw new Error(error.message);
  return data as unknown as RestructureResult;
}
