import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays, Coins, HandCoins, ReceiptText } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EmptyState, PageSection, StatCard, StatusBadge } from "@/components/ui-kit";
import { LoanIdPicker, LoanIdViewer } from "@/components/wallet/loan-id-document";
import { supabase } from "@/integrations/supabase/client";
import { removeLoanIdDocument, uploadLoanIdDocument } from "@/lib/coin-loans";
import {
  amortizationSchedule,
  applyForUniverseLoan,
  cancelUniverseLoan,
  fetchMyUniverseLoans,
  fetchUniverseLoanPayments,
  fetchUniverseLoanSchedule,
  fetchUniverseLoanSettings,
  payUniverseLoan,
  totalScheduledInterest,
  universeLoanStatusLabel,
  universeLoanTone,
  type UniverseLoan,
  type UniverseLoanPaymentRow,
  type UniverseLoanScheduleRow,
  type UniverseLoanSettings,
} from "@/lib/universe-loans";
import { notifyWalletChanged } from "@/lib/wallet-events";
import { peso, shortDateTime } from "@/lib/wavewallet";

export function UniverseLoanCenter() {
  const [settings, setSettings] = useState<UniverseLoanSettings | null>(null);
  const [loans, setLoans] = useState<UniverseLoan[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [schedule, setSchedule] = useState<UniverseLoanScheduleRow[]>([]);
  const [payments, setPayments] = useState<UniverseLoanPaymentRow[]>([]);
  const [amount, setAmount] = useState("");
  const [term, setTerm] = useState(3);
  const [idFile, setIdFile] = useState<File | null>(null);
  const [payAmount, setPayAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [token, setToken] = useState(() => crypto.randomUUID());
  const [ready, setReady] = useState(false);

  const load = useCallback(async () => {
    try {
      const [configuration, rows] = await Promise.all([fetchUniverseLoanSettings(), fetchMyUniverseLoans()]);
      setSettings(configuration);
      setLoans(rows);
      setSelectedId((current) => current ?? rows[0]?.id ?? null);
      if (!configuration.terms.includes(term)) setTerm(configuration.terms[0] ?? 3);
    } catch (error) {
      toast.error("Could not load Universe Loans", { description: (error as Error).message });
    } finally { setReady(true); }
  }, [term]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!selectedId) { setSchedule([]); setPayments([]); return; }
    void Promise.all([fetchUniverseLoanSchedule(selectedId), fetchUniverseLoanPayments(selectedId)])
      .then(([scheduleRows, paymentRows]) => { setSchedule(scheduleRows); setPayments(paymentRows); })
      .catch((error) => toast.error("Could not load loan details", { description: (error as Error).message }));
  }, [selectedId, loans]);

  const requested = Number(amount) || 0;
  const preview = useMemo(
    () => amortizationSchedule(requested, settings?.interestPercent ?? 0, term),
    [requested, settings?.interestPercent, term],
  );
  const previewInterest = totalScheduledInterest(preview);
  const previewFee = Math.round(requested * (settings?.platformFeePercent ?? 0)) / 100;
  const selected = loans.find((loan) => loan.id === selectedId) ?? null;
  const hasOpenLoan = loans.some((loan) => ["pending_funding", "partially_funded", "fully_funded", "active"].includes(loan.status));

  const apply = async () => {
    if (requested <= 0) {
      toast.error("Enter an amount greater than zero.");
      return;
    }
    if (!idFile) {
      toast.error("Attach a photo of your valid ID to continue.");
      return;
    }
    setBusy(true);
    let uploaded: string | null = null;
    try {
      const { data } = await supabase.auth.getUser();
      if (!data.user?.id) throw new Error("Please sign in again.");
      uploaded = await uploadLoanIdDocument(data.user.id, idFile);
      await applyForUniverseLoan({ amount: requested, termMonths: term, idPath: uploaded, clientToken: token });
      toast.success("Loan application sent to the Loan Pool for funding.");
      setAmount(""); setIdFile(null); setToken(crypto.randomUUID());
      await load();
    } catch (error) {
      if (uploaded) await removeLoanIdDocument(uploaded).catch(() => undefined);
      toast.error((error as Error).message);
    } finally { setBusy(false); }
  };

  const cancel = async (loanId: string) => {
    setBusy(true);
    try { await cancelUniverseLoan(loanId); toast.success("Loan application cancelled and allocated funds returned."); await load(); }
    catch (error) { toast.error((error as Error).message); }
    finally { setBusy(false); }
  };

  const pay = async (value: number, early = false) => {
    if (value <= 0) {
      toast.error("Enter an amount greater than zero.");
      return;
    }
    setBusy(true);
    try {
      const paid = await payUniverseLoan(value);
      toast.success(early ? `${peso(paid)} paid toward early settlement.` : `${peso(paid)} payment recorded.`);
      setPayAmount(""); await load(); notifyWalletChanged();
    } catch (error) { toast.error((error as Error).message); }
    finally { setBusy(false); }
  };

  if (!ready) return null;
  if (!settings) return <EmptyState title="Universe Loans unavailable" description="Please try again." />;

  return <div className="pb-8">
    <PageSection title="Universe Loan" description="Peer-funded by Loan Pool contributors. Fully funded loans become normal Universe coins.">
      {selected ? <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Requested" value={peso(selected.amount)} icon={HandCoins} />
        <StatCard label="Funded" value={peso(selected.fundedAmount)} icon={Coins} tone="brand" />
        <StatCard label="Principal left" value={peso(selected.principalOutstanding)} icon={ReceiptText} tone={selected.principalOutstanding > 0 ? "negative" : "positive"} />
        <StatCard label="Monthly payment" value={peso(selected.monthlyPayment)} icon={CalendarDays} />
      </div> : <EmptyState title="No Universe Loan yet" description="Preview your payment schedule below before applying." />}
    </PageSection>

    {selected ? <PageSection title="My latest application">
      <Card className="shadow-[var(--shadow-card)]"><CardContent className="space-y-3 p-4 text-sm">
        <div className="flex items-center justify-between gap-2"><span>{shortDateTime(selected.createdAt)} · {selected.termMonths} months</span><StatusBadge tone={universeLoanTone(selected.status)}>{universeLoanStatusLabel(selected.status)}</StatusBadge></div>
        {selected.status === "pending_funding" || selected.status === "partially_funded" ? <><p className="text-xs text-muted-foreground">{peso(selected.fundedAmount)} of {peso(selected.amount)} funded. Nothing releases until funding reaches 100%.</p><Button variant="outline" size="sm" disabled={busy} onClick={() => void cancel(selected.id)}>Cancel application</Button></> : null}
        {selected.status === "active" ? <><p className="text-xs text-muted-foreground">You received {peso(selected.releasedAmount)} after the {peso(selected.platformFee)} platform fee. These are unrestricted Universe coins.</p><div className="flex gap-2"><Input aria-label="Loan payment amount" inputMode="decimal" value={payAmount} onChange={(event) => setPayAmount(event.target.value)} /><Button disabled={busy} onClick={() => void pay(Number(payAmount) || 0)}>Pay</Button></div><Button variant="outline" className="w-full" disabled={busy} onClick={() => void pay(selected.principalOutstanding + Math.max(selected.interestAccrued - selected.interestPaid, 0), true)}>Pay current balance early</Button></> : null}
        <LoanIdViewer path={selected.idDocumentPath} label="View the ID you sent" />
      </CardContent></Card>
    </PageSection> : null}

    {!hasOpenLoan && settings.enabled ? <PageSection title="Apply for a Universe Loan" description="Choose a term and review every payment before confirming.">
      <Card className="shadow-[var(--shadow-card)]"><CardContent className="space-y-4 p-4">
        <div className="space-y-1.5"><Label htmlFor="universe-loan-amount">Requested amount</Label><Input id="universe-loan-amount" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} /></div>
        <div className="space-y-1.5"><Label>Term</Label><div className="grid grid-cols-3 gap-2">{settings.terms.map((months) => <Button key={months} type="button" variant={term === months ? "default" : "outline"} onClick={() => setTerm(months)}>{months} months</Button>)}</div></div>
        <LoanIdPicker file={idFile} onPick={setIdFile} disabled={busy} onError={(message) => toast.error(message)} />
        {requested > 0 ? <div className="rounded-lg border p-3 text-xs"><div className="grid grid-cols-2 gap-2"><Figure label="Total interest" value={peso(previewInterest)} /><Figure label="Total repayment" value={peso(requested + previewInterest)} /><Figure label="Monthly payment" value={peso(preview[0]?.payment ?? 0)} /><Figure label="You receive" value={peso(requested - previewFee)} /></div><p className="mt-2 text-muted-foreground">{settings.interestPercent}% monthly reducing balance · {settings.platformFeePercent}% platform fee</p></div> : null}
        <Button className="h-11 w-full" disabled={busy || requested <= 0 || !idFile} onClick={() => void apply()}>Confirm and submit</Button>
      </CardContent></Card>
      {preview.length > 0 ? <Schedule rows={preview.map((row) => ({ periodIndex: row.period, dueDate: `Month ${row.period}`, principalDue: row.principal, interestDue: row.interest, totalDue: row.payment }))} preview /> : null}
    </PageSection> : !settings.enabled && !hasOpenLoan ? <EmptyState title="New Universe Loans are paused" /> : null}

    {schedule.length > 0 ? <PageSection title="Payment schedule"><Schedule rows={schedule} /></PageSection> : null}
    {payments.length > 0 ? <PageSection title="Payments and adjustments"><div className="space-y-1.5">{payments.map((payment) => <div key={payment.id} className="flex justify-between gap-3 rounded-lg border px-3 py-2 text-xs"><span className="capitalize">{payment.kind.replaceAll("_", " ")}<span className="block text-muted-foreground">{shortDateTime(payment.createdAt)}{payment.note ? ` · ${payment.note}` : ""}</span></span><span className="text-right tabular-nums">{peso(payment.amount)}<span className="block text-muted-foreground">principal left {peso(payment.principalAfter)}</span></span></div>)}</div></PageSection> : null}
    {loans.length > 1 ? <PageSection title="Previous Universe Loans"><div className="space-y-2">{loans.map((loan) => <Button key={loan.id} variant={loan.id === selectedId ? "secondary" : "outline"} className="h-auto w-full justify-between py-3" onClick={() => setSelectedId(loan.id)}><span>{peso(loan.amount)} · {shortDateTime(loan.createdAt)}</span><span>{universeLoanStatusLabel(loan.status)}</span></Button>)}</div></PageSection> : null}
  </div>;
}

function Figure({ label, value }: { label: string; value: string }) { return <div><p className="text-muted-foreground">{label}</p><p className="font-semibold tabular-nums">{value}</p></div>; }

function Schedule({ rows, preview = false }: { rows: UniverseLoanScheduleRow[]; preview?: boolean }) {
  return <div className="overflow-x-auto rounded-lg border"><table className="w-full min-w-[480px] text-xs"><thead className="bg-muted"><tr><th className="p-2 text-left">Month</th><th className="p-2 text-right">Principal</th><th className="p-2 text-right">Interest</th><th className="p-2 text-right">Payment</th></tr></thead><tbody>{rows.map((row) => <tr key={row.periodIndex} className="border-t"><td className="p-2">{preview ? row.dueDate : new Date(`${row.dueDate}T00:00:00`).toLocaleDateString()}</td><td className="p-2 text-right tabular-nums">{peso(row.principalDue)}</td><td className="p-2 text-right tabular-nums">{peso(row.interestDue)}</td><td className="p-2 text-right font-semibold tabular-nums">{peso(row.totalDue)}</td></tr>)}</tbody></table></div>;
}