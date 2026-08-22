/**
 * Cash out / Cash in — shared by customer, subreseller, reseller and admin.
 *
 * Everything financial is server-authorized: this screen only previews numbers
 * from the live platform valuation and shows the immutable snapshot the
 * database stored for each request. Money moves only when the platform owner
 * releases it.
 */
import { useOnline } from "@/lib/pwa";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDownToLine, ArrowUpFromLine, Clock, Info } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState, PageSection, StatCard, StatusBadge } from "@/components/ui-kit";
import { FacebookSupportCard } from "@/components/facebook-support-card";
import { PaymentMethodCards } from "@/components/money/payment-method-cards";
import { fetchPlatformPaymentOption } from "@/lib/platform-payment-option";
import { CashInProofPicker, CashInProofViewer } from "@/components/money/cash-in-proof";
import {
  extractCashInReceipt,
  verifyCashInReceipt,
  type ReceiptExtraction,
} from "@/lib/cash-in-receipt.functions";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/lib/session";
import { peso, shortDateTime } from "@/lib/wavewallet";
import { fetchCreditBalance } from "@/lib/wallet";
import { fetchPlatformSettings, type PlatformSettings } from "@/lib/subscription";
import {
  cancelCashIn,
  cancelWithdrawal,
  creditsAfterFee,
  fetchMoneySettings,
  fetchMyCashIns,
  fetchMyWithdrawals,
  fetchPaymentMethods,
  MONEY_SETTINGS_FALLBACK,
  PAYMENT_MODES,
  paymentModeLabel,
  quoteCashInBreakdown,
  quoteWithdrawal,
  cashInOutcomeMessage,
  requestCashIn,
  requestWithdrawal,
  snapshotQuote,
  statusLabel,
  removeCashInProof,
  uploadCashInProof,
  validateCashIn,
  validateCashInProof,
  validateWithdrawal,
  WITHDRAWAL_SLA_NOTICE,
  CASH_IN_FUNDINGS,
  CASH_OUT_PATHS,
  cashInFundingLabel,
  cashOutFeePercent,
  cashOutPathLabel,
  EMPTY_CAPACITY,
  fetchAdminCashInCapacity,
  maxAdminCashInPhp,
  type AdminCashInCapacity,
  type CashInFunding,
  type CashOutPath,
  type CashInRequest,
  type MoneySettings,
  type PaymentMethod,
  type PaymentMode,
  type WithdrawalRequest,
} from "@/lib/wallet-money";

const tone = (status: string) =>
  status === "released" || status === "approved"
    ? ("success" as const)
    : status === "pending"
      ? ("warning" as const)
      : ("danger" as const);

