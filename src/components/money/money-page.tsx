/**
 * Cash out / Cash in — shared by customer, subreseller, reseller and admin.
 *
 * Everything financial is server-authorized: this screen only previews numbers
 * from the live platform valuation and shows the immutable snapshot the
 * database stored for each request. Money moves only when the platform owner
 * releases it.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDownToLine, ArrowUpFromLine, Clock, Info } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { CashInProofPicker, CashInProofViewer } from "@/components/money/cash-in-proof";
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
  requestCashIn,
  requestWithdrawal,
  snapshotQuote,
  statusLabel,
  validateCashIn,
  validateWithdrawal,
  WITHDRAWAL_SLA_NOTICE,
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

  // cash out form
  const [credits, setCredits] = useState("");
  const [mode, setMode] = useState<PaymentMode>("ewallet");
  const [accountName, setAccountName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [notes, setNotes] = useState("");

  // cash in form
  const [methodId, setMethodId] = useState<string>("");
  const [amount, setAmount] = useState("");
  const [payerRef, setPayerRef] = useState("");
  const [cashInNotes, setCashInNotes] = useState("");
  /** Optional supporting proof — a cash in never requires it. */
  const [proofFile, setProofFile] = useState<File | null>(null);

  const load = useCallback(async () => {
    if (!userId) return;
    const [s, p, b, m, w, c] = await Promise.all([
      fetchMoneySettings(),
      fetchPlatformSettings(),
      fetchCreditBalance(userId, ecosystemDbId),
      fetchPaymentMethods(true).catch(() => []),
      fetchMyWithdrawals(userId).catch(() => []),
      fetchMyCashIns(userId).catch(() => []),
    ]);
    setSettings(s);
    setPlatform(p);
    setBalance(b);
    setMethods(m);
    setWithdrawals(w);
    setCashIns(c);
  }, [userId, ecosystemDbId]);

  useEffect(() => {
    void load();
  }, [load]);

  const creditsNum = Number(credits);
  const quote = useMemo(() => quoteWithdrawal(creditsNum || 0, settings), [creditsNum, settings]);
  const cashInQuote = useMemo(
    () => quoteCashInBreakdown(Number(amount) || 0, settings),
    [amount, settings],
  );
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
    if (
      !window.confirm(
        `Cash out ${creditsNum.toLocaleString()} credits?\n\nWithdrawal fee ${quote.feePercent}% · you receive ${creditsAfterFee(creditsNum, quote.feePercent).toLocaleString()} credits worth of payout.\n\n${WITHDRAWAL_SLA_NOTICE}`,
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
      });
      toast.success("Cash out request submitted for platform owner review.");
      setCredits("");
      setNotes("");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not submit that request.");
    } finally {
      setBusy(false);
    }
  };

  const submitCashIn = async () => {
    const problem = validateCashIn(Number(amount), methodId || null);
    if (problem) {
      toast.error(problem);
      return;
    }
    if (proofFile) {
      const badImage = validateCashInProof(proofFile);
      if (badImage) {
        toast.error(badImage);
        return;
      }
    }
    setBusy(true);
    let uploadedPath: string | null = null;
    try {
      if (proofFile) {
        // Storage RLS scopes the folder to the SIGNED IN user, which can differ
        // from the acted-on member, so the real auth id owns the object.
        const { data: authUser } = await supabase.auth.getUser();
        const ownerId = authUser?.user?.id;
        if (!ownerId) throw new Error("Your session expired. Sign in again to attach a screenshot.");
        uploadedPath = await uploadCashInProof(ownerId, proofFile);
      }
      await requestCashIn({
        methodId,
        amountPhp: Number(amount),
        payerReference: payerRef,
        notes: cashInNotes,
        proofPath: uploadedPath,
        requestKey: newKey(),
      });
      toast.success("Cash in submitted. Credits are added only after the payment is verified.");
      setAmount("");
      setPayerRef("");
      setCashInNotes("");
      setProofFile(null);
      await load();
    } catch (e) {
      // Never leave an orphan screenshot behind when the request itself failed.
      if (uploadedPath) await removeCashInProof(uploadedPath).catch(() => {});
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
        description={`Cash in fee ${settings.cashInFeePercent}% · cash out fee ${settings.feePercent}%. Balances and requests are shown in credits.`}
      >
        <div className="grid gap-3 sm:grid-cols-3">
          <StatCard
            label="Credit balance"
            value={`${balance.toLocaleString()} credits`}
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
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="wd-credits">Credits to cash out</Label>
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
                  {(creditsNum || 0).toLocaleString()} credits requested
                </p>
                <p className="text-muted-foreground">
                  Fee {quote.feePercent}% · you receive{" "}
                  <span className="font-semibold text-foreground">
                    {creditsAfterFee(creditsNum || 0, quote.feePercent).toLocaleString()} credits
                  </span>{" "}
                  worth of payout
                </p>
                <p className="mt-1 flex items-start gap-1 text-muted-foreground">
                  <Info className="mt-0.5 size-3 shrink-0" /> {WITHDRAWAL_SLA_NOTICE}
                </p>
              </div>

              <Button onClick={submitWithdrawal} disabled={busy}>
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
                                  toast.success("Request cancelled — your credits were returned.");
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
              {methods.length === 0 ? (
                <EmptyState
                  title="No payment methods available"
                  description="The platform owner has not published any cash in methods yet."
                />
              ) : (
                <>
                  <div className="grid gap-3 sm:grid-cols-2">
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
                    <div className="space-y-1.5">
                      <Label htmlFor="ci-amount">Amount you are paying (₱)</Label>
                      <Input id="ci-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="ci-ref">Payment reference</Label>
                      <Input id="ci-ref" value={payerRef} onChange={(e) => setPayerRef(e.target.value)} placeholder="Receipt / transaction number" />
                    </div>
                  </div>
                  <CashInProofPicker
                    file={proofFile}
                    onPick={setProofFile}
                    disabled={busy}
                    onError={(m) => toast.error(m)}
                  />
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
                      Credits are issued only after the platform owner verifies your payment. This fee is locked
                      in when you submit.
                    </p>
                  </div>
                  <Button onClick={submitCashIn} disabled={busy}>
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
                        {c.decision_reason ? <p className="text-muted-foreground">Note: {c.decision_reason}</p> : null}
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
