/**
 * Platform-owner account removal, with the owner override.
 *
 * The override waives every non-financial rule (operator role, account age,
 * shop membership). It never waives money safety: all balances must be zero and
 * nothing may be in flight. The database re-checks both before deleting.
 */
import { useEffect, useState } from "react";
import { Loader2, ShieldAlert, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { deletePlatformUser } from "@/lib/platform-users.functions";
import { deletionSummary, fetchDeletionCheck, type DeletionCheck } from "@/lib/platform-users";

export interface PurgeTarget {
  id: string;
  name: string;
}

export function PurgeMemberDialog({
  target,
  onClose,
  onDeleted,
}: {
  target: PurgeTarget | null;
  onClose: () => void;
  onDeleted?: () => void;
}) {
  const [check, setCheck] = useState<DeletionCheck | null>(null);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [override, setOverride] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!target) return;
    setCheck(null);
    setCheckError(null);
    setOverride(false);
    setReason("");
  }, [target?.id]);

  useEffect(() => {
    if (!target) return;
    let live = true;
    setCheck(null);
    setCheckError(null);
    fetchDeletionCheck(target.id, override)
      .then((c) => live && setCheck(c))
      .catch(() => {
        if (!live) return;
        setCheckError("We couldn't complete the safety check. No changes were made.");
      });
    return () => {
      live = false;
    };
  }, [target?.id, override]);

  const confirm = async () => {
    if (!target) return;
    setBusy(true);
    try {
      const result = await deletePlatformUser({
        data: {
          userId: target.id,
          ...(reason.trim() ? { reason: reason.trim() } : {}),
          ...(override ? { override: true } : {}),
        },
      });
      toast.success("Account removed", {
        description: result.loginReleased
          ? "Financial history is kept. They can sign up again with the same email or mobile."
          : `History kept, but the login could not be released: ${result.message}`,
      });
      onClose();
      onDeleted?.();
    } catch (e) {
      toast.error("Could not remove that account", {
        description: (e as Error).message || "No changes were made.",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={target !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Remove {target?.name}?</DialogTitle>
          <DialogDescription>
            Financial records stay intact and anonymised. The login is released so the same email or
            mobile can be used to sign up again later.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-start gap-3 rounded-lg border border-border p-3">
          <Switch
            id="purge-override"
            checked={override}
            onCheckedChange={setOverride}
            aria-label="Platform owner override"
          />
          <div className="space-y-0.5">
            <Label htmlFor="purge-override" className="text-sm font-medium">
              Platform owner override
            </Label>
            <p className="text-xs text-muted-foreground">
              Waives every non-money rule — operator role, account age, shop membership. Zero
              balances and no money in flight are still required.
            </p>
          </div>
        </div>

        {checkError ? (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm">
            <p className="flex items-center gap-2 font-medium">
              <ShieldAlert className="size-4" /> The safety check failed
            </p>
            <p className="mt-1">{checkError}</p>
          </div>
        ) : !check ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Checking balances…
          </p>
        ) : (
          <div
            className={`rounded-lg border p-3 text-sm ${
              check.eligible
                ? "border-success/40 bg-success/10"
                : "border-destructive/40 bg-destructive/10"
            }`}
          >
            <p className="flex items-center gap-2 font-medium">
              <ShieldAlert className="size-4" />
              {check.eligible ? "Safe to remove" : "Cannot be removed"}
            </p>
            <p className="mt-1">{deletionSummary(check)}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Coins {check.credit_total} · Points {check.points_total} · Paid social credits{" "}
              {check.social_purchased}
            </p>
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="purge-reason">Reason (kept in the audit log)</Label>
          <Input
            id="purge-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Optional"
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={!check?.eligible || busy}
            onClick={() => void confirm()}
            className="gap-1.5"
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
            {override ? "Purge account" : "Remove account"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
