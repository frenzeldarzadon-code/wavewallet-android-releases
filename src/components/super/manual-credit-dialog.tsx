/**
 * Manual Credit for one already-selected account (launched from the Super Admin
 * directory). It reuses the exact same validation and `issueCredits` call
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
import { ShopWalletSelect } from "@/components/super/shop-wallet-select";
import {
  type MemberShopWallet,
  CREDIT_ISSUANCE_CATEGORIES,
  issueCredits,
  issuanceFormIssue,
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
  const [shopId, setShopId] = useState<string | null>(null);
  const [shopWallet, setShopWallet] = useState<MemberShopWallet | null>(null);
  const [shopRequired, setShopRequired] = useState(false);
  const [busy, setBusy] = useState(false);

  const credits = Number(amount);
  const issue = issuanceFormIssue({ userId: target?.id ?? null, amount: credits, reason });
  /** Balance shown is the destination shop wallet, never a merged total. */
  const currentBalance = shopWallet ? shopWallet.balance : (target?.credit_balance ?? 0);
  const after = target ? previewBalance(currentBalance, credits) : 0;

  const reset = () => {
    setAmount("");
    setReason("");
    setCategory("");
    setReference("");
    setShopId(null);
    setShopWallet(null);
  };

  const submit = async () => {
    if (!target || issue) return;
    setBusy(true);
    try {
      const tx = await issueCredits({
        userId: target.id,
        amount: credits,
        reason: reason.trim(),
        ...(category ? { category } : {}),
        ...(reference.trim() ? { reference: reference.trim() } : {}),
        ecosystemId: shopId,
      });
      toast.success("Credits issued", {
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
          <DialogTitle>Issue credits</DialogTitle>
          <DialogDescription>
            Super Admin Credit Issuance. Recorded with your identity, the reason and the resulting
            balance. Issued by Super Admin — does not deduct from the Super Admin wallet. No
            vouchers and no commission are created.
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
                  Current balance {currentBalance.toLocaleString()} credits
                  {shopWallet ? ` · ${shopWallet.ecosystemName}` : ""}
                </p>
              </div>
            </div>

            <ShopWalletSelect
              userId={target.id}
              value={shopId}
              onChange={(id, wallet) => {
                setShopId(id);
                setShopWallet(wallet);
              }}
              onRequired={setShopRequired}
              id="mc-shop"
            />

            <div className="space-y-1.5">
              <Label htmlFor="mc-amount">Credits to issue</Label>
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
                  {CREDIT_ISSUANCE_CATEGORIES.map((c) => (
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

            <div className="space-y-1 rounded-lg bg-brand-soft px-3 py-2 text-xs text-accent-foreground">
              <p>
                Issuing <strong>{credits > 0 ? credits.toLocaleString() : "—"}</strong> credits to{" "}
                <strong>{target.full_name}</strong>.
              </p>
              <p>
                New balance after issuance: <strong>{after.toLocaleString()}</strong> credits
              </p>
              {reason.trim() ? <p>Reason: “{reason.trim()}”</p> : null}
              <p className="font-medium">
                Issued by Super Admin — does not deduct from Super Admin wallet.
              </p>
            </div>
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
          <Button disabled={!!issue || shopRequired || busy} onClick={() => void submit()}>
            {busy ? "Issuing…" : "Issue credits"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
