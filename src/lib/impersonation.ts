/**
 * Secure "Access Account" (act-as) delegation.
 *
 * The operator keeps their own login. A short-lived delegation row in the
 * database decides whose account the member-facing money RPCs apply to
 * (`public.effective_uid()`), and every mutation is written to the audit trail
 * under BOTH identities. Nothing here grants access on its own: the database
 * re-checks `can_impersonate()` on every use.
 */
import { supabase } from "@/integrations/supabase/client";
import type { Role } from "@/lib/wavewallet";

export interface ActingSession {
  id: string;
  targetId: string;
  targetName: string;
  targetRole: Role;
  ecosystemId: string;
  reason: string | null;
  startedAt: string;
  expiresAt: string;
}

/** Roles an operator may ever enter. Admins and super admins are never targets. */
export const IMPERSONATABLE_ROLES: Role[] = ["reseller", "subreseller", "customer"];

export const canOperate = (operatorRole: Role | undefined | null) =>
  operatorRole === "admin" || operatorRole === "super_admin";

export const isImpersonatable = (targetRole: Role) => IMPERSONATABLE_ROLES.includes(targetRole);

export async function fetchActingSession(): Promise<ActingSession | null> {
  const { data, error } = await supabase.rpc("my_impersonation");
  if (error) return null;
  const row = (data as unknown[] | null)?.[0] as
    | {
        id: string;
        target_id: string;
        target_name: string;
        target_role: Role;
        ecosystem_id: string;
        reason: string | null;
        started_at: string;
        expires_at: string;
      }
    | undefined;
  if (!row) return null;
  return {
    id: row.id,
    targetId: row.target_id,
    targetName: row.target_name,
    targetRole: row.target_role,
    ecosystemId: row.ecosystem_id,
    reason: row.reason,
    startedAt: row.started_at,
    expiresAt: row.expires_at,
  };
}

/** Enters an account. The database refuses anything outside the operator's scope. */
export async function startImpersonation(targetId: string, reason: string) {
  const trimmed = reason.trim();
  const { data, error } = await supabase.rpc("start_impersonation", {
    _target: targetId,
    ...(trimmed ? { _reason: trimmed } : {}),
  });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function endImpersonation() {
  const { error } = await supabase.rpc("end_impersonation");
  if (error) throw new Error(error.message);
}

export interface OperatorAuditRow {
  id: string;
  created_at: string;
  action: string;
  target: string;
  actorName: string;
  ecosystemId: string | null;
  operatorId: string;
  operatorRole: string;
  targetId: string;
  targetRole: string;
  reason: string;
  entity: string;
  details: Record<string, unknown>;
}

export interface OperatorAuditFilters {
  ecosystemId?: string | null;
  query?: string;
  operatorId?: string;
  targetRole?: string;
  from?: string;
  to?: string;
}

/** Reads the dual-identity audit rows. RLS still decides what is visible. */
export async function fetchOperatorAudit(
  filters: OperatorAuditFilters = {},
): Promise<OperatorAuditRow[]> {
  let q = supabase
    .from("audit_logs")
    .select("id, created_at, action, target, actor_name, actor_id, ecosystem_id, metadata")
    .contains("metadata", { acted_as: true })
    .order("created_at", { ascending: false })
    .limit(300);

  if (filters.ecosystemId) q = q.eq("ecosystem_id", filters.ecosystemId);
  if (filters.from) q = q.gte("created_at", filters.from);
  if (filters.to) q = q.lte("created_at", filters.to);

  const { data, error } = await q;
  if (error) return [];

  const rows = (data ?? []).map((r) => {
    const m = (r.metadata ?? {}) as Record<string, unknown>;
    return {
      id: r.id,
      created_at: r.created_at,
      action: r.action,
      target: r.target,
      actorName: r.actor_name,
      ecosystemId: r.ecosystem_id,
      operatorId: String(m["operator_id"] ?? r.actor_id ?? ""),
      operatorRole: String(m["operator_role"] ?? ""),
      targetId: String(m["target_id"] ?? ""),
      targetRole: String(m["target_role"] ?? ""),
      reason: String(m["reason"] ?? ""),
      entity: String(m["entity"] ?? ""),
      details: m,
    } satisfies OperatorAuditRow;
  });

  return filterOperatorAudit(rows, filters);
}

/** Pure client-side narrowing — kept separate so it can be unit tested. */
export function filterOperatorAudit(
  rows: OperatorAuditRow[],
  filters: OperatorAuditFilters,
): OperatorAuditRow[] {
  const needle = (filters.query ?? "").trim().toLowerCase();
  return rows.filter((r) => {
    if (filters.operatorId && r.operatorId !== filters.operatorId) return false;
    if (filters.targetRole && filters.targetRole !== "all" && r.targetRole !== filters.targetRole)
      return false;
    if (!needle) return true;
    return [r.action, r.target, r.actorName, r.reason, r.entity]
      .join(" ")
      .toLowerCase()
      .includes(needle);
  });
}
