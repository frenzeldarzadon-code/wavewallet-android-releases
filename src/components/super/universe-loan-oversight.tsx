import { useCallback, useEffect, useState } from "react";
import { Coins, HandCoins, PiggyBank, TrendingUp, Users } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState, PageSection, StatCard, StatusBadge } from "@/components/ui-kit";
import { LoanIdViewer } from "@/components/wallet/loan-id-document";
import {
  fetchLoanPoolOverview, fetchSuperUniverseLoans, fetchUniverseLoanFunders,
  fetchUniverseLoanPayments, fetchUniverseLoanSchedule, universeLoanStatusLabel,
  universeLoanTone, type LoanPoolOverview, type SuperUniverseLoan,
  type UniverseLoanFunder, type UniverseLoanPaymentRow, type UniverseLoanScheduleRow,
} from "@/lib/universe-loans";
import { peso, shortDateTime } from "@/lib/wavewallet";

export function UniverseLoanOversight() {
  const [overview, setOverview] = useState<LoanPoolOverview | null>(null);
  const [loans, setLoans] = useState<SuperUniverseLoan[]>([]);
  const [selected, setSelected] = useState<SuperUniverseLoan | null>(null);
  const [funders, setFunders] = useState<UniverseLoanFunder[]>([]);
  const [schedule, setSchedule] = useState<UniverseLoanScheduleRow[]>([]);
  const [payments, setPayments] = useState<UniverseLoanPaymentRow[]>([]);
  const [status, setStatus] = useState("all");

  const load = useCallback(async () => {
    try { const [summary, rows] = await Promise.all([fetchLoanPoolOverview(), fetchSuperUniverseLoans(status)]); setOverview(summary); setLoans(rows); }
    catch (error) { toast.error("Could not load Universe Loan oversight", { description: (error as Error).message }); }
  }, [status]);
  useEffect(() => { void load(); }, [load]);

  const open = async (loan: SuperUniverseLoan) => {
    setSelected(loan);
    try { const [funderRows, scheduleRows, paymentRows] = await Promise.all([fetchUniverseLoanFunders(loan.id), fetchUniverseLoanSchedule(loan.id), fetchUniverseLoanPayments(loan.id)]); setFunders(funderRows); setSchedule(scheduleRows); setPayments(paymentRows); }
    catch (error) { toast.error("Could not load this Universe Loan", { description: (error as Error).message }); }
  };

  if (selected) return <UniverseLoanDetail loan={selected} funders={funders} schedule={schedule} payments={payments} onBack={() => setSelected(null)} />;

  return <div className="space-y-6">
    <PageSection title="Universe Loan Pool" description="Read-only oversight. Contributors fund applications; there is no platform approval action.">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Pool total" value={peso(overview?.poolTotal ?? 0)} icon={PiggyBank} tone="brand" />
        <StatCard label="Available" value={peso(overview?.poolAvailable ?? 0)} icon={Coins} tone="positive" />
        <StatCard label="Allocated" value={peso(overview?.poolAllocated ?? 0)} icon={HandCoins} />
        <StatCard label="Contributors" value={String(overview?.contributors ?? 0)} icon={Users} />
        <StatCard label="Principal outstanding" value={peso(overview?.outstandingPrincipal ?? 0)} tone="negative" />
        <StatCard label="Owner interest" value={peso(overview?.ownerInterestCollected ?? 0)} icon={TrendingUp} tone="positive" />
        <StatCard label="Platform fees" value={peso(overview?.platformFeesCollected ?? 0)} tone="positive" />
      </div>
    </PageSection>
    <PageSection title="Universe Loans">
      <select className="mb-3 h-9 rounded-md border border-input bg-background px-2 text-sm" value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Universe Loan status"><option value="all">All statuses</option>{["pending_funding","partially_funded","active","paid","early_paid","cancelled"].map((value) => <option key={value} value={value}>{universeLoanStatusLabel(value)}</option>)}</select>
      {loans.length === 0 ? <EmptyState title="No Universe Loans found" /> : <div className="space-y-2">{loans.map((loan) => <Button key={loan.id} variant="outline" className="h-auto w-full justify-between whitespace-normal p-3 text-left" onClick={() => void open(loan)}><span><span className="block font-semibold">{loan.borrowerName}{loan.borrowerHandle ? ` · @${loan.borrowerHandle}` : ""}</span><span className="block text-xs text-muted-foreground">{peso(loan.amount)} · {loan.termMonths} months · {loan.funderCount} funder(s)</span></span><StatusBadge tone={universeLoanTone(loan.status)}>{universeLoanStatusLabel(loan.status)}</StatusBadge></Button>)}</div>}
    </PageSection>
  </div>;
}

