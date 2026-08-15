/**
 * Per-member cashback rate editor.
 *
 * Used by shop admins (their own shop) and the platform owner (any shop). The
 * database enforces who may save; this dialog only explains the effect.
 */
import { useEffect, useState } from "react";
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
import {
  describeSplit,
  fetchCashbackSplitPreview,
  fetchMemberCashbackRate,
  setMemberCashbackRate,
  validateCashbackRate,
  type CashbackSplitPreview,
  type RateRole,
} from "@/lib/cashback-rates";


export interface CashbackTarget {
  id: string;
  name: string;
  role: RateRole;
  ecosystemId: string;
  shopName?: string | null;
  /** Known current rate; the dialog refreshes it from the server anyway. */
  percent?: number;
}

interface Props {
  target: CashbackTarget | null;
  onClose: () => void;
  onSaved?: () => void;
}

export function CashbackRateDialog({ target, onClose, onSaved }: Props) {
  const [value, setValue] = useState("0");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!target) return;
    setValue(String(target.percent ?? 0));
    setReason("");
    void fetchMemberCashbackRate(target.id, target.ecosystemId).then((p) => setValue(String(p)));
  }, [target]);

  const pct = Number(value);
  const split = describeSplit(100, target?.role === "reseller" ? pct : 0, target?.role === "subreseller" ? pct : 0);

  const submit = async () => {
    if (!target) return;
    const problem = validateCashbackRate(pct);
    if (problem) {
      toast.error(problem);
      return;
    }
    setBusy(true);
    try {
      await setMemberCashbackRate(target.id, target.ecosystemId, pct, reason);
      toast.success("Cashback rate saved — future purchases only.");
      onSaved?.();
      onClose();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={Boolean(target)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cashback rate</DialogTitle>
          <DialogDescription>
            Set the individual rate for {target?.name}
            {target?.shopName ? ` in ${target.shopName}` : ""}. It applies only to purchases funded
            by credits that passed through them, and only from now on — past transactions keep the
            rate they were made with.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="cashback-pct">Cashback (%)</Label>
            <Input
              id="cashback-pct"
              inputMode="numeric"
              className="h-11"
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
          </div>
          <div className="rounded-lg bg-muted/40 p-3 text-xs text-muted-foreground">
            On a 100-credit customer purchase funded by this member:{" "}
            <span className="font-medium text-foreground">
              {(target?.role === "reseller" ? split.reseller : split.subreseller).toLocaleString()}{" "}
              credits
            </span>{" "}
            to {target?.name || "them"}, the remainder to the shop admin.
          </div>
          <div className="space-y-2">
            <Label htmlFor="cashback-reason">Reason (optional)</Label>
            <Input
              id="cashback-reason"
              className="h-11"
              placeholder="Why is this changing?"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy}>
            {busy ? "Saving…" : "Save rate"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
