/**
 * Platform owner → Loans. Read-only monitoring of the existing coin loan
 * system: it reads `coin_loans` / `coin_loan_entries` through Super-Admin-only
 * database functions and never writes a financial record. Approving or
 * declining a pending request still happens with the existing control on the
 * Platform settings page.
 */
import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, Coins, HandCoins, PiggyBank, Search, TrendingUp, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EmptyState, PageSection, StatCard, StatusBadge } from "@/components/ui-kit";
import { MemberPicker } from "@/components/member-picker";
import type { MemberSearchResult } from "@/lib/member-admin";
import { useSession } from "@/lib/session";
import { peso, shortDateTime } from "@/lib/wavewallet";
import { loanEntryLabel, loanStatusLabel } from "@/lib/coin-loans";
import { LoanIdViewer } from "@/components/wallet/loan-id-document";
import {
  LOAN_ENTRY_KINDS,
  borrowerName,
  fetchLoanEntries,
  fetchLoanStats,
  fetchLoanTransactions,
  fetchSuperLoans,
  createManualLoan,
  originLabel,
  loanTone,
  owedBreakdown,
  roleLabel,
  sortTransactions,
  type LoanSort,
  type LoanStats,
  type SuperLoan,
  type SuperLoanEntry,
  type SuperLoanTransaction,
} from "@/lib/super-loans";

const STATUSES = [
  { value: "all", label: "All" },
  { value: "pending", label: "Waiting for approval" },
  { value: "active", label: "Active" },
  { value: "settled", label: "Fully repaid" },
  { value: "rejected", label: "Declined" },
  { value: "cancelled", label: "Cancelled" },
];

const SORTS: { value: LoanSort; label: string }[] = [
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "amount-high", label: "Largest amount" },
  { value: "amount-low", label: "Smallest amount" },
];

