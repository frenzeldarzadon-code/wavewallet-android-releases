/**
 * Pending signup applications for approvers.
 *
 * Visible to Super Admin (all shops) and to a shop's Admin / Reseller /
 * Subreseller (their shop only). The list itself is limited by row-level
 * security, and every approve/reject is re-authorized in the database.
 */
import { CheckCircle2, RefreshCw, UserPlus, XCircle } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState, PageSection, StatusBadge } from "@/components/ui-kit";
import {
  applicationTone,
  fetchApplications,
  reviewApplication,
  type ApplicationStatus,
  type MembershipApplication,
} from "@/lib/membership-applications";
import { shortDateTime } from "@/lib/wavewallet";

export function ApplicationsPanel({
  ecosystemId,
  showEcosystem = false,
  title = "Signup applications",
  description = "New members who chose your shop. They cannot enter until approved.",
}: {
  /** Scope to a single shop. Super Admin passes null to see every shop. */
  ecosystemId?: string | null;
  showEcosystem?: boolean;
  title?: string;
  description?: string;
}) {
  const [rows, setRows] = useState<MembershipApplication[]>([]);
  const [status, setStatus] = useState<ApplicationStatus | "all">("pending");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [reject, setReject] = useState<MembershipApplication | null>(null);
  const [reason, setReason] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await fetchApplications({ ecosystemId: ecosystemId ?? null, status }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not load applications.");
    } finally {
      setLoading(false);
    }
  }, [ecosystemId, status]);

  useEffect(() => {
    void load();
  }, [load]);

  const decide = async (row: MembershipApplication, approve: boolean, why?: string) => {
    setBusy(row.id);
    try {
      await reviewApplication(row.id, approve, why);
      toast.success(
        approve
          ? `${row.full_name || row.email} can now enter the shop.`
          : `${row.full_name || row.email} was rejected.`,
      );
      setReject(null);
      setReason("");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not record the decision.");
    } finally {
      setBusy(null);
    }
  };

  const pendingCount = rows.filter((r) => r.status === "pending").length;

  return (
    <PageSection
      title={title}
      description={description}
      action={
        <div className="flex items-center gap-2">
          <Select value={status} onValueChange={(v) => setStatus(v as ApplicationStatus | "all")}>
            <SelectTrigger className="h-9 w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="approved">Approved</SelectItem>
              <SelectItem value="rejected">Rejected</SelectItem>
              <SelectItem value="all">All</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="icon" className="size-9" onClick={() => void load()}>
            <RefreshCw className="size-4" />
          </Button>
        </div>
      }
    >
      {status === "pending" && pendingCount > 0 ? (
        <p className="mb-3 flex items-center gap-1.5 text-xs font-medium text-warning-foreground">
          <UserPlus className="size-3.5" />
          {pendingCount} applicant{pendingCount === 1 ? "" : "s"} waiting for approval
        </p>
      ) : null}

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading applications…</p>
      ) : rows.length === 0 ? (
        <EmptyState
          title="Nothing here"
          description="No signup applications match this filter."
        />
      ) : (
        <div className="grid gap-3">
          {rows.map((row) => (
            <Card key={row.id} className="shadow-[var(--shadow-card)]">
              <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-sm font-semibold">
                      {row.full_name || "Unnamed applicant"}
                    </p>
                    <StatusBadge tone={applicationTone(row.status)}>{row.status}</StatusBadge>
                    {showEcosystem && row.ecosystemName ? (
                      <StatusBadge tone="brand">{row.ecosystemName}</StatusBadge>
                    ) : null}
                  </div>
                  <p className="truncate text-xs text-muted-foreground">
                    {row.email}
                    {row.phone ? ` · ${row.phone}` : ""}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    Applied {shortDateTime(row.created_at)}
                    {row.decided_at
                      ? ` · ${row.status} by ${row.decider_name ?? "—"}${
                          row.decider_role ? ` (${row.decider_role})` : ""
                        } on ${shortDateTime(row.decided_at)}`
                      : ""}
                  </p>
                  {row.decision_reason ? (
                    <p className="mt-1 text-xs text-destructive">Reason: {row.decision_reason}</p>
                  ) : null}
                </div>

                {row.status === "pending" ? (
                  <div className="flex shrink-0 gap-2">
                    <Button
                      size="sm"
                      disabled={busy === row.id}
                      onClick={() => void decide(row, true)}
                    >
                      <CheckCircle2 className="size-4" /> Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy === row.id}
                      onClick={() => {
                        setReason("");
                        setReject(row);
                      }}
                    >
                      <XCircle className="size-4" /> Reject
                    </Button>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={reject !== null} onOpenChange={(o) => !o && setReject(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject application</DialogTitle>
            <DialogDescription>
              {reject?.full_name || reject?.email} will not be able to enter the shop. The reason is
              optional and is stored in the audit trail.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="reject-reason">Reason (optional)</Label>
            <Textarea
              id="reject-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Could not verify the mobile number"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReject(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={busy !== null}
              onClick={() => reject && void decide(reject, false, reason)}
            >
              Reject application
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageSection>
  );
}
