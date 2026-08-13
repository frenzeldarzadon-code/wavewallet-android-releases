/**
 * Manual Credit for one already-selected account (launched from the Super Admin
 * directory). It reuses the exact same validation and `grantManualCredit` call
 * as the standalone card — required reason, optional category/reference,
 * confirmation, atomic ledger write and audit trail all live server-side.
 */
import { useState } from "react";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { MemberAvatar } from "@/components/member-avatar";
import {
  MANUAL_CREDIT_CATEGORIES,
  grantManualCredit,
  manualCreditIssue,
  previewBalance,
} from "@/lib/credit-management";
import { roleLabel, type Role } from "@/lib/wavewallet";

export interface ManualCreditTarget {
  id: string;
  full_name: string;
  avatar_path: string | null;
  role: Role;
  ecosystem_name: string | null;
  credit_balance: number;
}

export function ManualCreditDialog({
  target,
  onClose,
  onGranted,
}: {
  target: ManualCreditTarget | null;
  onClose: () => void;
  onGranted?: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [category, setCategory] = useState("");
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);

  const credits = Number(amount);
  const issue = manualCreditIssue({ userId: target?.id ?? null, amount: credits, reason });
  const after = target ? previewBalance(target.credit_balance, credits) : 0;

  const reset = () => {
    setAmount("");
    setReason("");
    setCategory("");
    setReference("");
  };

  const submit = async () => {
    if (!target || issue) return;
    setBusy(true);
    try {
      const tx = await grantManualCredit({
        userId: target.id,
        amount: credits,
        reason: reason.trim(),
        ...(category ? { category } : {}),
        ...(reference.trim() ? { reference: reference.trim() } : {}),
      });
      toast.success("Manual credit granted", {
        description: `${credits.toLocaleString()} credits to ${target.full_name} · ${tx}`,
      });
      reset();
      onClose();
      onGranted?.();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={!!target}
      onOpenChange={(o) => {
        if (!o) {
          reset();
          onClose();
        }
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Manual credit</DialogTitle>
          <DialogDescription>
            Recorded as “Superadmin Manual Credit” with your identity, the reason and the resulting
            balance. No vouchers and no commission are created.
          </DialogDescription>
        </DialogHeader>

        {target ? (
          <div className="space-y-4">
            <div className="flex items-center gap-3 rounded-xl border border-border p-3">
              <MemberAvatar name={target.full_name} path={target.avatar_path} className="size-10" />
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{target.full_name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {roleLabel(target.role)}
                  {target.ecosystem_name ? ` · ${target.ecosystem_name}` : ""}
                </p>
                <p className="text-xs text-muted-foreground">
                  Current balance {target.credit_balance.toLocaleString()} credits
                </p>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="mc-amount">Credits to add</Label>
              <Input
                id="mc-amount"
                type="number"
                inputMode="numeric"
                min={1}
                className="h-11"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="mc-category">Category (optional)</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger id="mc-category" className="h-11">
                  <SelectValue placeholder="Select a category" />
                </SelectTrigger>
                <SelectContent>
                  {MANUAL_CREDIT_CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="mc-reason">Reason (required)</Label>
              <Textarea
                id="mc-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Why is this grant being issued?"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="mc-ref">Reference (optional)</Label>
              <Input
                id="mc-ref"
                className="h-11"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder="Ticket or receipt number"
              />
            </div>

            <p className="rounded-lg bg-brand-soft px-3 py-2 text-xs text-accent-foreground">
              New balance after grant: <strong>{after.toLocaleString()}</strong> credits
            </p>
            {issue ? <p className="text-xs text-destructive">{issue}</p> : null}
          </div>
        ) : null}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              reset();
              onClose();
            }}
          >
            Cancel
          </Button>
          <Button disabled={!!issue || busy} onClick={() => void submit()}>
            {busy ? "Granting…" : "Grant credits"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