export const Route = createFileRoute("/super/loans")({
  head: () => ({
    meta: [
      { title: "Loans — ONE WAVE Super Admin" },
      {
        name: "description",
        content:
          "Monitor every coin loan on the platform: who borrowed, how much is still owed, and the full transaction history behind each balance.",
      },
      { property: "og:title", content: "Loans — ONE WAVE Super Admin" },
      {
        property: "og:description",
        content:
          "Monitor every coin loan on the platform: who borrowed, how much is still owed, and the full transaction history behind each balance.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SuperLoansPage,
});

function SuperLoansPage() {
  useSession("super_admin");

  const [stats, setStats] = useState<LoanStats | null>(null);
  const [loans, setLoans] = useState<SuperLoan[]>([]);
  const [status, setStatus] = useState("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<SuperLoan | null>(null);
  const [entries, setEntries] = useState<SuperLoanEntry[]>([]);

  const [txKind, setTxKind] = useState("all");
  const [txStatus, setTxStatus] = useState("all");
  const [txSearch, setTxSearch] = useState("");
  const [txFrom, setTxFrom] = useState("");
  const [txTo, setTxTo] = useState("");
  const [txSort, setTxSort] = useState<LoanSort>("newest");
  const [transactions, setTransactions] = useState<SuperLoanTransaction[]>([]);

  const loadLoans = useCallback(async () => {
    try {
      const [s, rows] = await Promise.all([fetchLoanStats(), fetchSuperLoans(status, search)]);
      setStats(s);
      setLoans(rows);
    } catch (e) {
      toast.error("Could not load loans", { description: (e as Error).message });
    }
  }, [status, search]);

  const loadTransactions = useCallback(async () => {
    try {
      setTransactions(
        await fetchLoanTransactions({
          kind: txKind,
          status: txStatus,
          search: txSearch,
          from: txFrom,
          to: txTo,
        }),
      );
    } catch (e) {
      toast.error("Could not load loan transactions", { description: (e as Error).message });
    }
  }, [txKind, txStatus, txSearch, txFrom, txTo]);

  useEffect(() => {
    void loadLoans();
  }, [loadLoans]);

  useEffect(() => {
    void loadTransactions();
  }, [loadTransactions]);

  const openLoan = async (loan: SuperLoan) => {
    setSelected(loan);
    setEntries([]);
    try {
      setEntries(await fetchLoanEntries(loan.id));
    } catch (e) {
      toast.error("Could not load this loan's history", { description: (e as Error).message });
    }
  };

  const sortedTransactions = useMemo(
    () => sortTransactions(transactions, txSort),
    [transactions, txSort],
  );

  if (selected) {
    return (
      <LoanDetail
        loan={selected}
        entries={entries}
        onBack={() => {
          setSelected(null);
          setEntries([]);
        }}
      />
    );
  }

  return (
    <div className="pb-8">
      <PageSection
        title="Loans"
        description="Every coin loan on the platform, read straight from the loan records."
      >
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard
            label="Total outstanding"
            value={peso(stats?.totalOutstanding ?? 0)}
            icon={HandCoins}
            tone="negative"
            hint={`${stats?.borrowerCount ?? 0} borrower(s) owing`}
          />
          <StatCard
            label="Total borrowed"
            value={peso(stats?.totalPrincipal ?? 0)}
            icon={Coins}
            hint={`${peso(stats?.totalReleased ?? 0)} actually released`}
          />
          <StatCard
            label="Repayments received"
            value={peso(stats?.totalRepaid ?? 0)}
            icon={PiggyBank}
            tone="positive"
          />
          <StatCard
            label="Interest charged"
            value={peso(stats?.totalInterest ?? 0)}
            icon={TrendingUp}
            tone="brand"
            hint="Upfront + monthly"
          />
          <StatCard label="Active loans" value={String(stats?.activeCount ?? 0)} icon={Users} />
          <StatCard label="Fully repaid" value={String(stats?.settledCount ?? 0)} tone="positive" />
          <StatCard
            label="Waiting for approval"
            value={String(stats?.pendingCount ?? 0)}
            tone="brand"
            hint="Decide these on Platform settings"
          />
        </div>
      </PageSection>

      <ManualLoanCard onCreated={() => void loadLoans()} />

      <PageSection title="Borrowers">
        <div className="mb-3 flex flex-wrap items-end gap-2">
          <div className="relative min-w-[200px] flex-1">
            <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
            <Input
              className="pl-8"
              placeholder="Search name, @handle or loan ID"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <select
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            aria-label="Loan status"
          >
            {STATUSES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>

        {loans.length === 0 ? (
          <EmptyState title="No loans found" description="Nothing matches these filters yet." />
        ) : (
          <div className="space-y-2">
            {loans.map((l) => (
              <button
                key={l.id}
                type="button"
                onClick={() => void openLoan(l)}
                className="block w-full rounded-xl border bg-card p-3 text-left shadow-[var(--shadow-card)] transition hover:border-primary/40"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium">{borrowerName(l)}</p>
                    <p className="text-xs text-muted-foreground">
                      {roleLabel(l.role)}
                      {l.handle ? ` · @${l.handle}` : ""} · borrowed {shortDateTime(l.createdAt)} ·{" "}
                      {originLabel(l.origin)}
                      {l.referenceNote ? ` · ${l.referenceNote}` : ""}
                    </p>
                  </div>
                  <StatusBadge tone={loanTone(l.status)}>{loanStatusLabel(l.status)}</StatusBadge>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                  <Figure label="Borrowed" value={peso(l.principal)} />
                  <Figure label="Principal left" value={peso(Math.max(l.outstanding - l.accruedInterest, 0))} />
                  <Figure label="Interest" value={peso(l.accruedInterest)} />
                  <Figure label="Owed now" value={peso(l.outstanding)} strong />
                </div>
              </button>
            ))}
          </div>
        )}
      </PageSection>

      <PageSection title="All loan transactions" description="Every loan event across all borrowers.">
        <div className="mb-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
            <Input
              className="pl-8"
              placeholder="Borrower or loan ID"
              value={txSearch}
              onChange={(e) => setTxSearch(e.target.value)}
            />
          </div>
          <select
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            value={txKind}
            onChange={(e) => setTxKind(e.target.value)}
            aria-label="Transaction type"
          >
            <option value="all">All transaction types</option>
            {LOAN_ENTRY_KINDS.map((k) => (
              <option key={k} value={k}>
                {loanEntryLabel(k)}
              </option>
            ))}
          </select>
          <select
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            value={txStatus}
            onChange={(e) => setTxStatus(e.target.value)}
            aria-label="Loan status"
          >
            {STATUSES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
          <div className="space-y-1">
            <Label className="text-xs" htmlFor="loan-tx-from">
              From
            </Label>
            <Input
              id="loan-tx-from"
              type="date"
              value={txFrom}
              onChange={(e) => setTxFrom(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs" htmlFor="loan-tx-to">
              To
            </Label>
            <Input
              id="loan-tx-to"
              type="date"
              value={txTo}
              onChange={(e) => setTxTo(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs" htmlFor="loan-tx-sort">
              Sort
            </Label>
            <select
              id="loan-tx-sort"
              className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
              value={txSort}
              onChange={(e) => setTxSort(e.target.value as LoanSort)}
            >
              {SORTS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {sortedTransactions.length === 0 ? (
          <EmptyState title="No loan transactions" description="Nothing matches these filters." />
        ) : (
          <div className="space-y-1.5">
            {sortedTransactions.map((t) => (
              <div
                key={t.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-card px-3 py-2 text-xs"
              >
                <div>
                  <p className="font-medium">
                    {loanEntryLabel(t.kind)} · {peso(t.amount)}
                  </p>
                  <p className="text-muted-foreground">
                    {borrowerName(t)} · {roleLabel(t.role)} · {shortDateTime(t.createdAt)}
                  </p>
                </div>
                <span className="text-muted-foreground tabular-nums">
                  owed after {peso(t.outstandingAfter)}
                </span>
              </div>
            ))}
          </div>
        )}
      </PageSection>
    </div>
  );
}

function Figure({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div>
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className={strong ? "font-semibold tabular-nums" : "tabular-nums"}>{value}</p>
    </div>
  );
}

/**
 * Add Manual Loan — the platform owner books a real loan for a member. The
 * database creates the authoritative loan record and releases the coins
 * through the normal ledger, so it shows up instantly in that member's Loan
 * Center and in every loan report. A one-time token is sent with the request
 * so a double tap can never create two loans.
 */
function ManualLoanCard({ onCreated }: { onCreated: () => void }) {
  const [member, setMember] = useState<MemberSearchResult | null>(null);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [token, setToken] = useState(() => crypto.randomUUID());

  const value = Number(amount) || 0;

  const submit = async () => {
    if (!member) {
      toast.error("Choose the member first.");
      return;
    }
    if (value <= 0) {
      toast.error("Enter a loan amount greater than zero.");
      return;
    }
    setBusy(true);
    try {
      await createManualLoan({ userId: member.id, amount: value, note, clientToken: token });
      toast.success(`Loan of ${peso(value)} recorded for ${member.full_name}.`);
      setMember(null);
      setAmount("");
      setNote("");
      setToken(crypto.randomUUID());
      onCreated();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <PageSection
      title="Add a manual loan"
      description="Records a real loan against the member's wallet using the current interest terms. It appears immediately in their Loan Center."
    >
      <Card className="shadow-[var(--shadow-card)]">
        <CardContent className="space-y-3 p-4">
          {member ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm">
              <span>
                {member.full_name}
                {member.handle ? ` · @${member.handle}` : ""}
              </span>
              <Button variant="ghost" size="sm" onClick={() => setMember(null)}>
                Change
              </Button>
            </div>
          ) : (
            <MemberPicker showEcosystem onSelect={setMember} placeholder="Search the member" />
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="manual-loan-amount">Loan amount</Label>
              <Input
                id="manual-loan-amount"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="manual-loan-note">Note or reference (optional)</Label>
              <Input
                id="manual-loan-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Why this loan was granted"
              />
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            The current interest settings apply, exactly as for a normal loan. The first month's
            interest is deducted from the coins released where that setting is on.
          </p>
          <Button disabled={busy || !member || value <= 0} onClick={() => void submit()}>
            Create loan
          </Button>
        </CardContent>
      </Card>
    </PageSection>
  );
}

function LoanDetail({
  loan,
  entries,
  onBack,
}: {
  loan: SuperLoan;
  entries: SuperLoanEntry[];
  onBack: () => void;
}) {
  const sums = owedBreakdown(loan);
  return (
    <div className="pb-8">
      <Button variant="ghost" size="sm" className="mb-3" onClick={onBack}>
        <ArrowLeft className="mr-1 size-4" /> Back to loans
      </Button>

      <PageSection title={borrowerName(loan)} description={`${roleLabel(loan.role)}${loan.handle ? ` · @${loan.handle}` : ""}`}>
        <Card className="shadow-[var(--shadow-card)]">
          <CardContent className="grid gap-3 p-4 text-xs sm:grid-cols-2 lg:grid-cols-3">
            <Figure label="Loan ID" value={loan.id} />
            <Figure label="Status" value={loanStatusLabel(loan.status)} />
            <Figure
              label="Approval"
              value={loan.approvalMode === "auto" ? "Automatic" : "Approved by platform owner"}
            />
            <Figure label="Origin" value={originLabel(loan.origin)} />
            <Figure label="Created by" value={loan.createdByName ?? "Member"} />
            <Figure label="Reference" value={loan.referenceNote ?? "—"} />
            <Figure
              label="Where loan coins can be spent"
              value={loan.universeSpend ? "Any Universe shop" : "Own shops only"}
            />
            <Figure label="Date borrowed" value={shortDateTime(loan.createdAt)} />
            <Figure
              label="Released"
              value={loan.releasedAt ? shortDateTime(loan.releasedAt) : "Not released"}
            />
            <Figure
              label="Fully repaid"
              value={loan.settledAt ? shortDateTime(loan.settledAt) : "—"}
            />
            <Figure label="Original amount" value={peso(loan.principal)} />
            <Figure label="Coins actually received" value={peso(loan.releasedAmount)} />
            <Figure
              label="First month interest"
              value={`${peso(loan.firstMonthInterest)} at ${loan.interestPercent}%`}
            />
            <Figure label="Interest accrued" value={peso(loan.accruedInterest)} />
            <Figure
              label="Principal remaining"
              value={peso(Math.max(loan.outstanding - loan.accruedInterest, 0))}
            />
            <Figure label="Total owed now" value={peso(loan.outstanding)} strong />
            <Figure label="Loan limit at request" value={peso(loan.autoLimitSnapshot)} />
            <Figure label="Free balance at request" value={peso(loan.freeBalanceSnapshot)} />
            {loan.decisionNote ? <Figure label="Decision note" value={loan.decisionNote} /> : null}
          </CardContent>
        </Card>
      </PageSection>

      {(loan.borrowerRole ?? "customer") === "customer" ? (
        <PageSection
          title="Valid ID"
          description="Provided by the member with this exact loan request."
        >
          <Card className="shadow-[var(--shadow-card)]">
            <CardContent className="p-4 text-xs">
              {loan.idDocumentPath ? (
                <>
                  <p className="text-muted-foreground">
                    Uploaded{" "}
                    {loan.idDocumentUploadedAt ? shortDateTime(loan.idDocumentUploadedAt) : "—"}
                  </p>
                  <LoanIdViewer
                    path={loan.idDocumentPath}
                    who={loan.fullName ?? (loan.handle ? `@${loan.handle}` : "Member")}
                  />
                </>
              ) : (
                <p className="text-destructive">
                  No valid ID is attached to this request, so it cannot be approved until the member
                  uploads one.
                </p>
              )}
            </CardContent>
          </Card>
        </PageSection>
      ) : null}

      <PageSection title="How the amount owed is made up">
        <Card className="shadow-[var(--shadow-card)]">
          <CardContent className="space-y-1.5 p-4 text-xs">
            <Row label="Amount borrowed" value={peso(sums.principal)} />
            <Row label="Interest charged" value={`+ ${peso(sums.interest)}`} />
            <Row label="Repayments received" value={`− ${peso(sums.repaid)}`} />
            <div className="flex items-center justify-between border-t pt-2 text-sm font-semibold">
              <span>Total owed now</span>
              <span className="tabular-nums">{peso(sums.outstanding)}</span>
            </div>
            {!sums.reconciles ? (
              <p className="text-[11px] text-destructive">
                The stored balance differs from this sum by {peso(Math.abs(sums.difference))}. The
                stored balance is the one the loan system uses.
              </p>
            ) : null}
          </CardContent>
        </Card>
      </PageSection>

      <PageSection title="Loan transaction history" description="Oldest first — every recorded loan event.">
        {entries.length === 0 ? (
          <EmptyState title="No transactions recorded yet" />
        ) : (
          <div className="space-y-1.5">
            {entries.map((e) => (
              <div
                key={e.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-card px-3 py-2 text-xs"
              >
                <div>
                  <p className="font-medium">
                    {loanEntryLabel(e.kind)} · {peso(e.amount)}
                  </p>
                  <p className="text-muted-foreground">
                    {shortDateTime(e.createdAt)}
                    {e.periodIndex != null ? ` · month ${e.periodIndex}` : ""}
                    {e.note ? ` · ${e.note}` : ""}
                  </p>
                </div>
                <span className="text-muted-foreground tabular-nums">
                  owed after {peso(e.outstandingAfter)}
                </span>
              </div>
            ))}
          </div>
        )}
      </PageSection>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}
