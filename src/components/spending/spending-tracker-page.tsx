/**
 * Spending Tracker — reporting/analytics view for one shop.
 *
 * Read-only over existing records, plus manual entries the admin adds by hand.
 * Everything on this page is scoped to the current shop; the database re-checks
 * that the caller administers that shop on every read and write.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowDownRight,
  ArrowUpRight,
  Pencil,
  Plus,
  Scale,
  SlidersHorizontal,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState, PageSection, StatCard, StatusBadge } from "@/components/ui-kit";
import { peso, shortDate } from "@/lib/wavewallet";
import { CategoryManager } from "@/components/spending/category-manager";
import { EntryDialog } from "@/components/spending/entry-dialog";
import {
  categoryHighlights,
  deleteManualEntry,
  dayKey,
  fetchSpendingCategories,
  fetchSpendingEntries,
  monthKey,
  quarterKey,
  resolvePeriod,
  summarize,
  syncSpendingCategories,
  timeBuckets,
  yearKey,
  type EntryKind,
  type PeriodMode,
  type SpendingCategory,
  type SpendingEntry,
} from "@/lib/spending-tracker";
import {
  QUEUE_EVENT,
  flushQueue,
  queueFor,
  queuedAsEntries,
  queuedInPeriod,
  removeQueuedEntry,
} from "@/lib/offline-spending";
import { yearChoices } from "@/lib/reports";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const SLICE_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--chart-3)",
];

export function SpendingTrackerPage({ ecosystemId }: { ecosystemId: string | null }) {
  const [mode, setMode] = useState<PeriodMode>("month");
  const [month, setMonth] = useState(monthKey(new Date()));
  const [quarter, setQuarter] = useState(quarterKey(new Date()));
  const [year, setYear] = useState(yearKey(new Date()));
  const [day, setDay] = useState(dayKey(new Date()));
  const [from, setFrom] = useState(dayKey(new Date()));
  const [to, setTo] = useState(dayKey(new Date()));

  const [categories, setCategories] = useState<SpendingCategory[]>([]);
  const [serverEntries, setServerEntries] = useState<SpendingEntry[]>([]);
  const [queueVersion, setQueueVersion] = useState(0);
  const [loading, setLoading] = useState(true);
  const [dialog, setDialog] = useState<{ kind: EntryKind; editing?: SpendingEntry } | null>(null);
  const [manageOpen, setManageOpen] = useState(false);
  const [side, setSide] = useState<EntryKind>("income");

  const period = useMemo(
    () => resolvePeriod({ mode, month, quarter, year, day, from, to }),
    [mode, month, quarter, year, day, from, to],
  );

  const load = useCallback(async () => {
    if (!ecosystemId) return;
    setLoading(true);
    try {
      await syncSpendingCategories(ecosystemId);
      const cats = await fetchSpendingCategories(ecosystemId);
      setCategories(cats);
      setServerEntries(await fetchSpendingEntries(ecosystemId, period, cats));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [ecosystemId, period]);

  useEffect(() => {
    void load();
  }, [load]);

  // Re-render whenever the offline queue changes in this tab.
  useEffect(() => {
    const bump = () => setQueueVersion((v) => v + 1);
    window.addEventListener(QUEUE_EVENT, bump);
    return () => window.removeEventListener(QUEUE_EVENT, bump);
  }, []);

  // Try to drain the queue on mount and whenever connectivity returns.
  useEffect(() => {
    if (!ecosystemId) return;
    let cancelled = false;
    const run = async () => {
      const before = queueFor(ecosystemId).length;
      if (before === 0) return;
      const result = await flushQueue(ecosystemId);
      if (cancelled || result.skipped || result.synced === 0) return;
      toast.success(`${result.synced} offline ${result.synced === 1 ? "entry" : "entries"} synced.`);
      void load();
    };
    void run();
    window.addEventListener("online", run);
    return () => {
      cancelled = true;
      window.removeEventListener("online", run);
    };
  }, [ecosystemId, load]);

  const pending = useMemo(
    () => (queueVersion >= 0 ? queueFor(ecosystemId) : []),
    [ecosystemId, queueVersion],
  );

  const entries = useMemo(() => {
    const local = queuedAsEntries(queuedInPeriod(pending, period.from, period.to));
    return [...local, ...serverEntries].sort((a, b) =>
      a.occurredAt < b.occurredAt ? 1 : a.occurredAt > b.occurredAt ? -1 : 0,
    );
  }, [pending, period, serverEntries]);

  const totals = useMemo(() => summarize(entries), [entries]);
  const highlights = useMemo(() => categoryHighlights(entries), [entries]);
  const buckets = useMemo(() => timeBuckets(entries, period), [entries, period]);
  const slices = side === "income" ? highlights.income : highlights.expense;

  if (!ecosystemId) return null;

  async function remove(entry: SpendingEntry) {
    // Not sent yet: dropping the queued copy is the whole deletion.
    if (entry.sync) {
      removeQueuedEntry(entry.id);
      toast.success("Entry removed before it was synced.");
      return;
    }
    try {
      await deleteManualEntry(entry.kind, entry.id);
      toast.success("Entry deleted.");
      void load();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <>
      <PageSection
        title="Spending Tracker"
        description="Income and expenses for this shop only. Reporting view — no balance, earning or transaction is changed here."
        action={
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => setManageOpen(true)}>
              <SlidersHorizontal className="size-4" /> Categories
            </Button>
            <Button size="sm" variant="outline" onClick={() => setDialog({ kind: "income" })}>
              <Plus className="size-4" /> Income
            </Button>
            <Button size="sm" onClick={() => setDialog({ kind: "expense" })}>
              <Plus className="size-4" /> Expense
            </Button>
          </div>
        }
      >
        <Card className="shadow-[var(--shadow-card)]">
          <CardContent className="space-y-3">
            <Tabs value={mode} onValueChange={(v) => setMode(v as PeriodMode)}>
              <TabsList className="flex w-full flex-wrap justify-start">
                <TabsTrigger value="month">Month</TabsTrigger>
                <TabsTrigger value="quarter">Quarter</TabsTrigger>
                <TabsTrigger value="year">Year</TabsTrigger>
                <TabsTrigger value="day">Single date</TabsTrigger>
                <TabsTrigger value="range">Date range</TabsTrigger>
              </TabsList>
            </Tabs>
            <div className="grid gap-3 sm:grid-cols-2">
              {mode === "month" ? (
                <div className="space-y-1.5">
                  <Label htmlFor="spendMonth">Month</Label>
                  <Input
                    id="spendMonth"
                    type="month"
                    value={month}
                    onChange={(e) => setMonth(e.target.value)}
                  />
                </div>
              ) : null}
              {mode === "quarter" ? (
                <>
                  <div className="space-y-1.5">
                    <Label>Quarter</Label>
                    <Select
                      value={quarter.slice(5)}
                      onValueChange={(q) => setQuarter(`${quarter.slice(0, 4)}-${q}`)}
                    >
                      <SelectTrigger aria-label="Quarter">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="pointer-events-auto">
                        <SelectItem value="Q1">Q1 (Jan–Mar)</SelectItem>
                        <SelectItem value="Q2">Q2 (Apr–Jun)</SelectItem>
                        <SelectItem value="Q3">Q3 (Jul–Sep)</SelectItem>
                        <SelectItem value="Q4">Q4 (Oct–Dec)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Year</Label>
                    <Select
                      value={quarter.slice(0, 4)}
                      onValueChange={(y) => setQuarter(`${y}-${quarter.slice(5)}`)}
                    >
                      <SelectTrigger aria-label="Quarter year">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="pointer-events-auto">
                        {yearChoices().map((y) => (
                          <SelectItem key={y} value={String(y)}>
                            {y}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </>
              ) : null}
              {mode === "year" ? (
                <div className="space-y-1.5">
                  <Label>Year</Label>
                  <Select value={year} onValueChange={setYear}>
                    <SelectTrigger aria-label="Year">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="pointer-events-auto">
                      {yearChoices().map((y) => (
                        <SelectItem key={y} value={String(y)}>
                          {y}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : null}
              {mode === "day" ? (
                <div className="space-y-1.5">
                  <Label htmlFor="spendDay">Date</Label>
                  <Input
                    id="spendDay"
                    type="date"
                    value={day}
                    onChange={(e) => setDay(e.target.value)}
                  />
                </div>
              ) : null}
              {mode === "range" ? (
                <>
                  <div className="space-y-1.5">
                    <Label htmlFor="spendFrom">From</Label>
                    <Input
                      id="spendFrom"
                      type="date"
                      value={from}
                      max={to || undefined}
                      onChange={(e) => setFrom(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="spendTo">To</Label>
                    <Input
                      id="spendTo"
                      type="date"
                      value={to}
                      min={from || undefined}
                      onChange={(e) => setTo(e.target.value)}
                    />
                  </div>
                </>
              ) : null}
            </div>
            <p className="text-xs text-muted-foreground">Showing {period.label}.</p>
            {pending.length > 0 ? (
              <div className="flex flex-wrap items-center gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs">
                <span className="flex-1">
                  {pending.length} manual {pending.length === 1 ? "entry is" : "entries are"} saved on
                  this device only and not synced yet.
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={async () => {
                    const r = await flushQueue(ecosystemId);
                    if (r.skipped) {
                      toast.error("Still offline — they will sync automatically when you reconnect.");
                      return;
                    }
                    if (r.synced > 0) void load();
                    if (r.failed > 0) toast.error(`${r.failed} could not sync yet. Will retry.`);
                  }}
                >
                  Sync now
                </Button>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <StatCard
            label="Total income"
            value={loading ? "—" : peso(totals.income)}
            icon={ArrowUpRight}
            tone="positive"
            hint={highlights.topIncome ? `Top: ${highlights.topIncome.name}` : "No income yet"}
          />
          <StatCard
            label="Total expenses"
            value={loading ? "—" : peso(totals.expense)}
            icon={ArrowDownRight}
            tone="negative"
            hint={highlights.topExpense ? `Top: ${highlights.topExpense.name}` : "No expenses yet"}
          />
          <StatCard
            label="Balance"
            value={loading ? "—" : peso(totals.balance)}
            icon={Scale}
            tone={totals.balance < 0 ? "negative" : "brand"}
            hint={totals.balance < 0 ? "Spending more than earned" : "Income after expenses"}
          />
        </div>
      </PageSection>

      <PageSection title="Breakdown" description="Where the money came from and where it went.">
        <div className="grid gap-3 lg:grid-cols-2">
          <Card className="shadow-[var(--shadow-card)]">
            <CardContent className="space-y-3">
              <Tabs value={side} onValueChange={(v) => setSide(v as EntryKind)}>
                <TabsList className="w-full">
                  <TabsTrigger className="flex-1" value="income">
                    Income
                  </TabsTrigger>
                  <TabsTrigger className="flex-1" value="expense">
                    Expenses
                  </TabsTrigger>
                </TabsList>
              </Tabs>
              {slices.length === 0 ? (
                <EmptyState
                  title={`No ${side} recorded`}
                  description="Nothing was recorded for this period."
                />
              ) : (
                <>
                  <div className="h-56">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={slices}
                          dataKey="total"
                          nameKey="name"
                          innerRadius="50%"
                          outerRadius="80%"
                          paddingAngle={2}
                        >
                          {slices.map((s, i) => (
                            <Cell key={s.key} fill={SLICE_COLORS[i % SLICE_COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip formatter={(v: number) => peso(Number(v))} />
                        <Legend />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="divide-y divide-border">
                    {slices.map((s, i) => (
                      <div key={s.key} className="flex items-center justify-between gap-3 py-2">
                        <div className="flex min-w-0 items-center gap-2">
                          <span
                            className="size-2.5 shrink-0 rounded-full"
                            style={{ background: SLICE_COLORS[i % SLICE_COLORS.length] }}
                          />
                          <span className="truncate text-sm">{s.name}</span>
                          {s.automatic ? (
                            <StatusBadge tone="muted">Auto</StatusBadge>
                          ) : null}
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="text-sm font-semibold">{peso(s.total)}</p>
                          <p className="text-[11px] text-muted-foreground">{s.share}%</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          <Card className="shadow-[var(--shadow-card)]">
            <CardContent className="space-y-3">
              <p className="text-sm font-medium">Income vs expenses</p>
              {buckets.length === 0 ? (
                <EmptyState title="Nothing to chart" description="No entries in this period." />
              ) : (
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={buckets}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                      <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} width={48} />
                      <Tooltip formatter={(v: number) => peso(Number(v))} />
                      <Legend />
                      <Bar dataKey="income" name="Income" fill="var(--chart-2)" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="expense" name="Expenses" fill="var(--chart-3)" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </PageSection>

      <PageSection
        title="Entries"
        description="Automatic entries come from real transactions and cannot be edited. Manual entries are yours to change."
      >
        <Card className="shadow-[var(--shadow-card)]">
          <CardContent className="divide-y divide-border px-0 py-0">
            {loading ? (
              <p className="px-4 py-6 text-center text-sm text-muted-foreground">Loading…</p>
            ) : entries.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-muted-foreground">
                No income or expenses recorded for {period.label}.
              </p>
            ) : (
              entries.map((e) => (
                <div key={`${e.kind}-${e.id}`} className="flex items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{e.description}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {e.categoryName} · {shortDate(e.occurredAt)}
                      {e.source === "automatic" ? " · automatic" : ""}
                    </p>
                    {e.sync ? (
                      <StatusBadge tone={e.sync === "failed" ? "danger" : "warning"}>
                        {e.sync === "failed" ? "Sync failed — will retry" : "Saved on this device · not synced"}
                      </StatusBadge>
                    ) : null}
                  </div>
                  <p
                    className={`shrink-0 text-sm font-semibold ${
                      e.kind === "income" ? "text-success" : "text-destructive"
                    }`}
                  >
                    {e.kind === "income" ? "+" : "−"}
                    {peso(e.amount)}
                  </p>
                  {e.editable ? (
                    <div className="flex shrink-0 gap-1">
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label="Edit entry"
                        onClick={() => setDialog({ kind: e.kind, editing: e })}
                      >
                        <Pencil className="size-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label="Delete entry"
                        onClick={() => void remove(e)}
                      >
                        <Trash2 className="size-4 text-destructive" />
                      </Button>
                    </div>
                  ) : null}
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </PageSection>

      <EntryDialog
        open={dialog !== null}
        onOpenChange={(v) => !v && setDialog(null)}
        kind={dialog?.kind ?? "expense"}
        editing={dialog?.editing ?? null}
        ecosystemId={ecosystemId}
        categories={categories}
        onSaved={load}
      />
      <CategoryManager
        open={manageOpen}
        onOpenChange={setManageOpen}
        ecosystemId={ecosystemId}
        categories={categories}
        onChanged={load}
      />
    </>
  );
}
