/**
 * GO LIVE — turns a free Demo (New Generation) shop into a live shop.
 *
 * The member picks one of the existing subscription plans, pays the platform
 * GCash number, then states the same two identifiers the Cash In listener
 * already needs: the GCash number they paid FROM and the reference number.
 * The platform listener does the recognising; this form only associates the
 * payment with the pending request. Demo Coins are never converted.
 */
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, Rocket, ShieldCheck } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageSection, StatusBadge } from "@/components/ui-kit";
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
import { peso } from "@/lib/wavewallet";
import { fetchPlans, fetchQuote, type SubscriptionPlan, type SubscriptionQuote } from "@/lib/subscription-shops";
import {
  fetchGoLiveRequest,
  fetchPlatformGcash,
  goLiveStatusLine,
  submitGoLivePayment,
  type SubscriptionRequest,
} from "@/lib/go-live";
import { CashInProofPicker } from "@/components/money/cash-in-proof";
import { uploadCashInProof, removeCashInProof, fetchPaymentMethods, type PaymentMethod } from "@/lib/wallet-money";
import { PaymentMethodCards } from "@/components/money/payment-method-cards";
import { extractCashInReceipt } from "@/lib/cash-in-receipt.functions";
import { verifyGoLiveReceipt } from "@/lib/go-live-receipt.functions";
import { RECEIPT_CHECK_LABEL } from "@/lib/cash-in-receipt";
import { supabase } from "@/integrations/supabase/client";
import {
  goLiveChecklist,
  goLiveFieldErrors,
  mapGoLiveError,
  type GoLiveField,
} from "@/lib/go-live-readiness";


type Gcash = Awaited<ReturnType<typeof fetchPlatformGcash>>;

