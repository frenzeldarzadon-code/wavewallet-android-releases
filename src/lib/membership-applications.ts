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
  const { error } = await supabase.rpc("review_membership_application", {
    _application_id: applicationId,
    _approve: approve,
    _reason: reason?.trim() ? reason.trim() : undefined,
  });
  if (error) throw new Error(error.message);
}

export const applicationTone = (s: ApplicationStatus) =>
  s === "approved" ? "success" : s === "rejected" ? "danger" : "warning";
