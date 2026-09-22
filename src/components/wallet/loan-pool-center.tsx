import { useCallback, useEffect, useState } from "react";
import { Coins, HandCoins, PiggyBank, TrendingUp } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EmptyState, PageSection, StatCard, StatusBadge } from "@/components/ui-kit";
import { notifyWalletChanged } from "@/lib/wallet-events";
import { peso, shortDateTime } from "@/lib/wavewallet";
import {
  contributeToLoanPool,
  fetchLoanPoolHistory,
  fetchLoanPoolSummary,
  fetchMyFundedUniverseLoans,
  fetchOpenUniverseLoans,
  fundUniverseLoan,
  universeLoanStatusLabel,
  universeLoanTone,
  withdrawFromLoanPool,
  type FundedUniverseLoan,
  type LoanPoolEntry,
  type LoanPoolSummary,
  type OpenUniverseLoan,
} from "@/lib/universe-loans";

export function LoanPoolCenter() {
  const [summary, setSummary] = useState<LoanPoolSummary | null>(null);
  const [openLoans, setOpenLoans] = useState<OpenUniverseLoan[]>([]);
  const [fundedLoans, setFundedLoans] = useState<FundedUniverseLoan[]>([]);
  const [history, setHistory] = useState<LoanPoolEntry[]>([]);
  const [moveAmount, setMoveAmount] = useState("");
  const [fundAmounts, setFundAmounts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  const load = useCallback(async () => {
    try {
      const [pool, applications, funded, entries] = await Promise.all([
        fetchLoanPoolSummary(), fetchOpenUniverseLoans(), fetchMyFundedUniverseLoans(), fetchLoanPoolHistory(),
      ]);
      setSummary(pool);
      setOpenLoans(applications);
      setFundedLoans(funded);
      setHistory(entries);
    } catch (error) {
      toast.error("Could not load the Loan Pool", { description: (error as Error).message });
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const move = async (direction: "contribute" | "withdraw") => {
    const amount = Number(moveAmount) || 0;
    if (amount <= 0) {
      toast.error("Enter an amount greater than zero.");
      return;
    }
    setBusy(direction);
    try {
      const moved = direction === "contribute"
        ? await contributeToLoanPool(amount)
        : await withdrawFromLoanPool(amount);
      toast.success(direction === "contribute" ? `${peso(moved)} added to the Loan Pool.` : `${peso(moved)} returned to your wallet.`);
      setMoveAmount("");
      await load();
      notifyWalletChanged();
    } catch (error) {
      toast.error((error as Error).message);
    } finally { setBusy(null); }
  };

  const fund = async (loan: OpenUniverseLoan) => {
    const amount = Number(fundAmounts[loan.id]) || 0;
    if (amount <= 0) {
      toast.error("Enter the amount you want to fund.");
      return;
    }
    setBusy(loan.id);
    try {
      const committed = await fundUniverseLoan(loan.id, amount);
      toast.success(`${peso(committed)} committed to ${loan.borrowerName}'s loan.`);
      setFundAmounts((values) => ({ ...values, [loan.id]: "" }));
      await load();
    } catch (error) {
      toast.error((error as Error).message);
    } finally { setBusy(null); }
  };

  if (!ready) return null;
  if (!summary) return <EmptyState title="Loan Pool unavailable" description="Please try again." />;

  return (
    <div className="pb-8">
      <PageSection title="Loan Pool" description="Member-funded coins available for Universe Loans.">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Pool balance" value={peso(summary.poolTotal)} icon={PiggyBank} tone="brand" />
          <StatCard label="Available to lend" value={peso(summary.poolAvailable)} icon={Coins} tone="positive" />
          <StatCard label="Allocated" value={peso(summary.poolAllocated)} icon={HandCoins} hint="Reserved for open loans" />
          <StatCard label="My interest earned" value={peso(summary.interestEarned)} icon={TrendingUp} tone="positive" />
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
          <Figure label="My contribution" value={peso(summary.contributed)} />
          <Figure label="My available" value={peso(summary.available)} />
          <Figure label="My allocated" value={peso(summary.allocated)} />
        </div>
      </PageSection>

      <PageSection title="Manage my pool funds" description={`Universe wallet available: ${peso(summary.walletBalance)}`}>
        <Card className="shadow-[var(--shadow-card)]"><CardContent className="space-y-3 p-4">
          <div className="space-y-1.5"><Label htmlFor="pool-amount">Amount</Label><Input id="pool-amount" inputMode="decimal" value={moveAmount} onChange={(event) => setMoveAmount(event.target.value)} /></div>
          <div className="grid grid-cols-2 gap-2">
            <Button disabled={busy !== null} onClick={() => void move("contribute")}>Contribute</Button>
            <Button variant="outline" disabled={busy !== null || summary.available <= 0} onClick={() => void move("withdraw")}>Withdraw available</Button>
          </div>
          <p className="text-xs text-muted-foreground">Allocated funds stay reserved until the loan releases or is cancelled. Only available funds can return to your wallet.</p>
        </CardContent></Card>
      </PageSection>

      <PageSection title="Open loan applications" description="Funding releases only after the full requested amount is committed.">
        {openLoans.length === 0 ? <EmptyState title="No applications need funding" /> : <div className="space-y-3">
          {openLoans.map((loan) => {
            const percent = loan.amount > 0 ? Math.min(100, (loan.fundedAmount / loan.amount) * 100) : 0;
            return <Card key={loan.id} className="shadow-[var(--shadow-card)]"><CardContent className="space-y-3 p-4">
              <div className="flex items-start justify-between gap-3"><div><p className="font-semibold">{loan.borrowerName}</p><p className="text-xs text-muted-foreground">{loan.borrowerHandle ? `@${loan.borrowerHandle} · ` : ""}{loan.termMonths} months · {loan.interestPercent}% monthly</p></div><StatusBadge tone={universeLoanTone(loan.status)}>{universeLoanStatusLabel(loan.status)}</StatusBadge></div>
              <div><div className="mb-1 flex justify-between text-xs"><span>{peso(loan.fundedAmount)} funded</span><span>{peso(loan.remaining)} needed</span></div><progress className="h-2 w-full accent-primary" max={100} value={percent} aria-label={`${Math.round(percent)}% funded`} /></div>
              {loan.myFunded > 0 ? <p className="text-xs text-success">You have funded {peso(loan.myFunded)}.</p> : null}
              <div className="flex gap-2"><Input aria-label={`Amount to fund for ${loan.borrowerName}`} inputMode="decimal" placeholder={String(Math.min(loan.remaining, summary.available))} value={fundAmounts[loan.id] ?? ""} onChange={(event) => setFundAmounts((values) => ({ ...values, [loan.id]: event.target.value }))} /><Button disabled={busy !== null || summary.available <= 0} onClick={() => void fund(loan)}>Fund</Button></div>
            </CardContent></Card>;
          })}
        </div>}
      </PageSection>

      <PageSection title="Loans I funded">
        {fundedLoans.length === 0 ? <EmptyState title="You have not funded a loan yet" /> : <div className="space-y-2">{fundedLoans.map((loan) => <div key={loan.loanId} className="rounded-lg border bg-card p-3 text-xs"><div className="flex justify-between gap-2"><span className="font-semibold">{loan.borrowerName} · {peso(loan.myFunded)}</span><StatusBadge tone={universeLoanTone(loan.status)}>{universeLoanStatusLabel(loan.status)}</StatusBadge></div><p className="mt-1 text-muted-foreground">Principal returned {peso(loan.myPrincipalRepaid)} · interest earned {peso(loan.myInterestEarned)}</p></div>)}</div>}
      </PageSection>

      <PageSection title="My pool activity">
        {history.length === 0 ? <EmptyState title="No pool activity yet" /> : <div className="space-y-1.5">{history.map((entry) => <div key={entry.id} className="flex justify-between gap-3 rounded-lg border px-3 py-2 text-xs"><span><span className="font-medium capitalize">{entry.kind.replaceAll("_", " ")}</span><span className="block text-muted-foreground">{shortDateTime(entry.createdAt)}</span></span><span className="text-right tabular-nums">{peso(entry.amount)}<span className="block text-muted-foreground">available {peso(entry.availableAfter)}</span></span></div>)}</div>}
      </PageSection>
    </div>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg border bg-card p-2"><p className="text-muted-foreground">{label}</p><p className="mt-1 font-semibold tabular-nums">{value}</p></div>;
}