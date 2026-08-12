import { supabase } from "@/integrations/supabase/client";

/**
 * Ecosystem lifecycle cleanup.
 *
 * A shop is only ever archived (never hard-deleted): financial and audit
 * history stays intact under the existing 1-year retention policy, while the
 * shop is closed for signup, frozen, and every member is suspended.
 */
export type CleanupStatus = "active" | "eligible" | "blocked" | "archived";

export const cleanupStatusLabel: Record<CleanupStatus, string> = {
  active: "Active",
  eligible: "Inactive 12 months — can be deleted",
  blocked: "Inactive but blocked",
  archived: "Archived",
};

export const cleanupStatusTone = (status: string): "success" | "warning" | "danger" | "muted" => {
  if (status === "eligible") return "warning";
  if (status === "archived") return "danger";
  if (status === "blocked") return "muted";
  return "success";
};

export type CleanupCheck = {
  status: CleanupStatus;
  eligible: boolean;
  last_activity: string;
  blockers: string[];
};

export async function checkEcosystemCleanup(ecosystemId: string) {
  const { data, error } = await supabase.rpc("ecosystem_cleanup_check", {
    _ecosystem_id: ecosystemId,
  });
  if (error) throw new Error(error.message);
  const row = (data as CleanupCheck[] | null)?.[0];
  if (!row) throw new Error("Ecosystem not found");
  return row;
}

export async function archiveEcosystem(ecosystemId: string, reason: string) {
  const { error } = await supabase.rpc("archive_ecosystem", {
    _ecosystem_id: ecosystemId,
    _reason: reason,
  });
  if (error) throw new Error(error.message);
}

/** Preview which shops the daily maintenance job would archive. */
export async function previewEcosystemCleanup() {
  const { data, error } = await supabase.rpc("run_ecosystem_cleanup", { _dry_run: true });
  if (error) throw new Error(error.message);
  return data as {
    ran_at: string;
    dry_run: boolean;
    eligible: { id: string; name: string; last_activity: string }[];
    archived: { id: string; name: string }[];
    skipped: number;
  };
}
