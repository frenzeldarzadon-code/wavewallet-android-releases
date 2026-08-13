/**
 * Manual credit (platform owner only).
 *
 * A direct grant into any account's credit wallet. It is not a voucher
 * generator and it is not an admin purchase: no voucher inventory, no codes
 * and no commission are created. The grant goes through `admin_adjust_credits`,
 * which only the platform owner may call with a positive amount, and writes one
 * immutable ledger row plus an audit entry naming the operator.
 */
import { useState } from "react";
import { Coins, Loader2, ShieldAlert, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { PageSection } from "@/components/ui-kit";
import { MemberPicker } from "@/components/member-picker";
import { MemberAvatar } from "@/components/member-avatar";
import type { MemberSearchResult } from "@/lib/member-admin";
import { roleLabel, type Role } from "@/lib/wavewallet";
import {
  MANUAL_CREDIT_ACTION,
  MANUAL_CREDIT_CATEGORIES,
  grantManualCredit,
  manualCreditIssue,
  previewBalance,
} from "@/lib/credit-management";

export function ManualCreditCard() {
  const [target, setTarget] = useState<MemberSearchResult | null>(null);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [category, setCategory] = useState("");
  const [reference, setReference] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const credits = Number(amount);
  const issue = manualCreditIssue({
    userId: target?.id ?? null,
    amount: credits,
    reason: note,
  });
  const after = target ? previewBalance(target.credit_balance, credits) : 0;

  const submit = async () => {
    if (!target || issue) return;
    setBusy(true);
    try {
      const tx = await grantManualCredit({
        userId: target.id,
        amount: credits,
        reason: note.trim(),
        ...(category ? { category } : {}),
        ...(reference.trim() ? { reference: reference.trim() } : {}),
      });
      toast.success("Manual credit granted", {
        description: `${credits.toLocaleString()} credits to ${target.full_name} · ${tx}`,
      });
      setTarget(null);
      setAmount("");
      setNote("");
      setCategory("");
      setReference("");
      setConfirming(false);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageSection
        title="Manual credit"
        description="Platform-owner grant straight into an account's credit wallet. Recorded as “Superadmin Manual Credit” with your name, the amount, the reason and the resulting balance. It creates no vouchers and no commission."
      >
        <Card className="shadow-[var(--shadow-card)]">
          <CardContent className="space-y-4">
            {target ? (
              <div className="flex items-center gap-3 rounded-xl border border-border p-3">
                <MemberAvatar
                  name={target.full_name}
                  path={target.avatar_path}
                  className="size-10"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{target.full_name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {roleLabel(target.role as Role)}
                    {target.ecosystem_name ? ` · ${target.ecosystem_name}` : ""} ·{" "}
                    {target.masked_email}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Current balance {target.credit_balance.toLocaleString()} credits
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Clear selected account"
                  onClick={() => setTarget(null)}
                >
                  <X className="size-4" />
                </Button>
              </div>
            ) : (
              <div className="space-y-1.5">
                <Label>Account to credit</Label>
                <MemberPicker
                  showEcosystem
                  placeholder="Search any account by name, @handle, email or phone"
                  onSelect={setTarget}
                />
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="manualAmount">Credits to grant</Label>
                <Input
                  id="manualAmount"
                  type="number"
                  min={1}
                  step={1}
                  inputMode="numeric"
                  value={amount}
                  placeholder="1000"
                  onChange={(e) => setAmount(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="manualCategory">Category (optional)</Label>
                <select
                  id="manualCategory"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="">No category</option>
                  {MANUAL_CREDIT_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="manualRef">Reference (optional)</Label>
                <Input
                  id="manualRef"
                  value={reference}
                  placeholder="GCash ref, ticket no."
                  onChange={(e) => setReference(e.target.value)}
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="manualNote">Reason (required)</Label>
                <Textarea
                  id="manualNote"
                  value={note}
                  placeholder="Goodwill top-up after verified payment"
                  onChange={(e) => setNote(e.target.value)}
                />
              </div>
            </div>

            {target && credits > 0 ? (
              <div className="rounded-xl border border-border bg-muted/40 p-4 text-sm">
                <div className="flex items-center gap-2 font-semibold">
                  <Coins className="size-4 text-success" />
                  Preview
                </div>
                <dl className="mt-2 grid gap-1">
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Current balance</dt>
                    <dd>{target.credit_balance.toLocaleString()}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Manual credit</dt>
                    <dd className="text-success">+{credits.toLocaleString()}</dd>
                  </div>
                  <div className="flex justify-between font-semibold">
                    <dt>Balance after</dt>
                    <dd>{after.toLocaleString()}</dd>
                  </div>
                </dl>
              </div>
            ) : null}

            <div className="flex flex-wrap items-center gap-3">
              <Button disabled={Boolean(issue) || busy} onClick={() => setConfirming(true)}>
                Review and grant
              </Button>
              {issue ? <p className="text-xs text-muted-foreground">{issue}</p> : null}
            </div>

            <p className="flex items-start gap-2 text-xs text-muted-foreground">
              <ShieldAlert className="mt-0.5 size-3.5 shrink-0 text-warning" />
              Manual credits increase the platform credit supply. They are permanent ledger
              entries — corrections are made with a new adjustment, never by editing history.
            </p>
          </CardContent>
        </Card>
      </PageSection>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm {MANUAL_CREDIT_ACTION.toLowerCase()}</AlertDialogTitle>
            <AlertDialogDescription>
              {credits.toLocaleString()} credits will be granted to {target?.full_name} and their
              balance becomes {after.toLocaleString()}. This writes a permanent ledger entry under
              your name and cannot be undone — only reversed with a new adjustment.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(e) => {
                e.preventDefault();
                void submit();
              }}
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : null} Grant credits
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
