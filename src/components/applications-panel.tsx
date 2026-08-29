/**
 * New members review list.
 *
 * Joining a shop is automatic: the database activates the membership and opens
 * the wallets straight away. This screen is the AFTER-THE-FACT review — the
 * shop admin either keeps the new member or removes them from THIS shop only.
 *
 * The one exception the database enforces (and this screen only reports) is a
 * person who already holds coins in the shop: that join is held for manual
 * review instead of being activated automatically. Removing a member never
 * touches their coins, history, lineage or their memberships in other shops —
 * the database refuses a removal while coins remain.
 */
import { RefreshCw, UserCheck, UserMinus, UserPlus } from "lucide-react";
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
  REVIEW_LABEL,
  canRemoveKeptMember,
  fetchApplications,
  fetchReviewBalances,
  removeKeptMember,
  reviewApplication,
  reviewState,
  reviewTone,
  type ApplicationStatus,
  type MembershipApplication,
} from "@/lib/membership-applications";
import { shortDateTime } from "@/lib/wavewallet";

/** Two-decimal coin amount, e.g. 0.00 */
const coinAmount = (n: number) => n.toFixed(2);



export function ApplicationsPanel({
  ecosystemId,
  showEcosystem = false,
  title = "New members",
  description = "Members who joined your shop automatically. Review them here — they are already active.",
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
  const [remove, setRemove] = useState<MembershipApplication | null>(null);
  /** Set when the dialog is removing a member who was already kept. */
  const [removeKept, setRemoveKept] = useState(false);
  const [reason, setReason] = useState("");
  /** Shop balance per kept member — the removal gate the database also enforces. */
  const [balances, setBalances] = useState<Map<string, number>>(new Map());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const next = await fetchApplications({ ecosystemId: ecosystemId ?? null, status });
      setRows(next);
      const keptIds = next.filter((r) => r.status === "approved").map((r) => r.id);
      setBalances(await fetchReviewBalances(keptIds));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not load new members.");
    } finally {
      setLoading(false);
    }
  }, [ecosystemId, status]);

  useEffect(() => {
    void load();
  }, [load]);

  const decide = async (row: MembershipApplication, keep: boolean, why?: string) => {
    setBusy(row.id);
    try {
      await reviewApplication(row.id, keep, why);
      toast.success(
        keep
          ? `${row.full_name || row.email} stays a member of this shop.`
          : `${row.full_name || row.email} was removed from this shop only.`,
      );
      setRemove(null);
      setReason("");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not record the decision.");
    } finally {
      setBusy(null);
    }
  };

  /** Removes a member who was previously kept — this shop only, zero balance only. */
  const removeFromShop = async (row: MembershipApplication, why?: string) => {
    setBusy(row.id);
    try {
      await removeKeptMember(row.id, why);
      toast.success(`${row.full_name || row.email} was removed from this shop only.`);
      setRemove(null);
      setRemoveKept(false);
      setReason("");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not remove this member.");
    } finally {
      setBusy(null);
    }
  };


  const openCount = rows.filter((r) => r.status === "pending").length;

  return (
    <PageSection devSlot="applications-panel.applications"
      title={title}
      description={description}
      action={
        <div className="flex items-center gap-2">
          <Select value={status} onValueChange={(v) => setStatus(v as ApplicationStatus | "all")}>
            <SelectTrigger className="h-9 w-[150px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="pending">To review</SelectItem>
              <SelectItem value="approved">Kept</SelectItem>
              <SelectItem value="rejected">Removed</SelectItem>
              <SelectItem value="all">All</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="icon" className="size-9" onClick={() => void load()}>
            <RefreshCw className="size-4" />
          </Button>
        </div>
      }
    >
      {status === "pending" && openCount > 0 ? (
        <p className="mb-3 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <UserPlus className="size-3.5" />
          {openCount} new member{openCount === 1 ? "" : "s"} to review — they already have access
        </p>
      ) : null}

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading new members…</p>
      ) : rows.length === 0 ? (
        <EmptyState
          title="No new members"
          description="Members who join this shop appear here for review right after they join."
        />
      ) : (
        <div className="grid gap-3">
          {rows.map((row) => {
            const state = reviewState(row);
            return (
              <Card key={row.id} className="shadow-[var(--shadow-card)]">
                <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-sm font-semibold">
                        {row.full_name || "Unnamed member"}
                      </p>
                      <StatusBadge tone={reviewTone(state)}>{REVIEW_LABEL[state]}</StatusBadge>
                      {showEcosystem && row.ecosystemName ? (
                        <StatusBadge tone="brand">{row.ecosystemName}</StatusBadge>
                      ) : null}
                    </div>
                    <p className="truncate text-xs text-muted-foreground">
                      {row.email}
                      {row.phone ? ` · ${row.phone}` : ""}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      Joined {shortDateTime(row.created_at)}
                      {row.decided_at
                        ? ` · ${state === "kept" ? "kept" : "removed"} by ${
                            row.decider_name ?? "—"
                          }${row.decider_role ? ` (${row.decider_role})` : ""} on ${shortDateTime(
                            row.decided_at,
                          )}`
                        : ""}
                    </p>
                    {state === "manual_review" ? (
                      <p className="mt-1 text-xs text-warning-foreground">
                        Held for manual review: this person already has coins in this shop, so the
                        automatic join does not apply.
                      </p>
                    ) : row.decision_reason ? (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Note: {row.decision_reason}
                      </p>
                    ) : null}
                  </div>

                  {row.status === "pending" ? (
                    <div className="flex shrink-0 flex-wrap gap-2">
                      <Button
                        size="sm"
                        disabled={busy === row.id}
                        onClick={() => void decide(row, true)}
                      >
                        <UserCheck className="size-4" /> Keep member
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy === row.id}
                        onClick={() => {
                          setReason("");
                          setRemoveKept(false);
                          setRemove(row);
                        }}
                      >
                        <UserMinus className="size-4" /> Remove member
                      </Button>
                    </div>
                  ) : state === "kept" ? (
                    <div className="flex shrink-0 flex-col items-start gap-1 sm:items-end">
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-destructive"
                        disabled={busy === row.id || !canRemoveKeptMember(balances.get(row.id))}
                        onClick={() => {
                          setReason("");
                          setRemoveKept(true);
                          setRemove(row);
                        }}
                      >
                        <UserMinus className="size-4" /> Remove from Shop
                      </Button>
                      {canRemoveKeptMember(balances.get(row.id)) ? null : (
                        <p className="max-w-[16rem] text-[11px] text-warning-foreground">
                          Balance in this shop is{" "}
                          {coinAmount(Number(balances.get(row.id) ?? 0))} coins. It must be exactly
                          0.00 before this member can be removed from this shop.
                        </p>
                      )}
                    </div>
                  ) : null}

                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={remove !== null} onOpenChange={(o) => !o && setRemove(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove member from this shop?</DialogTitle>
            <DialogDescription>
              {remove?.full_name || remove?.email} loses access to this shop only. Their coins,
              points, history and their memberships in other shops are never touched, and a member
              who still holds coins here cannot be removed until those coins are used or
              transferred. The reason is optional and is kept in the audit trail.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="remove-reason">Reason (optional)</Label>
            <Textarea
              id="remove-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Joined the wrong shop"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemove(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={busy !== null}
              onClick={() => remove && void decide(remove, false, reason)}
            >
              Remove from this shop
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageSection>
  );
}
