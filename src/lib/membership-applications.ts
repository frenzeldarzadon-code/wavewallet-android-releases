/**
 * Self-service signup applications.
 *
 * A public signup creates an account with NO ecosystem and NO role — the
 * database only attaches the member (and opens their wallets) when an
 * authorized approver calls `review_membership_application`. Everything here
 * is UI convenience; authorization lives in the database.
 */
import { supabase } from "@/integrations/supabase/client";

export type ApplicationStatus = "pending" | "approved" | "rejected";

export interface MembershipApplication {
  id: string;
  user_id: string;
  ecosystem_id: string;
  full_name: string;
  email: string;
  phone: string;
  status: ApplicationStatus;
  decision_reason: string | null;
  decider_name: string | null;
  decider_role: string | null;
  decided_at: string | null;
  created_at: string;
  ecosystemName?: string;
}

export interface MyApplication {
  status: ApplicationStatus;
  ecosystem_name: string;
  decision_reason: string | null;
  created_at: string;
}

/** Status of the signed-in visitor's own signup application (null when none). */
export async function fetchMyApplication(): Promise<MyApplication | null> {
  const { data, error } = await supabase.rpc("my_membership_application");
  if (error) return null;
  const row = (data as MyApplication[] | null)?.[0];
  return row ?? null;
}

/**
 * Applications the signed-in approver may see. Row-level security already
 * limits the rows to the shops they are authorized for; the optional filter is
 * only used to narrow a super admin's cross-tenant view.
 */
export async function fetchApplications(opts?: {
  ecosystemId?: string | null;
  status?: ApplicationStatus | "all";
}): Promise<MembershipApplication[]> {
  let q = supabase
    .from("membership_applications")
    .select("*, ecosystems(name)")
    .order("created_at", { ascending: false })
    .limit(200);
  if (opts?.ecosystemId) q = q.eq("ecosystem_id", opts.ecosystemId);
  if (opts?.status && opts.status !== "all") q = q.eq("status", opts.status);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as (MembershipApplication & {
    ecosystems?: { name: string } | null;
  })[]).map((r) => ({ ...r, ecosystemName: r.ecosystems?.name ?? "" }));
}

/** Approve or reject. The database re-checks the approver's role and shop. */
export async function reviewApplication(
  applicationId: string,
  approve: boolean,
  reason?: string,
): Promise<void> {
  const trimmed = reason?.trim();
  const { error } = await supabase.rpc("review_membership_application", {
    _application_id: applicationId,
    _approve: approve,
    ...(trimmed ? { _reason: trimmed } : {}),
  });
  if (error) throw new Error(error.message);
}

export const applicationTone = (s: ApplicationStatus) =>
  s === "approved" ? "success" : s === "rejected" ? "danger" : "warning";

/* ------------------------------------------------------------------ */
/* Automatic joining — post-join member review                         */
/* ------------------------------------------------------------------ */

/**
 * Marker the database writes when the automatic join was NOT applied because
 * the person already holds coins in that shop. That protection lives in the
 * database; the UI only reads it so the wording stays honest.
 */
export const MANUAL_REVIEW_MARKER = "Manual review required";

/** True when the database held this join back for manual review (existing coins). */
export function heldForManualReview(reason: string | null | undefined): boolean {
  return !!reason && reason.toLowerCase().includes(MANUAL_REVIEW_MARKER.toLowerCase());
}

/** Row-level state used by the "New members" review list. */
export type ReviewState = "active" | "manual_review" | "kept" | "removed";

export function reviewState(row: {
  status: ApplicationStatus;
  decision_reason: string | null;
}): ReviewState {
  if (row.status === "approved") return "kept";
  if (row.status === "rejected") return "removed";
  return heldForManualReview(row.decision_reason) ? "manual_review" : "active";
}

export const REVIEW_LABEL: Record<ReviewState, string> = {
  active: "Active member",
  manual_review: "Needs manual review",
  kept: "Kept",
  removed: "Removed",
};

export const reviewTone = (s: ReviewState) =>
  s === "kept" || s === "active" ? "success" : s === "removed" ? "danger" : "warning";

/** What the member themselves sees for their own join record. */
export function memberJoinLabel(row: {
  status: ApplicationStatus;
  decisionReason: string | null;
}): string {
  return REVIEW_LABEL[reviewState({ status: row.status, decision_reason: row.decisionReason })];
}

/** Admin confirms the member stays. */
export const keepMember = (id: string, reason?: string) => reviewApplication(id, true, reason);

/** Admin removes the member from THIS shop only; other shops are untouched. */
export const removeMember = (id: string, reason?: string) => reviewApplication(id, false, reason);


/** Roles that may approve or reject a signup application. Mirrors the database. */
export const APPROVER_ROLES = ["super_admin", "admin", "reseller", "subreseller"] as const;
export type ApproverRole = (typeof APPROVER_ROLES)[number];

/**
 * UI mirror of `public.can_review_applications`. The database re-checks this on
 * every decision — a rejected client-side check is only a nicer message.
 */
export function canReviewApplication(
  actor: { role: string; ecosystemId: string | null },
  applicationEcosystemId: string,
): boolean {
  if (actor.role === "super_admin") return true;
  if (!(APPROVER_ROLES as readonly string[]).includes(actor.role)) return false;
  return !!actor.ecosystemId && actor.ecosystemId === applicationEcosystemId;
}

export interface SignupDraft {
  slug: string;
  name: string;
  email: string;
  phone: string;
  password: string;
  confirm: string;
}

/** Client-side validation for the public signup form. Returns null when valid. */
export function validateSignupDraft(d: SignupDraft, allowedSlugs: string[]): string | null {
  if (!d.slug || !allowedSlugs.includes(d.slug))
    return "Choose the ecosystem you are joining.";
  if (!d.name.trim()) return "Enter your full name.";
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(d.email.trim())) return "Enter a valid email address.";
  if (d.phone.trim().replace(/\D/g, "").length < 7) return "Enter a valid mobile number.";
  if (d.password.length < 8) return "Use a password with at least 8 characters.";
  if (d.password !== d.confirm) return "Passwords do not match.";
  return null;
}
