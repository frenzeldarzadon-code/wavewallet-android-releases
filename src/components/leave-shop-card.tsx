/**
 * Leave shop / Step down & leave.
 *
 * Leaving removes only the membership: the account, wallet history and every
 * financial record stay exactly as they are. A seller must step down first, and
 * the database resets any dependent subresellers to ordinary customers so no
 * orphaned hierarchy can be left behind — this component only asks and reports.
 */
import { useEffect, useState } from "react";
import { LogOut } from "lucide-react";
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
import { roleLabels } from "@/lib/wavewallet";
import { fetchLeavePreview, leaveShop, type LeavePreview } from "@/lib/memberships";

export function LeaveShopCard({
  ecosystemId,
  ecosystemName,
}: {
  ecosystemId: string | null;
  ecosystemName: string;
}) {
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<LeavePreview | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || !ecosystemId) return;
    setPreview(null);
    fetchLeavePreview(ecosystemId)
      .then(setPreview)
      .catch((e: Error) => {
        toast.error(e.message);
        setOpen(false);
      });
  }, [open, ecosystemId]);

  if (!ecosystemId) return null;

  const stepDown = preview?.needsStepDown ?? false;

  const confirm = async () => {
    setBusy(true);
    try {
      const res = await leaveShop(ecosystemId, stepDown);
      toast.success(
        res.nextEcosystemId
          ? `You left ${ecosystemName}. You are now in another shop you belong to.`
          : `You left ${ecosystemName}. Your account, wallet history and records are unchanged.`,
      );
      window.location.reload();
    } catch (e) {
      setBusy(false);
      toast.error(e instanceof Error ? e.message : "Could not leave this shop");
    }
  };

  return (
    <>
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div className="min-w-0">
            <p className="text-sm font-medium">Leave this shop</p>
            <p className="break-words text-xs text-muted-foreground">
              You keep your account, wallet history and every record. Only your access to{" "}
              {ecosystemName} ends.
            </p>
          </div>
          <Button variant="outline" onClick={() => setOpen(true)}>
            <LogOut className="size-4" /> Leave shop
          </Button>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {stepDown ? "Step down & leave shop" : `Leave ${ecosystemName}?`}
            </DialogTitle>
            <DialogDescription>
              Nothing financial is deleted. Your account, transactions, wallet history and
              records stay intact — only this shop membership ends.
            </DialogDescription>
          </DialogHeader>

          {preview ? (
            <div className="space-y-2 rounded-xl border border-border p-3 text-sm">
              <p className="flex flex-wrap justify-between gap-2">
                <span className="text-muted-foreground">Your position</span>
                <span className="font-medium capitalize">{roleLabels[preview.role]}</span>
              </p>
              {preview.dependentSubresellers > 0 ? (
                <p className="rounded-lg bg-destructive/10 px-2.5 py-2 text-[12px] text-destructive">
                  {preview.dependentSubresellers} subreseller
                  {preview.dependentSubresellers > 1 ? "s" : ""} depend on you. If your shop admin
                  has not reassigned them to another reseller first, they become ordinary
                  customers of this shop.
                </p>
              ) : null}
              <p className="flex flex-wrap justify-between gap-2">
                <span className="text-muted-foreground">After leaving</span>
                <span className="font-medium">
                  {preview.otherShops > 0
                    ? "You move to another shop you belong to"
                    : "You stay in the Universe with no shop"}
                </span>
              </p>
              {preview.blockedReason ? (
                <p className="text-[12px] text-destructive">{preview.blockedReason}</p>
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Checking your position…</p>
          )}

          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={busy || !preview || !!preview.blockedReason}
              onClick={() => void confirm()}
            >
              {busy ? "Leaving…" : stepDown ? "Step down & leave" : "Leave shop"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