function UniverseLoanDetail({ loan, funders, schedule, payments, onBack }: { loan: SuperUniverseLoan; funders: UniverseLoanFunder[]; schedule: UniverseLoanScheduleRow[]; payments: UniverseLoanPaymentRow[]; onBack: () => void }) {
  return <div className="space-y-5"><Button variant="ghost" onClick={onBack}>Back to all loans</Button><PageSection title={loan.borrowerName} description={`${loan.borrowerHandle ? `@${loan.borrowerHandle} · ` : ""}${universeLoanStatusLabel(loan.status)}`}><Card><CardContent className="grid grid-cols-2 gap-3 p-4 text-xs lg:grid-cols-4"><Figure label="Requested" value={peso(loan.amount)} /><Figure label="Funded" value={peso(loan.fundedAmount)} /><Figure label="Released" value={peso(loan.releasedAmount)} /><Figure label="Principal left" value={peso(loan.principalOutstanding)} /><Figure label="Interest accrued" value={peso(loan.interestAccrued)} /><Figure label="Interest paid" value={peso(loan.interestPaid)} /><Figure label="Interest refunded" value={peso(loan.interestRefunded)} /><Figure label="Platform fee" value={peso(loan.platformFee)} /><Figure label="Owner interest" value={peso(loan.ownerInterest)} /><Figure label="Interest split" value={`${loan.ownerSharePercent}% / ${loan.contributorSharePercent}%`} /><Figure label="Created" value={shortDateTime(loan.createdAt)} /></CardContent></Card><LoanIdViewer path={loan.idDocumentPath} who={loan.borrowerName} /></PageSection>
    <PageSection title="Funders">{funders.length === 0 ? <EmptyState title="No funders yet" /> : <div className="space-y-1.5">{funders.map((funder) => <div key={funder.funderId} className="grid grid-cols-2 gap-2 rounded-lg border p-3 text-xs sm:grid-cols-4"><Figure label="Contributor" value={`${funder.funderName}${funder.funderHandle ? ` · @${funder.funderHandle}` : ""}`} /><Figure label="Funded" value={peso(funder.amount)} /><Figure label="Principal returned" value={peso(funder.principalRepaid)} /><Figure label="Interest earned" value={peso(funder.interestEarned)} /></div>)}</div>}</PageSection>
    <PageSection title="Schedule">{schedule.length === 0 ? <EmptyState title="Schedule starts after full funding" /> : <div className="space-y-1">{schedule.map((row) => <div key={row.periodIndex} className="flex justify-between rounded-lg border px-3 py-2 text-xs"><span>Month {row.periodIndex} · {new Date(`${row.dueDate}T00:00:00`).toLocaleDateString()}</span><span>{peso(row.principalDue)} principal + {peso(row.interestDue)} interest</span></div>)}</div>}</PageSection>
    <PageSection title="Payments and adjustments">{payments.length === 0 ? <EmptyState title="No payments yet" /> : <div className="space-y-1">{payments.map((payment) => <div key={payment.id} className="flex justify-between rounded-lg border px-3 py-2 text-xs"><span className="capitalize">{payment.kind.replaceAll("_", " ")} · {shortDateTime(payment.createdAt)}</span><span>{peso(payment.amount)} · principal left {peso(payment.principalAfter)}</span></div>)}</div>}</PageSection>
  </div>;
}

function Figure({ label, value }: { label: string; value: string }) { return <div><p className="text-muted-foreground">{label}</p><p className="font-semibold tabular-nums">{value}</p></div>; }