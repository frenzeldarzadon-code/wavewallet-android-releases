/**
 * Super Admin Credit Issuance (platform owner only).
 *
 * The platform owner mints credits straight into any account. It is not a
 * voucher generator, not an admin purchase and not a wallet transfer: the
 * operator's own balance is never read or debited, so issuing with a zero
 * balance is valid. `superadmin_issue_credits` authorizes the caller, writes
 * one immutable `superadmin_credit_issuance` ledger row, one platform issuance
 * supply row and one audit entry naming the operator.
 */
import { useEffect, useState } from "react";
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
import { ShopWalletSelect } from "@/components/super/shop-wallet-select";
import type { MemberShopWallet } from "@/lib/credit-management";
import { MemberAvatar } from "@/components/member-avatar";
import type { MemberSearchResult } from "@/lib/member-admin";
import { roleLabel, type Role } from "@/lib/wavewallet";
import {
  CREDIT_ISSUANCE_ACTION,
  fetchCreditSupply,
  type CreditSupply,
  CREDIT_ISSUANCE_CATEGORIES,
  issueCredits,
  issuanceFormIssue,
  previewBalance,
} from "@/lib/credit-management";

export function ManualCreditCard() {
  const [target, setTarget] = useState<MemberSearchResult | null>(null);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [category, setCategory] = useState("");
  const [reference, setReference] = useState("");
  const [shopId, setShopId] = useState<string | null>(null);
  const [shopWallet, setShopWallet] = useState<MemberShopWallet | null>(null);
  const [shopRequired, setShopRequired] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [supply, setSupply] = useState<CreditSupply | null>(null);

  const loadSupply = () => void fetchCreditSupply().then(setSupply);
  useEffect(loadSupply, []);

  const credits = Number(amount);
  const issue = issuanceFormIssue({
    userId: target?.id ?? null,
    amount: credits,
    reason: note,
  });
  /** Balance shown is the destination shop wallet, never a merged total. */
  const currentBalance = shopWallet ? shopWallet.balance : (target?.credit_balance ?? 0);
  const after = target ? previewBalance(currentBalance, credits) : 0;

  const submit = async () => {
    if (!target || issue) return;
    setBusy(true);
    try {
      const tx = await issueCredits({
        userId: target.id,
        amount: credits,
        reason: note.trim(),
        ...(category ? { category } : {}),
        ...(reference.trim() ? { reference: reference.trim() } : {}),
        ecosystemId: shopId,
      });
      toast.success("Credits issued", {
        description: `${credits.toLocaleString()} credits to ${target.full_name}${
          shopWallet ? ` · ${shopWallet.ecosystemName}` : ""
        } · ${tx}`,
      });
      setTarget(null);
      setShopId(null);
      setShopWallet(null);
      setAmount("");
      setNote("");
      setCategory("");
      setReference("");
      setConfirming(false);
      loadSupply();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageSection
        title="Issue credits"
        description="Super Admin Credit Issuance: new credits are minted from the platform issuance authority straight into an account. Nothing is deducted from your own wallet — you can issue with a zero balance. Recorded with your name, the amount, the reason and the resulting balance. It creates no vouchers and no commission."
      >
        <Card className="shadow-[var(--shadow-card)]">
          <CardContent className="space-y-4">
            {supply ? (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-muted/40 px-4 py-3 text-sm">
                <span className="text-muted-foreground">Platform credits issued to date</span>
                <span className="font-semibold">
                  {supply.total_issued.toLocaleString()} credits
                  <span className="ml-2 font-normal text-muted-foreground">
                    across {supply.issuance_count.toLocaleString()} issuances
                  </span>
                </span>
              </div>
            ) : null}
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
                  onClick={() => {
                    setTarget(null);
                    setShopId(null);
                    setShopWallet(null);
                  }}
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

            <ShopWalletSelect
              userId={target?.id ?? null}
              value={shopId}
              onChange={(id, wallet) => {
                setShopId(id);
                setShopWallet(wallet);
              }}
              onRequired={setShopRequired}
            />

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="manualAmount">Credits to issue</Label>
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
                  {CREDIT_ISSUANCE_CATEGORIES.map((c) => (
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
                    <dt className="text-muted-foreground">
                    Current balance{shopWallet ? ` · ${shopWallet.ecosystemName}` : ""}
                  </dt>
                    <dd>{currentBalance.toLocaleString()}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Credits issued</dt>
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
              <Button
                disabled={Boolean(issue) || shopRequired || busy}
                onClick={() => setConfirming(true)}
              >
                Review and issue
              </Button>
              {issue ? <p className="text-xs text-muted-foreground">{issue}</p> : null}
              {!issue && shopRequired ? (
                <p className="text-xs text-muted-foreground">
                  Choose which shop wallet receives the credits.
                </p>
              ) : null}
            </div>

            <p className="flex items-start gap-2 text-xs text-muted-foreground">
              <ShieldAlert className="mt-0.5 size-3.5 shrink-0 text-warning" />
              Issued credits increase the platform credit supply and never debit your wallet. They
              are permanent ledger entries — corrections are made with a new adjustment, never by
              editing history.
            </p>
          </CardContent>
        </Card>
      </PageSection>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm {CREDIT_ISSUANCE_ACTION.toLowerCase()}</AlertDialogTitle>
            <AlertDialogDescription>
              {credits.toLocaleString()} credits will be issued to {target?.full_name} and their
              balance becomes {after.toLocaleString()}. Reason: “{note.trim()}”. Issued by Super
              Admin — does not deduct from the Super Admin wallet. This writes a permanent ledger
              entry under your name and cannot be undone — only reversed with a new adjustment.
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
              {busy ? <Loader2 className="size-4 animate-spin" /> : null} Issue credits
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
