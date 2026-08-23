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
  activateFreeSubscription,
  cancelGoLivePayment,
  goLiveControlsVisible,
  goLivePollIntervalMs,
  goLiveStatusLine,
  submitGoLivePayment,
  type SubscriptionRequest,
} from "@/lib/go-live";

import { CashInProofPicker } from "@/components/money/cash-in-proof";
import { uploadCashInProof, removeCashInProof, fetchPaymentMethods, type PaymentMethod } from "@/lib/wallet-money";
import { PaymentMethodCards } from "@/components/money/payment-method-cards";
import { extractCashInReceipt, type ReceiptExtraction } from "@/lib/cash-in-receipt.functions";
import { receiptEvidence } from "@/lib/receipt-evidence";
import { verifyGoLiveReceipt } from "@/lib/go-live-receipt.functions";
import { supabase } from "@/integrations/supabase/client";
import {
  goLiveChecklist,
  goLiveFieldErrors,
  mapGoLiveError,
  type GoLiveField,
} from "@/lib/go-live-readiness";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DURATION_OPTIONS,
  coveragePeriod,
  monthsLabel,
  normalizeMonths,
  subscriptionCharge,
} from "@/lib/subscription-duration";



type Gcash = Awaited<ReturnType<typeof fetchPlatformGcash>>;

const PANEL_NOTE =
  "These details were read from your screenshot. Check they match your receipt before submitting.";

/**
 * What a LIVE shop wants to do with the same existing payment flow:
 *   renew  — pay the current plan again (period is appended, never replaced)
 *   extend — the same, with a longer duration chosen up-front
 *   change — move to another plan the platform owner has published
 * All three end in `submit_go_live_payment` / `activate_free_subscription`.
 */
export type SubscriptionIntent = "renew" | "extend" | "change";

