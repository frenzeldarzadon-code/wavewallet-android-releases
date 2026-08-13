/**
 * Shop admin credit purchasing.
 *
 * Buying credits never creates them: the order sits as "pending verification"
 * until the platform owner approves it, and only that approval writes a single
 * credit entry. The warning below is shown before every submission.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Coins, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { useSession } from "@/lib/session";
import {
  RELEASE_WARNING,
  STATUS_LABEL,
  amountDue,
  createCreditPurchaseOrder,
  fetchCreditPackages,
  fetchCreditPurchaseOrders,
  fetchCreditPurchaseSettings,
  formatPhp,
  type CreditPackage,
  type CreditPurchaseOrder,
  type CreditPurchaseSettings,
  type OrderStatus,
} from "@/lib/credit-purchases";

export function statusTone(status: string): "default" | "secondary" | "destructive" | "outline" {
  if (status === "approved") return "default";
  if (status === "rejected" || status === "frozen") return "destructive";
  return "secondary";
}

export function CreditPurchasePage() {
  const { ecosystemDbId } = useSession("admin");
  const [packages, setPackages] = useState<CreditPackage[]>([]);
  const [settings, setSettings] = useState<CreditPurchaseSettings | null>(null);
  const [orders, setOrders] = useState<CreditPurchaseOrder[]>([]);
  const [packageId, setPackageId] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [pkgs, cfg, list] = await Promise.all([
        fetchCreditPackages(true),
        fetchCreditPurchaseSettings(),
        fetchCreditPurchaseOrders({ ecosystemId: ecosystemDbId }),
      ]);
      setPackages(pkgs);
      setSettings(cfg);
      setOrders(list);
      setPackageId((current) => current || (pkgs[0]?.id ?? ""));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [ecosystemDbId]);

  useEffect(() => {
    void load();
  }, [load]);

  const selected = useMemo(
    () => packages.find((p) => p.id === packageId) ?? null,
    [packages, packageId],
  );
  const currency = settings?.currency ?? "PHP";
  const discount = settings?.admin_credit_discount_percent ?? 100;
  const listPhp = selected ? Number(selected.price_php) * quantity : 0;
  const payable = amountDue(listPhp, discount);
  const credits = selected ? Number(selected.credits) * quantity : 0;

  const submit = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      await createCreditPurchaseOrder({
        packageId: selected.id,
        quantity,
        paymentReference: reference.trim(),
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      toast.success("Purchase submitted for verification", {
        description: "Credits are released once the platform owner approves the payment.",
      });
      setReference("");
      setNote("");
      setConfirming(false);
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <p className="text-sm text-muted-foreground">Loading credit packages…</p>;

  return (
    <>
      <PageSection
        title="Buy platform credits"
        description="Only the platform owner can create credits. Buy an allocation here, then load it to your resellers and customers from Wallets."
      >
        <Card className="shadow-[var(--shadow-card)]">
          <CardContent className="grid gap-4">
            {packages.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No credit packages are on sale right now. Please contact the platform owner.
              </p>
            ) : (
              <>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="pkg">Credit package</Label>
                    <Select value={packageId} onValueChange={setPackageId}>
                      <SelectTrigger id="pkg">
                        <SelectValue placeholder="Choose a package" />
                      </SelectTrigger>
                      <SelectContent>
                        {packages.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.name} — {Number(p.credits).toLocaleString()} credits ·{" "}
                            {formatPhp(Number(p.price_php), currency)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="qty">Number of packages</Label>
                    <Input
                      id="qty"
                      type="number"
                      min={1}
                      max={100}
                      value={String(quantity)}
                      onChange={(e) =>
                        setQuantity(Math.max(1, Math.min(100, Number(e.target.value) || 1)))
                      }
                    />
                  </div>
                </div>

                <div className="rounded-xl border border-border bg-muted/40 p-4">
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    <Coins className="size-4 text-success" />
                    {credits.toLocaleString()} credits
                  </div>
                  <dl className="mt-3 grid gap-1 text-sm">
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">Platform list price</dt>
                      <dd className={discount > 0 ? "line-through text-muted-foreground" : ""}>
                        {formatPhp(listPhp, currency)}
                      </dd>
                    </div>
                    {discount > 0 ? (
                      <div className="flex justify-between">
                        <dt className="text-muted-foreground">Admin platform benefit</dt>
                        <dd className="font-medium text-success">{discount}% off</dd>
                      </div>
                    ) : null}
                    <div className="flex justify-between border-t border-border pt-1 text-base font-semibold">
                      <dt>You pay</dt>
                      <dd>{formatPhp(payable, currency)}</dd>
                    </div>
                  </dl>
                </div>

                <div className="rounded-xl border border-border p-4 text-sm">
                  <p className="font-semibold">GCash payment</p>
                  {settings?.credit_gcash_number ? (
                    <p className="mt-1 text-muted-foreground">
                      Send to{" "}
                      <span className="font-medium text-foreground">
                        {settings.credit_gcash_account_name || "Platform GCash"}
                      </span>{" "}
                      — <span className="font-mono">{settings.credit_gcash_number}</span>
                    </p>
                  ) : (
                    <p className="mt-1 text-muted-foreground">
                      The platform owner has not published GCash details yet.
                    </p>
                  )}
                  {settings?.credit_payment_instructions ? (
                    <p className="mt-2 whitespace-pre-wrap text-muted-foreground">
                      {settings.credit_payment_instructions}
                    </p>
                  ) : null}
                  {payable === 0 ? (
                    <p className="mt-2 text-muted-foreground">
                      Nothing to pay with your current admin benefit — submit the order and enter
                      &quot;FREE&quot; plus a short note as your reference.
                    </p>
                  ) : null}
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="ref">GCash reference number</Label>
                    <Input
                      id="ref"
                      value={reference}
                      onChange={(e) => setReference(e.target.value)}
                      placeholder="e.g. 1234567890123"
                    />
                  </div>
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label htmlFor="note">Note (optional)</Label>
                    <Textarea
                      id="note"
                      rows={2}
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder="Anything the platform owner should know about this payment"
                    />
                  </div>
                </div>

                <div className="flex items-start gap-2 rounded-xl border border-warning/40 bg-warning/10 p-3 text-xs text-foreground">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
                  <p>{RELEASE_WARNING}</p>
                </div>

                <Button
                  className="w-full sm:w-auto"
                  disabled={!selected || !reference.trim() || busy}
                  onClick={() => setConfirming(true)}
                >
                  Submit purchase for verification
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      </PageSection>

      <PageSection
        title="Purchase history"
        description="Kept separate from voucher transactions and linked to the credit entry each approval creates."
      >
        <Card className="shadow-[var(--shadow-card)]">
          <CardHeader>
            <CardTitle className="text-sm">Credit purchases</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {orders.length === 0 ? (
              <p className="text-sm text-muted-foreground">No credit purchases yet.</p>
            ) : (
              orders.map((o) => (
                <div key={o.id} className="rounded-xl border border-border p-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-medium">
                        {o.package_name} ×{o.quantity} — {Number(o.credits).toLocaleString()}{" "}
                        credits
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(o.created_at).toLocaleString()} · Ref{" "}
                        <span className="font-mono">{o.payment_reference}</span>
                      </p>
                    </div>
                    <Badge variant={statusTone(o.status)}>
                      {STATUS_LABEL[o.status as OrderStatus] ?? o.status}
                    </Badge>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    List {formatPhp(Number(o.list_php), currency)} · {o.discount_percent}% off ·
                    Paid {formatPhp(Number(o.amount_due), currency)}
                  </p>
                  {o.reviewed_at ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Reviewed by {o.reviewer_name ?? "platform owner"} on{" "}
                      {new Date(o.reviewed_at).toLocaleString()}
                      {o.decision_reason ? ` — ${o.decision_reason}` : ""}
                    </p>
                  ) : null}
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </PageSection>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Submit this credit purchase?</AlertDialogTitle>
            <AlertDialogDescription>
              {credits.toLocaleString()} credits for {formatPhp(payable, currency)} using reference{" "}
              {reference.trim()}. {RELEASE_WARNING}
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
              {busy ? <Loader2 className="size-4 animate-spin" /> : null} Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