export function GoLiveCard({
  ecosystemId,
  shopName,
  isLive,
  onLive,
}: {
  ecosystemId: string;
  shopName?: string | null;
  /** The shop's own persisted Demo/Live state — the single source of truth. */
  isLive?: boolean;
  onLive?: () => void;
}) {
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [gcash, setGcash] = useState<Gcash>(null);
  // Every ACTIVE platform-wide receiving account the platform owner published.
  // Nothing here is invented: the list is exactly what is configured.
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [methodId, setMethodId] = useState<string | null>(null);
  const [request, setRequest] = useState<SubscriptionRequest | null>(null);
  const [planId, setPlanId] = useState("");
  const [months, setMonths] = useState("1");
  const [payerNumber, setPayerNumber] = useState("");
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [quote, setQuote] = useState<SubscriptionQuote | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [serverField, setServerField] = useState<GoLiveField | null>(null);
  // Proof of payment — same bucket, same folder convention and same reader as
  // the established Cash In flow. Evidence only; the listener still decides.
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [proofPath, setProofPath] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [receiptNote, setReceiptNote] = useState<string | null>(null);


  /** Upload immediately, then read it with the existing Cash In receipt reader. */
  const handlePickProof = async (file: File | null) => {
    if (proofPath) void removeCashInProof(proofPath).catch(() => {});
    setProofPath(null);
    setReceiptNote(null);
    setProofFile(file);
    if (!file) return;
    setReading(true);
    try {
      const { data: authUser } = await supabase.auth.getUser();
      const ownerId = authUser?.user?.id;
      if (!ownerId) throw new Error("Your session expired. Sign in again to attach a screenshot.");
      const path = await uploadCashInProof(ownerId, file);
      setProofPath(path);
      const read = await extractCashInReceipt({ data: { proofPath: path } });
      if (read.reference) setReference(read.reference);
      if (read.senderNumber) setPayerNumber(read.senderNumber);
      setReceiptNote(
        read.readable
          ? "Screenshot read — check the reference and sending number below before you submit."
          : "We could not read this screenshot clearly. Type the reference and sending number yourself; the payment still goes for review.",
      );
    } catch (e) {
      setProofFile(null);
      setServerField("proof");
      setServerError(e instanceof Error ? e.message : "Could not read that screenshot.");
    } finally {
      setReading(false);
    }
  };

  const load = useCallback(async () => {
    try {
      const [p, g, r, m] = await Promise.all([
        fetchPlans(),
        fetchPlatformGcash(),
        fetchGoLiveRequest(ecosystemId),
        fetchPaymentMethods(true, { ecosystemId: null }).catch(() => [] as PaymentMethod[]),
      ]);
      setPlans(p);
      setGcash(g);
      setRequest(r);
      setMethods(m);
      setMethodId((v) => v || (m.length === 1 ? m[0]!.id : null));
      setPlanId((v) => v || p[0]?.id || "");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not load the Go Live details");
    } finally {
      setLoading(false);
    }
  }, [ecosystemId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Existing server-side calculation engine (subscription_quote) — the single
  // source of truth for plan changes, prorated value and credit adjustment.
  useEffect(() => {
    let cancelled = false;
    if (!planId) return;
    fetchQuote(ecosystemId, planId)
      .then((q) => {
        if (!cancelled) setQuote(q);
      })
      .catch(() => {
        if (!cancelled) setQuote(null);
      });
    return () => {
      cancelled = true;
    };
  }, [ecosystemId, planId]);

  const plan = plans.find((p) => p.id === planId) ?? null;
  const monthCount = Math.max(1, Math.min(24, Number(months) || 1));
  const isPlanChange = Boolean(quote && !quote.is_first_activation);
  const due = isPlanChange
    ? Number(quote?.amount_due ?? 0)
    : plan
      ? Number(plan.monthly_price) * monthCount
      : 0;
  const pending = request?.status === "pending";

  // Everything the existing payment RPC already requires, told up-front.
  const checklist = goLiveChecklist({
    shopName: shopName ?? "shop",
    shopKind: "subscription",
    planId,
    months: Number(months),
    payerNumber,
    reference,
    platformGcashNumber: gcash?.gcash_number ?? methods[0]?.account_number ?? null,
    hasPendingRequest: pending,
    proofPath,
  });
  const fieldErrors = goLiveFieldErrors({
    planId,
    months: Number(months),
    payerNumber,
    reference,
    proofPath,
  });
  const showErrors = attempted;

  const focusItem = (item: { fieldId?: string }) => {
    if (!item.fieldId) return;
    const el = document.getElementById(item.fieldId);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
    (el as HTMLInputElement | null)?.focus?.();
  };

  const tryConfirm = () => {
    setServerError(null);
    setServerField(null);
    setAttempted(true);
    if (methods.length > 1 && !methodId) {
      setServerError("Tap the WaveWallet payment account you paid into.");
      document.getElementById("gl-methods")?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    if (checklist.length > 0) {
      focusItem(checklist.find((i) => i.fieldId) ?? {});
      return;
    }
    setConfirming(true);
  };

  const submit = async () => {
    if (!plan) return;
    setConfirming(false);
    setBusy(true);
    setServerError(null);
    setServerField(null);

    try {
      const r = await submitGoLivePayment({
        ecosystemId,
        planId: plan.id,
        payerNumber,
        reference,
        months: monthCount,
        amountPaid: due,
        proofPath: proofPath as string,
        paymentMethodId: methodId,
      });
      setRequest(r);
      // Second layer: the server reads the same screenshot again and that
      // reading — not anything sent by this browser — is what gets stored.
      try {
        const checked = await verifyGoLiveReceipt({ data: { requestId: r.id } });
        setReceiptNote(RECEIPT_CHECK_LABEL[checked.check] ?? null);
      } catch {
        setReceiptNote("The receipt could not be checked automatically — it goes to manual review.");
      }
      if (r.status === "approved") {
        toast.success("Payment verified — activating your shop now.");
        onLive?.();
      } else {
        toast.success("Payment submitted. It goes live the moment the GCash payment is recognised.");
      }
    } catch (e) {
      const mapped = mapGoLiveError(e instanceof Error ? e.message : "");
      setServerError(mapped.message);
      setServerField(mapped.field ?? null);
      toast.error(mapped.message);
    } finally {
      setBusy(false);
    }
  };

  const errorFor = (field: GoLiveField): string | null => {
    if (serverField === field && serverError) return serverError;
    return showErrors ? (fieldErrors[field] ?? null) : null;
  };

  if (loading) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Loading Go Live details…
      </p>
    );
  }

  return (
    <PageSection devSlot="go-live-card.go-live"
      title="Go Live"
      description="Pick one of the WaveWallet plans and pay it with GCash. Your shop keeps the same login, name and settings — only the Demo label goes away."
    >
      <Card className="shadow-[var(--shadow-card)]">
        <CardContent className="space-y-4 px-4">
          {request?.status === "approved" ? (
            <p
              className={`flex items-center gap-2 text-sm font-medium ${
                isLive === false ? "text-warning" : "text-success"
              }`}
            >
              <CheckCircle2 className="size-4" /> {goLiveStatusLine(request, isLive)}
            </p>
          ) : null}

          {pending ? (
            <div className="rounded-xl border border-warning/40 bg-warning/10 px-3 py-2.5 text-xs leading-relaxed">
              <StatusBadge tone="warning">Awaiting payment verification</StatusBadge>
              <p className="mt-1.5">
                {goLiveStatusLine(request, isLive)} Reference {request?.payment_reference} ·{" "}
                {peso(Number(request?.amount_due ?? 0))}. Your shop activates automatically once the
                platform GCash notification for this exact amount and sending number arrives.
              </p>
            </div>
          ) : (
            <>
              <div id="gl-plans" className="grid gap-2 sm:grid-cols-2">
                {plans.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setPlanId(p.id)}
                    className={`rounded-xl border px-3 py-2.5 text-left transition ${
                      p.id === planId ? "border-primary bg-primary/5" : "border-border"
                    }`}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold">{p.name}</span>
                      <span className="text-sm font-semibold text-primary">
                        {peso(Number(p.monthly_price))}/mo
                      </span>
                    </span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {Number(p.coin_allocation).toLocaleString()} Coins allocation
                      {p.tagline ? ` · ${p.tagline}` : ""}
                    </span>
                  </button>
                ))}
              </div>
              {errorFor("plan") ? (
                <p role="alert" className="text-xs font-medium text-destructive">
                  {errorFor("plan")}
                </p>
              ) : null}

              <div className="space-y-3 rounded-xl border bg-muted/40 px-3 py-3">
                <div>
                  <p className="flex items-center gap-1.5 text-sm font-semibold">
                    <ShieldCheck className="size-4 text-primary" /> Step 1 — Send{" "}
                    <strong>{peso(due)}</strong> to WaveWallet
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    {methods.length > 1
                      ? "Pay using any one of the WaveWallet accounts below, then tap the one you used so we can verify your payment against it."
                      : "Pay using the WaveWallet account below, exactly as shown."}
                    {" "}Scan the QR code or copy the account number — the account name must match before you send.
                  </p>
                </div>

                {methods.length > 0 ? (
                  <div id="gl-methods">
                  <PaymentMethodCards
                    methods={methods}
                    selectedId={methodId}
                    onSelect={(id) => setMethodId(id)}
                  />
                  </div>
                ) : gcash?.gcash_number ? (
                  <div className="rounded-lg border bg-background px-3 py-2 text-xs">
                    <p className="font-semibold">GCash</p>
                    <p className="mt-0.5">
                      {gcash.gcash_number}
                      {gcash.gcash_account_name ? ` \u00b7 ${gcash.gcash_account_name}` : ""}
                    </p>
                    {gcash.payment_instructions ? (
                      <p className="mt-1 whitespace-pre-line text-muted-foreground">
                        {gcash.payment_instructions}
                      </p>
                    ) : null}
                  </div>
                ) : (
                  <p className="text-xs font-medium text-destructive">
                    WaveWallet has not published a payment account yet — please contact support
                    before paying.
                  </p>
                )}

                <div>
                  <p className="text-sm font-semibold">Step 2 — Tell us about that payment</p>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    Pay from your own account first, then enter that exact sending number, copy the
                    reference number from the receipt and attach the receipt screenshot. A payment
                    is recognised automatically only when the details match, and each reference can
                    only ever be used once in any shop.
                  </p>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-1.5">
                  <Label htmlFor="gl-months">Months (1–24)</Label>
                  <Input
                    id="gl-months"
                    inputMode="numeric"
                    aria-invalid={Boolean(errorFor("months"))}
                    className={errorFor("months") ? "border-destructive" : undefined}
                    value={months}
                    onChange={(e) => setMonths(e.target.value)}
                  />
                  {errorFor("months") ? (
                    <p role="alert" className="text-xs font-medium text-destructive">
                      {errorFor("months")}
                    </p>
                  ) : null}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="gl-number">GCash number you paid from</Label>
                  <Input
                    id="gl-number"
                    inputMode="numeric"
                    placeholder="09XXXXXXXXX"
                    aria-invalid={Boolean(errorFor("payerNumber"))}
                    className={errorFor("payerNumber") ? "border-destructive" : undefined}
                    value={payerNumber}
                    onChange={(e) => setPayerNumber(e.target.value)}
                  />
                  {errorFor("payerNumber") ? (
                    <p role="alert" className="text-xs font-medium text-destructive">
                      {errorFor("payerNumber")}
                    </p>
                  ) : null}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="gl-ref">GCash reference number</Label>
                  <Input
                    id="gl-ref"
                    inputMode="numeric"
                    placeholder="Reference number on your receipt"
                    aria-invalid={Boolean(errorFor("reference"))}
                    className={errorFor("reference") ? "border-destructive" : undefined}
                    value={reference}
                    onChange={(e) => setReference(e.target.value)}
                  />
                  {errorFor("reference") ? (
                    <p role="alert" className="text-xs font-medium text-destructive">
                      {errorFor("reference")}
                    </p>
                  ) : null}
                </div>
              </div>


              <div id="gl-proof" className="space-y-1.5">
                <CashInProofPicker
                  file={proofFile}
                  disabled={busy || reading}
                  onPick={(f) => void handlePickProof(f)}
                  onError={(m) => {
                    setServerField("proof");
                    setServerError(m);
                  }}
                />
                {reading ? (
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Loader2 className="size-3.5 animate-spin" /> Reading your receipt…
                  </p>
                ) : null}
                {receiptNote ? (
                  <p className="text-xs text-muted-foreground">{receiptNote}</p>
                ) : null}
                {errorFor("proof") ? (
                  <p role="alert" className="text-xs font-medium text-destructive">
                    {errorFor("proof")}
                  </p>
                ) : null}
              </div>

              {isPlanChange && quote ? (
                <div className="rounded-xl border bg-muted/40 px-3 py-2.5 text-xs leading-relaxed">
                  <p className="font-medium">Plan change summary</p>
                  <p className="mt-1">
                    Current plan: {quote.current_plan_name ?? "—"} ·{" "}
                    {peso(Number(quote.current_monthly_price))}/mo
                  </p>
                  <p>
                    New plan: {quote.new_plan_name} · {peso(Number(quote.new_monthly_price))}/mo
                  </p>
                  <p>
                    Unused value credited: {peso(Number(quote.unused_value))} ·{" "}
                    {quote.days_remaining} day{quote.days_remaining === 1 ? "" : "s"} remaining
                  </p>
                  <p>
                    Coin adjustment: {Number(quote.additional_allocation).toLocaleString()} Coins
                  </p>
                </div>
              ) : null}

              <p className="text-xs text-muted-foreground">
                Total to pay: <strong>{peso(due)}</strong>
                {isPlanChange
                  ? ` after the existing adjustment rules for ${quote?.new_plan_name ?? "the selected plan"}.`
                  : ` for ${monthCount} month${monthCount === 1 ? "" : "s"} of ${plan?.name ?? "the selected plan"}.`}
              </p>

              {showErrors && checklist.length > 0 ? (
                <div
                  role="alert"
                  className="rounded-xl border border-destructive bg-destructive/10 px-3 py-2.5"
                >
                  <p className="flex items-center gap-1.5 text-sm font-semibold text-destructive">
                    <AlertTriangle className="size-4" /> Complete these items before going Live
                  </p>
                  <ul className="mt-2 space-y-1.5">
                    {checklist.map((item) => (
                      <li key={item.id} className="text-xs leading-relaxed text-destructive">
                        {item.fieldId ? (
                          <button
                            type="button"
                            className="text-left font-semibold underline underline-offset-2"
                            onClick={() => focusItem(item)}
                          >
                            {item.label}
                          </button>
                        ) : item.to ? (
                          <Link
                            to={item.to as never}
                            className="font-semibold underline underline-offset-2"
                          >
                            {item.label}
                          </Link>
                        ) : (
                          <span className="font-semibold">{item.label}</span>
                        )}
                        <span className="block text-destructive/90">{item.how}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {serverError && !serverField ? (
                <p role="alert" className="text-xs font-medium text-destructive">
                  {serverError}
                </p>
              ) : null}

              <Button className="w-full" disabled={busy} onClick={tryConfirm}>
                {busy ? (
                  <Loader2 className="mr-1 size-4 animate-spin" />
                ) : (
                  <Rocket className="mr-1 size-4" />
                )}
                {isPlanChange ? "Review and confirm plan change" : "Subscribe & Go Live"}
              </Button>

              <AlertDialog open={confirming} onOpenChange={setConfirming}>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>
                      {isPlanChange ? "Confirm this plan change" : "Confirm this payment"}
                    </AlertDialogTitle>
                    <AlertDialogDescription asChild>
                      <div className="space-y-1 text-left text-sm">
                        {isPlanChange && quote ? (
                          <>
                            <p>
                              From <strong>{quote.current_plan_name ?? "—"}</strong> to{" "}
                              <strong>{quote.new_plan_name}</strong>.
                            </p>
                            <p>Unused value credited: {peso(Number(quote.unused_value))}</p>
                            <p>
                              Coin adjustment:{" "}
                              {Number(quote.additional_allocation).toLocaleString()} Coins
                            </p>
                          </>
                        ) : (
                          <p>
                            {plan?.name} · {monthCount} month{monthCount === 1 ? "" : "s"}
                          </p>
                        )}
                        <p>
                          Amount due: <strong>{peso(due)}</strong> · reference {reference || "—"}
                        </p>
                      </div>
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={submit}>Confirm</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>

            </>
          )}
        </CardContent>
      </Card>
    </PageSection>
  );
}