const newKey = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random()}`;

/** ISO instant -> value a <input type="datetime-local"> understands (local time). */
const toLocalInput = (iso: string | null): string => {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/** datetime-local value -> ISO instant, or null when it is empty or invalid. */
const fromLocalInput = (value: string): string | null => {
  if (!value) return null;
  const t = Date.parse(value);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
};

/**
 * `initialTab` only picks which tab opens first — the request flows,
 * accounting and approval rules are unchanged and shared by every role.
 */
export function MoneyPage({ initialTab = "out" }: { initialTab?: "in" | "out" } = {}) {
  const { account, ecosystemDbId } = useSession();
  const userId = account?.id ?? null;
  const [settings, setSettings] = useState<MoneySettings>(MONEY_SETTINGS_FALLBACK);
  const [platform, setPlatform] = useState<PlatformSettings | null>(null);
  const [balance, setBalance] = useState(0);
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [withdrawals, setWithdrawals] = useState<WithdrawalRequest[]>([]);
  const [cashIns, setCashIns] = useState<CashInRequest[]>([]);
  const [busy, setBusy] = useState(false);
  const online = useOnline();

  /**
   * Only members below the shop admin can be settled by their admin — an admin
   * (or the platform owner) has no upline inside the shop to hand them cash.
   */
  const shopPathsAvailable = account?.role !== "admin" && account?.role !== "super_admin";

  // cash out form
  const [credits, setCredits] = useState("");
  const [mode, setMode] = useState<PaymentMode>("ewallet");
  const [accountName, setAccountName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [notes, setNotes] = useState("");
  const [cashOutPath, setCashOutPath] = useState<CashOutPath>("superadmin");

  // cash in form
  const [methodId, setMethodId] = useState<string>("");
  const [amount, setAmount] = useState("");
  const [payerRef, setPayerRef] = useState("");
  const [payerNumber, setPayerNumber] = useState("");
  const [cashInNotes, setCashInNotes] = useState("");
  const [funding, setFunding] = useState<CashInFunding>("platform");
  const [capacity, setCapacity] = useState<AdminCashInCapacity>(EMPTY_CAPACITY);
  /** Required supporting evidence — kept for audit and manual review. */
  const [proofFile, setProofFile] = useState<File | null>(null);
  /** Uploaded straight away so the receipt can be read before submitting. */
  const [proofPath, setProofPath] = useState<string | null>(null);
  const [extracting, setExtracting] = useState(false);
  /** What the receipt reader saw — evidence, never a verification from GCash. */
  const [extract, setExtract] = useState<ReceiptExtraction | null>(null);
  /** Payment date/time the member confirms, as a datetime-local value. */
  const [paidAt, setPaidAt] = useState("");

  const load = useCallback(async () => {
    if (!userId) return;
    const [s, p, b, m, w, c, cap] = await Promise.all([
      fetchMoneySettings(),
      fetchPlatformSettings(),
      fetchCreditBalance(userId, ecosystemDbId),
      // Only the shop's own listener-associated receiving accounts are offered to
      // payers. Platform-wide accounts are WaveWallet's own collection accounts and
      // appear only for a legacy shop that explicitly opted into them.
      ecosystemDbId
        ? fetchPlatformPaymentOption(ecosystemDbId)
            .then((opt) =>
              fetchPaymentMethods(true, {
                ecosystemId: ecosystemDbId,
                includeGlobal: opt.enabled,
              }),
            )
            .catch(() => [])
        : Promise.resolve([]),
      fetchMyWithdrawals(userId).catch(() => []),
      fetchMyCashIns(userId).catch(() => []),
      fetchAdminCashInCapacity(ecosystemDbId).catch(() => EMPTY_CAPACITY),
    ]);
    setSettings(s);
    setPlatform(p);
    setBalance(b);
    setMethods(m);
    setWithdrawals(w);
    setCashIns(c);
    setCapacity(cap);
  }, [userId, ecosystemDbId]);

  useEffect(() => {
    void load();
  }, [load]);

  const creditsNum = Number(credits);
  const feePercent = cashOutFeePercent(cashOutPath, settings);
  const quote = useMemo(() => quoteWithdrawal(creditsNum || 0, settings), [creditsNum, settings]);
  const cashInQuote = useMemo(
    () => quoteCashInBreakdown(Number(amount) || 0, settings),
    [amount, settings],
  );
  /** Highest peso amount the shop admin can still fund right now. */
  const adminMaxPhp = useMemo(() => maxAdminCashInPhp(capacity, settings), [capacity, settings]);
  const canUseAdminFunding = shopPathsAvailable && Boolean(capacity.adminId);
  const needsAccount = PAYMENT_MODES.find((m) => m.value === mode)?.needsAccount ?? false;

  if (!account) return null;

  const submitWithdrawal = async () => {
    const problem = validateWithdrawal(
      { credits: creditsNum, mode, accountName, accountNumber },
      balance,
    );
    if (problem) {
      toast.error(problem);
      return;
    }
    const payoutLine =
      cashOutPath === "admin"
        ? `No fee · your shop admin hands you ${creditsNum.toLocaleString()} coins worth of cash.`
        : `Cash out fee ${feePercent}% · you receive ${creditsAfterFee(creditsNum, feePercent).toLocaleString()} coins worth of payout.`;
    if (
      !window.confirm(
        `Cash out ${creditsNum.toLocaleString()} coins via ${cashOutPathLabel(cashOutPath)}?\n\n${payoutLine}\n\n${WITHDRAWAL_SLA_NOTICE}`,
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      await requestWithdrawal({
        credits: creditsNum,
        mode,
        accountName: needsAccount ? accountName : null,
        accountNumber: needsAccount ? accountNumber : null,
        notes,
        requestKey: newKey(),
        path: cashOutPath,
      });
      toast.success(
        cashOutPath === "admin"
          ? "Cash out request submitted for your shop admin to settle."
          : "Cash out request submitted for platform owner review.",
      );
      setCredits("");
      setNotes("");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not submit that request.");
    } finally {
      setBusy(false);
    }
  };

  /** Upload the screenshot immediately, then read it so the form can be filled. */
  const handlePickProof = async (file: File | null) => {
    if (proofPath) void removeCashInProof(proofPath).catch(() => {});
    setProofPath(null);
    setExtract(null);
    setPayerRef("");
    setPayerNumber("");
    setPaidAt("");
    setAmount("");
    setProofFile(file);
    if (!file) return;
    setExtracting(true);
    try {
      // Storage RLS scopes the folder to the SIGNED IN user, which can differ
      // from the acted-on member, so the real auth id owns the object.
      const { data: authUser } = await supabase.auth.getUser();
      const ownerId = authUser?.user?.id;
      if (!ownerId) throw new Error("Your session expired. Sign in again to attach a screenshot.");
      const path = await uploadCashInProof(ownerId, file);
      setProofPath(path);
      const read = await extractCashInReceipt({ data: { proofPath: path } });
      setExtract(read);
      if (read.reference) setPayerRef(read.reference);
      if (read.amountPhp) setAmount(String(read.amountPhp));
      if (read.senderNumber) setPayerNumber(read.senderNumber);
      if (read.paidAt) setPaidAt(toLocalInput(read.paidAt));
      if (read.readable) toast.success("Screenshot read — check the details before you submit.");
      else toast.info("We could not read this screenshot clearly. You can still submit it for manual review.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not read that screenshot.");
    } finally {
      setExtracting(false);
    }
  };

  const submitCashIn = async () => {
    const problem = validateCashIn(Number(amount), methodId || null, {
      hasProof: Boolean(proofPath),
      payerNumber,
    });

    if (problem) {
      toast.error(problem);
      return;
    }
    // The server re-checks this under a lock; this is only a friendlier warning.
    if (funding === "admin" && Number(amount) > adminMaxPhp) {
      toast.error(`Your shop admin can only fund up to ${peso(adminMaxPhp)} right now.`);
      return;
    }
    setBusy(true);
    try {
      const submitted = await requestCashIn({
        methodId,
        amountPhp: Number(amount),
        // A GCash send receipt never prints the payer's own number, so this is
        // the number stated by the member — never their saved profile phone.
        payerNumber: extract?.senderNumber ?? payerNumber,

        payerReference: payerRef,
        paidAt: fromLocalInput(paidAt),
        ocr: extract
          ? {
              reference: extract.reference,
              providerName: extract.providerName,
              amountPhp: extract.amountPhp,
              senderNumber: extract.senderNumber,
              senderName: extract.senderName,
              senderAccountMasked: extract.senderAccountMasked,
              paidAt: extract.paidAt,
              confidence: extract.confidence,
              readable: extract.readable,
            }
          : null,
        notes: cashInNotes,
        proofPath: proofPath as string,
        requestKey: newKey(),
        funding,
      });
      // Second layer: the server reads the very same screenshot again and that
      // reading — not anything the browser sent — decides the receipt check.
      let decided = submitted;
      if (submitted.status === "pending" && !submitted.duplicate_reference) {
        try {
          const verified = await verifyCashInReceipt({ data: { cashInId: submitted.id } });
          decided = { ...submitted, status: verified.status, receipt_check: verified.check } as typeof submitted;
        } catch {
          // A reader outage must never approve or reject anything on its own.
          decided = { ...submitted, receipt_check: "error" } as typeof submitted;
        }
      }
      const outcome = cashInOutcomeMessage(decided);
      if (outcome.tone === "error") toast.error(outcome.message);
      else if (outcome.tone === "success") toast.success(outcome.message);
      else toast.info(outcome.message);

      if (decided.status !== "rejected") {
        setAmount("");
        setPayerRef("");
        setPayerNumber("");
        setPaidAt("");
        setCashInNotes("");
        setProofFile(null);
        setProofPath(null);
        setExtract(null);
      }
      await load();
    } catch (e) {
      // The screenshot stays uploaded so the member can correct and resubmit.
      toast.error(e instanceof Error ? e.message : "Could not submit that request.");
    } finally {
      setBusy(false);
    }
  };

  const selectedMethod = methods.find((m) => m.id === methodId) ?? null;

  return (
    <>
      <PageSection
        title="Cash out & cash in"
        description={`Cash in fee ${settings.cashInFeePercent}% · cash out fee ${settings.feePercent}%. Balances and requests are shown in coins.`}
      >
        <div className="grid gap-3 sm:grid-cols-3">
          <StatCard
            label="Coin balance"
            value={`${balance.toLocaleString()} coins`}
            icon={ArrowUpFromLine}
            tone="brand"
          />
          <StatCard
            label="Pending requests"
            value={String(
              withdrawals.filter((w) => w.status === "pending" || w.status === "approved").length +
                cashIns.filter((c) => c.status === "pending").length,
            )}
            icon={Clock}
          />
        </div>
      </PageSection>

      <Tabs defaultValue={initialTab} className="mb-6">
        <TabsList>
          <TabsTrigger value="out">Cash out</TabsTrigger>
          <TabsTrigger value="in">Cash in</TabsTrigger>
        </TabsList>

        <TabsContent value="out" className="mt-4 space-y-4">
          <Card className="shadow-[var(--shadow-card)]">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <ArrowUpFromLine className="size-4 text-primary" /> Request a withdrawal
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {shopPathsAvailable ? (
                <div className="space-y-1.5">
                  <Label>Who settles this cash out</Label>
                  <RadioGroup
                    value={cashOutPath}
                    onValueChange={(v) => setCashOutPath(v as CashOutPath)}
                    className="gap-2"
                  >
                    {CASH_OUT_PATHS.map((p) => (
                      <label
                        key={p.value}
                        htmlFor={`wd-path-${p.value}`}
                        className="flex cursor-pointer items-start gap-2 rounded-lg border border-border p-3 text-xs"
                      >
                        <RadioGroupItem id={`wd-path-${p.value}`} value={p.value} className="mt-0.5" />
                        <span>
                          <span className="block text-sm font-medium">{p.label}</span>
                          <span className="text-muted-foreground">{p.hint}</span>
                        </span>
                      </label>
                    ))}
                  </RadioGroup>
                </div>
              ) : null}
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="wd-credits">Coins to cash out</Label>
                  <Input
                    id="wd-credits"
                    inputMode="numeric"
                    value={credits}
                    onChange={(e) => setCredits(e.target.value)}
                    placeholder="100"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="wd-mode">Mode of payment</Label>
                  <Select value={mode} onValueChange={(v) => setMode(v as PaymentMode)}>
                    <SelectTrigger id="wd-mode">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PAYMENT_MODES.map((m) => (
                        <SelectItem key={m.value} value={m.value}>
                          {m.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {needsAccount ? (
                  <>
                    <div className="space-y-1.5">
                      <Label htmlFor="wd-acct-name">Account name</Label>
                      <Input id="wd-acct-name" value={accountName} onChange={(e) => setAccountName(e.target.value)} />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="wd-acct-no">Account number</Label>
                      <Input id="wd-acct-no" value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} />
                    </div>
                  </>
                ) : null}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="wd-notes">Additional information</Label>
                <Textarea
                  id="wd-notes"
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder={mode === "physical_cash" ? "Pickup place and preferred time" : "Anything the platform owner should know"}
                />
              </div>

              <div className="rounded-lg border border-border bg-muted/40 p-3 text-xs">
                <p className="font-medium">
                  {(creditsNum || 0).toLocaleString()} credits requested · {cashOutPathLabel(cashOutPath)}
                </p>
                <p className="text-muted-foreground">
                  {cashOutPath === "admin" ? (
                    <>
                      No fee · your shop admin hands you{" "}
                      <span className="font-semibold text-foreground">
                        {(creditsNum || 0).toLocaleString()} credits
                      </span>{" "}
                      worth of cash
                    </>
                  ) : (
                    <>
                      Fee {feePercent}% · you receive{" "}
                      <span className="font-semibold text-foreground">
                        {creditsAfterFee(creditsNum || 0, feePercent).toLocaleString()} credits
                      </span>{" "}
                      worth of payout
                    </>
                  )}
                </p>
                <p className="mt-1 flex items-start gap-1 text-muted-foreground">
                  <Info className="mt-0.5 size-3 shrink-0" />{" "}
                  {cashOutPath === "admin"
                    ? "Your shop admin reviews and settles this personally. Your coins are held until they approve it."
                    : WITHDRAWAL_SLA_NOTICE}
                </p>
              </div>

              <Button onClick={submitWithdrawal} disabled={busy || !online}>
                {busy ? "Submitting…" : "Request cash out"}
              </Button>
            </CardContent>
          </Card>

          <PageSection title="My withdrawal requests">
            {withdrawals.length === 0 ? (
              <EmptyState title="No withdrawals yet" description="Your cash out history will appear here." />
            ) : (
              <div className="space-y-2">
                {withdrawals.map((w) => {
                  const q = snapshotQuote(w);
                  return (
                    <Card key={w.id} className="shadow-[var(--shadow-card)]">
                      <CardContent className="flex flex-wrap items-start justify-between gap-3 px-4 py-3 text-xs">
                        <div>
                          <p className="text-sm font-semibold">
                            {Number(w.credits).toLocaleString()} credits
                          </p>
                          <p className="text-muted-foreground">
                            {w.reference} · fee {q.feePercent}% · payout{" "}
                            {creditsAfterFee(Number(w.credits), q.feePercent).toLocaleString()} credits
                          </p>
                          <p className="text-muted-foreground">
                            {paymentModeLabel(w.payment_mode)}
                            {w.account_name ? ` · ${w.account_name}` : ""} · {shortDateTime(w.created_at)}
                          </p>
                          {w.decision_reason ? (
                            <p className="text-muted-foreground">Note: {w.decision_reason}</p>
                          ) : null}
                        </div>
                        <div className="flex items-center gap-2">
                          <StatusBadge tone={tone(w.status)}>{statusLabel(w.status)}</StatusBadge>
                          {w.status === "pending" ? (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={busy}
                              onClick={async () => {
                                setBusy(true);
                                try {
                                  await cancelWithdrawal(w.id);
                                  toast.success("Request cancelled — your coins were returned.");
                                  await load();
                                } catch (e) {
                                  toast.error(e instanceof Error ? e.message : "Could not cancel.");
                                } finally {
                                  setBusy(false);
                                }
                              }}
                            >
                              Cancel
                            </Button>
                          ) : null}
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </PageSection>
        </TabsContent>

        <TabsContent value="in" className="mt-4 space-y-4">
          <PageSection
            title="Where to send your payment"
            description="Pay to one of the accounts below, then submit your cash in request with the reference number."
          >
            <PaymentMethodCards methods={methods} selectedId={methodId} onSelect={setMethodId} />
          </PageSection>

          <Card className="shadow-[var(--shadow-card)]">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <ArrowDownToLine className="size-4 text-success" /> Cash in
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
                Start with your GCash payment screenshot — we read the amount, the sending number, the reference and the
                payment date and time from it. Check the details, correct the reference or the date and time if needed,
                then submit. The screenshot is supporting evidence, not a verification from GCash: coins are added only
                once a real GCash notification confirms the payment.
              </p>
              {methods.length === 0 ? (
                <EmptyState
                  title="No payment methods available"
                  description="This shop has not published any receiving accounts yet. Ask the shop admin to add one in Listener payment settings."
                />
              ) : (
                <>
                  {canUseAdminFunding ? (
                    <div className="space-y-1.5">
                      <Label>Who you paid</Label>
                      <RadioGroup
                        value={funding}
                        onValueChange={(v) => setFunding(v as CashInFunding)}
                        className="gap-2"
                      >
                        {CASH_IN_FUNDINGS.map((f) => (
                          <label
                            key={f.value}
                            htmlFor={`ci-funding-${f.value}`}
                            className="flex cursor-pointer items-start gap-2 rounded-lg border border-border p-3 text-xs"
                          >
                            <RadioGroupItem id={`ci-funding-${f.value}`} value={f.value} className="mt-0.5" />
                            <span>
                              <span className="block text-sm font-medium">{f.label}</span>
                              <span className="text-muted-foreground">
                                {f.value === "admin"
                                  ? `Up to ${peso(adminMaxPhp)} right now${capacity.adminName ? ` · ${capacity.adminName}` : ""}`
                                  : f.hint}
                              </span>
                            </span>
                          </label>
                        ))}
                      </RadioGroup>
                    </div>
                  ) : null}
                  <div className="space-y-1.5">
                    <Label htmlFor="ci-method">Payment method</Label>
                    <Select value={methodId} onValueChange={setMethodId}>
                      <SelectTrigger id="ci-method">
                        <SelectValue placeholder="Choose a method" />
                      </SelectTrigger>
                      <SelectContent>
                        {methods.map((m) => (
                          <SelectItem key={m.id} value={m.id}>
                            {m.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <CashInProofPicker
                    file={proofFile}
                    onPick={(f) => void handlePickProof(f)}
                    disabled={busy || extracting}
                    onError={(m) => toast.error(m)}
                  />

                  {extracting ? (
                    <p className="rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
                      Reading your screenshot…
                    </p>
                  ) : null}

                  {proofPath && !extracting ? (
                    <div className="space-y-3 rounded-lg border border-border p-3">
                      <p className="text-xs font-medium">Details read from your screenshot</p>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="space-y-1.5">
                          <Label htmlFor="ci-amount">Amount paid (₱)</Label>
                          <Input
                            id="ci-amount"
                            inputMode="decimal"
                            value={amount}
                            readOnly={Boolean(extract?.amountPhp)}
                            disabled={Boolean(extract?.amountPhp)}
                            onChange={(e) => setAmount(e.target.value)}
                          />
                          <p className="text-[11px] text-muted-foreground">
                            {extract?.amountPhp
                              ? "Extracted evidence — not editable."
                              : "Not readable on the screenshot. Anything you enter is unverified and this request stays in manual review."}
                          </p>
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor="ci-number">GCash number you paid from</Label>
                          <Input
                            id="ci-number"
                            inputMode="tel"
                            value={payerNumber}
                            readOnly={Boolean(extract?.senderNumber)}
                            disabled={Boolean(extract?.senderNumber)}
                            onChange={(e) => setPayerNumber(e.target.value)}
                            placeholder="09XXXXXXXXX"
                          />
                          <p className="text-[11px] text-muted-foreground">
                            {extract?.senderNumber
                              ? "Extracted evidence — matched against the real GCash notification."
                              : "GCash receipts do not print your own number, so type the number you paid from. It is matched against the real GCash notification."}
                          </p>
                        </div>

                        <div className="space-y-1.5">
                          <Label htmlFor="ci-ref">GCash reference number</Label>
                          <Input
                            id="ci-ref"
                            value={payerRef}
                            onChange={(e) => setPayerRef(e.target.value)}
                            placeholder="Reference / transaction number"
                          />
                          <p className="text-[11px] text-muted-foreground">
                            Verify / correct if needed. The original reading is kept as evidence.
                          </p>
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor="ci-paid-at">Payment date and time</Label>
                          <Input
                            id="ci-paid-at"
                            type="datetime-local"
                            value={paidAt}
                            onChange={(e) => setPaidAt(e.target.value)}
                          />
                          <p className="text-[11px] text-muted-foreground">
                            Verify / correct if needed. The original reading is kept as evidence.
                          </p>
                        </div>
                      </div>
                      {extract && !extract.readable ? (
                        <p className="text-[11px] text-muted-foreground">
                          We could not read this screenshot reliably, so nothing was guessed. You may still submit it — a
                          person will review it.
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                  {selectedMethod ? (
                    <PaymentMethodCards methods={[selectedMethod]} selectedId={selectedMethod.id} />
                  ) : null}
                  <div className="space-y-1.5">
                    <Label htmlFor="ci-notes">Additional notes (optional)</Label>
                    <Textarea
                      id="ci-notes"
                      rows={2}
                      value={cashInNotes}
                      onChange={(e) => setCashInNotes(e.target.value)}
                      placeholder="Anything the platform owner should know (optional)"
                    />
                  </div>

                  <div className="space-y-1 rounded-lg border border-border bg-muted/40 p-3 text-xs">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Amount you are paying</span>
                      <span className="font-medium">{peso(cashInQuote.gross)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">
                        Cash in fee ({cashInQuote.feePercent}%)
                      </span>
                      <span className="font-medium text-destructive">-{peso(cashInQuote.fee)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Net amount converted</span>
                      <span className="font-medium">{peso(cashInQuote.net)}</span>
                    </div>
                    <div className="flex justify-between border-t border-border pt-1">
                      <span className="text-muted-foreground">You will receive</span>
                      <span className="font-semibold text-success">
                        {cashInQuote.credits.toLocaleString()} credits
                      </span>
                    </div>
                    <p className="text-muted-foreground">
                      Coins are issued only after the platform owner verifies your payment. This fee is locked
                      in when you submit.
                    </p>
                  </div>
                  <Button onClick={submitCashIn} disabled={busy || !online}>
                    {busy ? "Submitting…" : "Submit cash in"}
                  </Button>
                </>
              )}
            </CardContent>
          </Card>

          <PageSection title="My cash in requests">
            {cashIns.length === 0 ? (
              <EmptyState title="No cash in requests yet" />
            ) : (
              <div className="space-y-2">
                {cashIns.map((c) => (
                  <Card key={c.id} className="shadow-[var(--shadow-card)]">
                    <CardContent className="flex flex-wrap items-start justify-between gap-3 px-4 py-3 text-xs">
                      <div>
                        <p className="text-sm font-semibold">
                          {Number(c.credits).toLocaleString()} credits
                        </p>
                        <p className="text-muted-foreground">
                          {c.reference} · {c.method_name} · {shortDateTime(c.created_at)}
                        </p>
                        <p className="text-muted-foreground">
                          Paid {peso(Number(c.amount_php))} · fee {Number(c.fee_percent ?? 0)}% (
                          {peso(Number(c.fee_php ?? 0))}) · net {peso(Number(c.net_php ?? c.amount_php))}
                        </p>
                        <p className="text-muted-foreground">
                          From {c.sender_number ?? c.payer_number ?? "—"} · ref {c.payer_reference ?? "—"} ·{" "}
                          {c.approval_method === "automatic" ? "automatic" : "manual"} review
                        </p>
                        {c.notes ? <p className="text-muted-foreground">Notes: {c.notes}</p> : null}
                        {c.decision_reason ? <p className="text-muted-foreground">Note: {c.decision_reason}</p> : null}
                        <CashInProofViewer path={c.proof_path} />
                      </div>
                      <div className="flex items-center gap-2">
                        <StatusBadge tone={tone(c.status)}>{statusLabel(c.status)}</StatusBadge>
                        {c.status === "pending" ? (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy}
                            onClick={async () => {
                              setBusy(true);
                              try {
                                await cancelCashIn(c.id);
                                await load();
                              } catch (e) {
                                toast.error(e instanceof Error ? e.message : "Could not cancel.");
                              } finally {
                                setBusy(false);
                              }
                            }}
                          >
                            Cancel
                          </Button>
                        ) : null}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </PageSection>
        </TabsContent>
      </Tabs>

      <FacebookSupportCard
        url={platform?.support_page_url ?? null}
        pageName={platform?.support_page_name ?? null}
        title="Need this faster?"
        message="Message the platform owner's Facebook page for withdrawal and cash in inquiries."
      />
    </>
  );
}
