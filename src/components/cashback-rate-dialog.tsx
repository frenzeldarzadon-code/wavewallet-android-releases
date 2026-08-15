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
  const [chain, setChain] = useState<CashbackSplitPreview | null>(null);

  useEffect(() => {
    if (!target) return;
    setValue(String(target.percent ?? 0));
    setReason("");
    setChain(null);
    void fetchMemberCashbackRate(target.id, target.ecosystemId).then((p) => setValue(String(p)));
    void fetchCashbackSplitPreview(target.id, target.ecosystemId).then(setChain);
  }, [target]);

  const pct = Number(value);
  const isSub = target?.role === "subreseller";
  // A subreseller's share is carved out of the parent reseller's total share.
  const parentTotal = isSub ? Number(chain?.parent_total ?? 0) : pct;
  const subPct = isSub ? pct : 0;
  const split = describeSplit(100, parentTotal, subPct);


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
            Set the individual share for {target?.name}
            {target?.shopName ? ` in ${target.shopName}` : ""}. A subreseller's share is taken out
            of their parent reseller's total share, and the shop admin always keeps the rest. Rate
            changes apply to future purchases only.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="cashback-pct">
              {isSub ? "Subreseller share (%)" : "Reseller total share (%)"}
            </Label>
            <Input
              id="cashback-pct"
              inputMode="numeric"
              className="h-11"
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
            {isSub ? (
              <p className="text-xs text-muted-foreground">
                Parent reseller total share: {parentTotal}% — this cannot be higher.
              </p>
            ) : chain?.max_subreseller ? (
              <p className="text-xs text-muted-foreground">
                Highest subreseller share under them: {chain.max_subreseller}% — this cannot be
                lower.
              </p>
            ) : null}
          </div>
          <div className="space-y-1 rounded-lg bg-muted/40 p-3 text-xs text-muted-foreground">
            <p className="font-medium text-foreground">On a 100-credit qualifying purchase:</p>
            <p>Subreseller {split.subreseller} · Reseller {split.reseller} · Admin {split.admin}</p>
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