export function GoLiveCard({
  ecosystemId,
  shopName,
  isLive,
  onLive,
  initialIntent = "renew",
}: {
  ecosystemId: string;
  shopName?: string | null;
  /** The shop's own persisted Demo/Live state — the single source of truth. */
  isLive?: boolean;
  onLive?: () => void;
  initialIntent?: SubscriptionIntent;
}) {
  const [intent, setIntent] = useState<SubscriptionIntent>(initialIntent);
  /** The plan this shop is on right now, from its own subscription record. */
  const [currentPlanId, setCurrentPlanId] = useState<string | null>(null);
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
  /** Everything the reader saw — provider-neutral, kept verbatim as evidence. */
  const [extract, setExtract] = useState<ReceiptExtraction | null>(null);
  /** Which autofilled fields the applicant has since edited by hand. */
  const [edited, setEdited] = useState<{ reference: boolean; payerNumber: boolean }>({
    reference: false,
    payerNumber: false,
  });
  const [showRaw, setShowRaw] = useState(false);
  /** Set once the applicant accepts that thin evidence means manual review. */
  const [acceptManual, setAcceptManual] = useState(false);
  /** Set the instant verification succeeds, so the operator sees the win. */
  const [celebrating, setCelebrating] = useState(false);


  /** Upload immediately, then read it with the existing Cash In receipt reader. */
  const handlePickProof = async (file: File | null) => {
    if (proofPath) void removeCashInProof(proofPath).catch(() => {});
    setProofPath(null);
    setExtract(null);
    setEdited({ reference: false, payerNumber: false });
    setAcceptManual(false);
    setShowRaw(false);
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
      setExtract(read);
      // Provider-neutral autofill: whatever this receipt actually printed is
      // used. Nothing is invented, and nothing is prefilled from GCash.
      if (read.reference) setReference(read.reference);
      if (read.senderNumber) setPayerNumber(read.senderNumber);
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
      const [p, g, r, m, sub] = await Promise.all([
        fetchPlans(),
        fetchPlatformGcash(),
        fetchGoLiveRequest(ecosystemId),
        fetchPaymentMethods(true, { ecosystemId: null }).catch(() => [] as PaymentMethod[]),
        // The shop's existing subscription record — the current plan comes
        // from there, never from a guess.
        (async () => {
          const { data } = await supabase
            .from("shop_subscriptions")
            .select("plan_id")
            .eq("ecosystem_id", ecosystemId)
            .maybeSingle();
          return (data?.plan_id as string | null) ?? null;
        })().catch(() => null),

      ]);
      setPlans(p);
      setGcash(g);
      setRequest(r);
      setMethods(m);
      setCurrentPlanId(sub);
      setMethodId((v) => v || (m.length === 1 ? m[0]!.id : null));
      setPlanId((v) => v || sub || p[0]?.id || "");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not load the Go Live details");
    } finally {
      setLoading(false);
    }
  }, [ecosystemId]);


  useEffect(() => {
    void load();
  }, [load]);

  // While a payment is pending, verification completes server-side (a payment
  // notification arrives after the receipt). Watch the request so the live
  // transition happens on its own, with no manual refresh. Realtime plus a
  // slow poll as a fallback; both stop once the request is decided.
  const requestId = request?.id ?? null;
  const requestStatus = request?.status ?? null;
  useEffect(() => {
    const every = goLivePollIntervalMs(request);
    if (!requestId || every <= 0) return;
    let stopped = false;
    const refresh = () => {
      if (stopped) return;
      fetchGoLiveRequest(ecosystemId)
        .then((r) => {
          if (stopped || !r) return;
          setRequest(r);
          if (r.status === "approved") {
            stopped = true;
            setCelebrating(true);
            onLive?.();
          }
        })
        .catch(() => {
          /* transient network trouble — the next tick retries */
        });
    };
    const timer = window.setInterval(refresh, every);
    const channel = supabase
      .channel(`go-live-${requestId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "subscription_requests", filter: `id=eq.${requestId}` },
        refresh,
      )
      .subscribe();
    return () => {
      stopped = true;
      window.clearInterval(timer);
      void supabase.removeChannel(channel);
    };
    // Keyed by id/status only, so a refresh that changes nothing does not
    // tear down and rebuild the subscription.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ecosystemId, requestId, requestStatus, onLive]);

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
  const monthCount = normalizeMonths(months);
  // One card, three named actions — all of them submit through the same
  // existing payment + listener verification flow.
  const submitLabel = !isLive
    ? "Subscribe & Go Live"
    : intent === "change"
      ? "Review and confirm plan change"
      : intent === "extend"
        ? `Extend by ${monthsLabel(normalizeMonths(months))}`
        : `Renew for ${monthsLabel(normalizeMonths(months))}`;
  // Duration always drives the amount: configured monthly price × months.
  // A prorated credit is only subtracted for a REAL plan change (a different
  // plan than the one running) — never for a renewal or an extension.
  const charge = subscriptionCharge({
    monthlyPrice: plan?.monthly_price,
    months: monthCount,
    intent: isLive ? intent : "renew",
    selectedPlanId: planId,
    quote,
  });
  const lineTotal = charge.baseAmount;
  const due = charge.amountDue;
  const isPlanChange = charge.creditApplied > 0;
  // What the payment buys. An early renewal is appended to the period that is
  // still running, exactly like the database does on activation.
  const currentEnd =
    quote && quote.days_remaining > 0
      ? new Date(Date.now() + quote.days_remaining * 86_400_000)
      : null;
  const coverage = coveragePeriod(currentEnd, monthCount);

  // Zero-priced = deliberately free. Nothing is charged, so no payment fields,
  // no reference and no screenshot. The database enforces the same rule.
  const isFree = Boolean(plan) && charge.noPaymentRequired;


  const pending = request?.status === "pending";
  // How much INDEPENDENT evidence the screenshot itself produced. This never
  // approves anything — the platform listener and the database rules still
  // decide — it only tells the applicant what was read and what is missing.
  const evidence = receiptEvidence(extract, { expectedAmountPhp: due > 0 ? due : null });
  const thinEvidence = Boolean(proofPath && extract && !evidence.sufficient);

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
    if (thinEvidence && !acceptManual) {
      setServerError(
        "We could not read enough from this screenshot. Upload a clearer receipt, or tick the box below to submit it for review instead.",
      );
      document.getElementById("gl-evidence")?.scrollIntoView({ behavior: "smooth", block: "center" });
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
        // Server-side receipt verification still runs exactly as before; its
        // outcome is deliberately not surfaced to the applicant.
        await verifyGoLiveReceipt({ data: { requestId: r.id } });
      } catch {
        /* verification outcome is never shown to the applicant */
      }
      if (r.status === "approved") {
        setCelebrating(true);
        toast.success("Congratulations! Your shop is now LIVE.");
        onLive?.();
      } else {
        toast.success("Payment submitted — verification in progress.");
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

  /**
   * Withdraw a payment that is still waiting for verification, so the operator
   * is never locked out of Renew / Extend / Change by a payment that will
   * never complete. Verified or already-activated payments are refused by the
   * database — this never touches the listener or matching rules.
   */
  const cancelPending = async () => {
    if (!request) return;
    setBusy(true);
    setServerError(null);
    try {
      await cancelGoLivePayment(request.id);
      toast.success("That pending payment was withdrawn.");
      await load();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "That payment could not be withdrawn.";
      setServerError(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  const activateFree = async () => {

    if (!plan) return;
    setBusy(true);
    setServerError(null);
    try {
      await activateFreeSubscription({ ecosystemId, planId: plan.id, months: monthCount });
      setCelebrating(true);
      toast.success("Congratulations! Your shop is now LIVE.");
      onLive?.();
      await load();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "That could not be activated.";
      setServerError(msg);
      toast.error(msg);
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
      title={isLive ? "Renew, extend or change your plan" : "Go Live"}
      description={
        isLive
          ? "These are the plans WaveWallet currently offers. Renew or extend your current plan, or move to another one — your shop, login and settings stay exactly as they are."
          : "Pick one of the WaveWallet plans and pay it with GCash. Your shop keeps the same login, name and settings — only the Demo label goes away."
      }
    >

      <Card className="shadow-[var(--shadow-card)]">
        <CardContent className="space-y-4 px-4">
          {request?.status === "approved" ? (
            celebrating || isLive !== false ? (
              <div className="rounded-xl border border-success/40 bg-success/10 px-3 py-2.5">
                <p className="flex items-center gap-2 text-sm font-semibold text-success">
                  <CheckCircle2 className="size-4" /> Congratulations! Your shop is now LIVE.
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Taking you to your live shop…
                </p>
              </div>
            ) : (
              <p className="flex items-center gap-2 text-sm font-medium text-warning">
                <CheckCircle2 className="size-4" /> {goLiveStatusLine(request, isLive)}
              </p>
            )
          ) : null}

          {pending ? (
            <div className="rounded-xl border border-warning/40 bg-warning/10 px-3 py-2.5 text-xs leading-relaxed">
              <StatusBadge tone="warning">Verification in progress</StatusBadge>
              <p className="mt-1.5">
                Payment submitted — verification in progress. Your subscription will activate after
                verification is completed.
              </p>
              <p className="mt-1.5 text-muted-foreground">
                This only applies to that one payment
                {request?.payment_reference ? ` (reference ${request.payment_reference})` : ""}. If
                you did not make it, or it will never be completed, you can withdraw it and submit
                a new one.
              </p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="mt-2"
                disabled={busy}
                onClick={cancelPending}
              >
                {busy ? <Loader2 className="mr-1 size-4 animate-spin" /> : null}
                Withdraw this pending payment
              </Button>
            </div>
          ) : null}

          {goLiveControlsVisible(request, isLive) ? (
            <>

              {isLive ? (
                /* A live shop manages the SAME subscription from here: renew
                   it, extend it for longer, or move to another published
                   plan. All three use this one existing payment flow. */
                <div className="space-y-2 rounded-xl border bg-muted/40 px-3 py-3">
                  <p className="text-sm font-semibold">What would you like to do?</p>
                  <div className="grid gap-2 sm:grid-cols-3">
                    {(
                      [
                        ["renew", "Renew", "Pay the current plan again"],
                        ["extend", "Extend plan", "Add more months up-front"],
                        ["change", "Change plan", "Move to another plan"],
                      ] as const
                    ).map(([value, label, hint]) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => {
                          setIntent(value);
                          if (value !== "change" && currentPlanId) setPlanId(currentPlanId);
                        }}
                        className={`rounded-xl border px-3 py-2 text-left transition ${
                          intent === value ? "border-primary bg-primary/5" : "border-border"
                        }`}
                      >
                        <span className="block text-sm font-semibold">{label}</span>
                        <span className="block text-xs text-muted-foreground">{hint}</span>
                      </button>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Current plan:{" "}
                    <strong>
                      {plans.find((p) => p.id === currentPlanId)?.name ??
                        plan?.name ??
                        "not recorded"}
                    </strong>
                    {intent === "change"
                      ? " — pick the plan you want below."
                      : intent === "extend"
                        ? " — choose how many extra months to add below."
                        : " — choose how many months to renew for below."}
                  </p>
                </div>
              ) : null}

              <div id="gl-plans" className="grid gap-2 sm:grid-cols-2">
                {plans
                  .filter(
                    (p) =>
                      !(isLive && currentPlanId && intent !== "change") || p.id === currentPlanId,
                  )
                  .map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setPlanId(p.id)}
                    className={`rounded-xl border px-3 py-2.5 text-left transition ${
                      p.id === planId ? "border-primary bg-primary/5" : "border-border"
                    }`}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-1.5 text-sm font-semibold">
                        {p.name}
                        {p.id === currentPlanId ? (
                          <StatusBadge tone="brand">Current plan</StatusBadge>
                        ) : null}
                      </span>
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

              {/* Duration + exact total — nothing is estimated: the amount is
                  the plan's configured monthly price × the chosen duration
                  (or, for a plan change, the server's own prorated quote). */}
              <div className="space-y-3 rounded-xl border bg-background px-3 py-3">
                <div className="space-y-1.5">
                  <Label htmlFor="gl-months">
                    {isLive && intent === "extend"
                      ? "How many extra months do you want to add?"
                      : isLive && intent === "renew"
                        ? "How many months do you want to renew for?"
                        : "How long are you paying for?"}
                  </Label>
                  <Select value={String(monthCount)} onValueChange={(v) => setMonths(v)}>
                    <SelectTrigger
                      id="gl-months"
                      aria-invalid={Boolean(errorFor("months"))}
                      className={errorFor("months") ? "border-destructive" : undefined}
                    >
                      <SelectValue placeholder="Choose a duration" />
                    </SelectTrigger>
                    <SelectContent className="max-h-64">
                      {DURATION_OPTIONS.map((m) => (
                        <SelectItem key={m} value={String(m)}>
                          {monthsLabel(m)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {errorFor("months") ? (
                    <p role="alert" className="text-xs font-medium text-destructive">
                      {errorFor("months")}
                    </p>
                  ) : null}
                </div>

                {plan ? (
                  <dl className="space-y-1 text-xs">
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted-foreground">Package</dt>
                      <dd className="font-medium">{plan.name}</dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted-foreground">Price per month</dt>
                      <dd className="font-medium">{peso(Number(plan.monthly_price))}</dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted-foreground">Duration</dt>
                      <dd className="font-medium">{monthsLabel(monthCount)}</dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted-foreground">
                        {peso(Number(plan.monthly_price))} × {monthCount}
                      </dt>
                      <dd className="font-medium">{peso(lineTotal)}</dd>
                    </div>
                    {charge.creditApplied > 0 ? (
                      <div className="flex justify-between gap-3">
                        <dt className="text-muted-foreground">Plan change credit applied</dt>
                        <dd className="font-medium">−{peso(charge.creditApplied)}</dd>
                      </div>
                    ) : null}
                    <div className="flex justify-between gap-3 border-t pt-1.5 text-sm">
                      <dt className="font-semibold">Total amount due</dt>
                      <dd className="font-bold text-primary">{peso(due)}</dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted-foreground">Period being purchased</dt>
                      <dd className="font-medium">
                        {coverage.start.toLocaleDateString()} – {coverage.end.toLocaleDateString()}
                      </dd>
                    </div>
                    {coverage.extendsExisting ? (
                      <p className="pt-1 text-[11px] leading-relaxed text-muted-foreground">
                        Your current period is still running — this payment is added on top of it,
                        it does not replace it.
                      </p>
                    ) : null}
                  </dl>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Pick a package above to see the exact total for this duration.
                  </p>
                )}
              </div>

              {isFree ? (
                /* Zero-priced subscription — the platform owner set this shop or
                   plan to no charge, so no payment is requested at all. */
                <div className="space-y-3 rounded-xl border border-success/40 bg-success/5 px-3 py-3">
                  <p className="flex items-center gap-1.5 text-sm font-semibold text-success">
                    <CheckCircle2 className="size-4" /> No payment required
                  </p>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    This subscription is set to no monthly charge. There is nothing to send, no
                    reference number and no screenshot — just activate it. It will not expire or be
                    frozen for non-payment while it stays free.
                  </p>
                  {serverError ? (
                    <p role="alert" className="text-xs font-medium text-destructive">
                      {serverError}
                    </p>
                  ) : null}
                  <Button className="w-full" disabled={busy || !plan || pending} onClick={activateFree}>
                    {busy ? (
                      <Loader2 className="mr-1 size-4 animate-spin" />
                    ) : (
                      <Rocket className="mr-1 size-4" />
                    )}
                    Activate free subscription
                  </Button>
                </div>
              ) : (
                <>




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
                    reference number from the receipt and attach the receipt screenshot.
                  </p>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">

                <div className="space-y-1.5">
                  <Label htmlFor="gl-number">Account number or mobile number you paid from</Label>
                  <Input
                    id="gl-number"
                    inputMode="numeric"
                    placeholder="Account number or mobile number"
                    aria-invalid={Boolean(errorFor("payerNumber"))}
                    className={errorFor("payerNumber") ? "border-destructive" : undefined}
                    value={payerNumber}
                    onChange={(e) => {
                      setPayerNumber(e.target.value);
                      if (extract?.senderNumber) setEdited((v) => ({ ...v, payerNumber: true }));
                    }}
                  />
                  {extract ? (
                    <p className="text-[11px] text-muted-foreground">
                      {extract.senderNumber
                        ? edited.payerNumber
                          ? `You changed this. Read from the screenshot: ${extract.senderNumber}`
                          : "Read from your screenshot."
                        : "Not printed on your screenshot — enter it yourself."}
                    </p>
                  ) : null}
                  {errorFor("payerNumber") ? (
                    <p role="alert" className="text-xs font-medium text-destructive">
                      {errorFor("payerNumber")}
                    </p>
                  ) : null}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="gl-ref">Reference / transaction number</Label>
                  <Input
                    id="gl-ref"
                    inputMode="numeric"
                    placeholder="Reference number on your receipt"
                    aria-invalid={Boolean(errorFor("reference"))}
                    className={errorFor("reference") ? "border-destructive" : undefined}
                    value={reference}
                    onChange={(e) => {
                      setReference(e.target.value);
                      if (extract?.reference) setEdited((v) => ({ ...v, reference: true }));
                    }}
                  />
                  {extract ? (
                    <p className="text-[11px] text-muted-foreground">
                      {extract.reference
                        ? edited.reference
                          ? `You changed this. Read from the screenshot: ${extract.reference}`
                          : "Read from your screenshot."
                        : "Not readable on your screenshot — enter it yourself."}
                    </p>
                  ) : null}
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
                {extract ? (
                  <div
                    id="gl-evidence"
                    className={`space-y-2 rounded-xl border px-3 py-2.5 ${
                      evidence.sufficient ? "border-success/40 bg-success/5" : "border-warning/50 bg-warning/5"
                    }`}
                  >
                    <p className="text-sm font-semibold">Payment details detected from screenshot</p>
                    <dl className="space-y-1 text-xs">
                      {[
                        ["Provider", extract.providerName],
                        ["Reference / transaction no.", extract.reference],
                        ["Amount", extract.amountPhp === null ? null : peso(extract.amountPhp)],
                        ["Fee", extract.feePhp === null || extract.feePhp === undefined ? null : peso(extract.feePhp)],
                        ["Paid from", extract.senderNumber ?? extract.senderAccountMasked ?? extract.senderName],
                        [
                          "Paid to",
                          extract.receivingNumber ?? extract.receivingAccountMasked ?? extract.receivingName,
                        ],
                        ["Method", extract.transferMethod],
                        ["Status", extract.statusText],
                        ["Date / time", extract.paidAt],
                      ].map(([label, value]) => (
                        <div key={label as string} className="flex justify-between gap-3">
                          <dt className="text-muted-foreground">{label}</dt>
                          <dd className={value ? "font-medium" : "text-muted-foreground"}>
                            {(value as string) || "not detected"}
                          </dd>
                        </div>
                      ))}
                    </dl>
                    <p className="text-xs leading-relaxed text-muted-foreground">{PANEL_NOTE}</p>
                    {extract.rawText ? (
                      <>
                        <button
                          type="button"
                          className="text-xs font-semibold underline underline-offset-2"
                          onClick={() => setShowRaw((v) => !v)}
                        >
                          {showRaw ? "Hide all text read" : "Show all text read from the screenshot"}
                        </button>
                        {showRaw ? (
                          <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-md bg-muted/60 p-2 text-[11px] leading-relaxed">
                            {extract.rawText}
                          </pre>
                        ) : null}
                      </>
                    ) : null}
                    {thinEvidence ? (
                      <label className="flex items-start gap-2 text-xs leading-relaxed">
                        <input
                          type="checkbox"
                          className="mt-0.5"
                          checked={acceptManual}
                          onChange={(e) => setAcceptManual(e.target.checked)}
                        />
                        <span>
                          Submit anyway — I understand this payment will wait for review.
                        </span>
                      </label>
                    ) : null}
                  </div>
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

              {pending ? (
                <p className="text-xs font-medium text-warning">
                  Withdraw the payment awaiting verification above before submitting another one.
                </p>
              ) : null}

              <Button className="w-full" disabled={busy || pending} onClick={tryConfirm}>
                {busy ? (
                  <Loader2 className="mr-1 size-4 animate-spin" />
                ) : (
                  <Rocket className="mr-1 size-4" />
                )}
                {submitLabel}
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

            </>
          ) : null}

        </CardContent>
      </Card>
    </PageSection>
  );
}
