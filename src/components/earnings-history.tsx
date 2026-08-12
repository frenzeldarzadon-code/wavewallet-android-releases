import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState, PageSection, StatCard, StatusBadge } from "@/components/ui-kit";
import { csvStamp, downloadCsv, toCsv } from "@/lib/reports";
import { peso, shortDateTime } from "@/lib/wavewallet";
import {
  EARNINGS_CSV_HEADERS,
  EARNINGS_TZ,
  EARNING_TYPE_LABEL,
  PERIOD_OPTIONS,
  QUICK_RANGES,
  SELLER_EARNING_TYPES,
  bucketEarnings,
  defaultRangeFor,
  earningsCsvRows,
  fetchEarnings,
  filterEarnings,
  quickRangeDates,
  summariseEarnings,
  type EarningRow,
  type EarningType,
  type PeriodId,
  type QuickRangeId,
} from "@/lib/earnings";

/**
 * Earnings history panel shared by reseller, subreseller, admin and platform
 * owner reporting screens. All figures come from finalized transaction
 * records; reversed (refunded) rows stay visible but never count toward net.
 */
export function EarningsHistory({
  recipientId,
  ecosystemId,
  title = "Earnings history",
  description,
  highlightTypes = SELLER_EARNING_TYPES,
  netTypes,
  netLabel = "Net earnings",
}: {
  recipientId?: string | null;
  ecosystemId?: string | null;
  title?: string;
  description?: string;
  /** Earning types shown as summary cards for this audience. */
  highlightTypes?: EarningType[];
  /** Restrict the headline net figure to these types (e.g. platform revenue only). */
  netTypes?: EarningType[];
  netLabel?: string;
}) {
  const [period, setPeriod] = useState<PeriodId>("monthly");
  const [quick, setQuick] = useState<QuickRangeId>("custom");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [rows, setRows] = useState<EarningRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [type, setType] = useState<EarningType | "all">("all");
  const [status, setStatus] = useState<"all" | "settled" | "reversed">("all");
  const [product, setProduct] = useState<string>("all");
  const [party, setParty] = useState<string>("all");
  const [search, setSearch] = useState("");

  const applyQuick = (id: QuickRangeId) => {
    setQuick(id);
    const dates = quickRangeDates(id);
    if (!dates) {
      setFrom("");
      setTo("");
      return;
    }
    setFrom(dates.from);
    setTo(dates.to);
    const preset = QUICK_RANGES.find((q) => q.id === id);
    if (preset) setPeriod(preset.period);
  };

  const range = useMemo(() => {
    const base = defaultRangeFor(period);
    return {
      from: from ? new Date(`${from}T00:00:00`) : base.from,
      to: to ? new Date(`${to}T23:59:59`) : base.to,
    };
  }, [period, from, to]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(
        await fetchEarnings({
          recipientId: recipientId ?? null,
          ecosystemId: ecosystemId ?? null,
          from: range.from,
          to: range.to,
        }),
      );
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [recipientId, ecosystemId, range.from, range.to]);

  useEffect(() => {
    void load();
  }, [load]);

  const products = useMemo(
    () => [...new Set(rows.map((r) => r.product_name).filter(Boolean) as string[])].sort(),
    [rows],
  );
  const parties = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of rows) {
      const id = r.counterparty_id ?? r.recipient_id;
      const name = r.counterparty_name ?? r.recipient_name ?? "Unknown";
      map.set(id, name);
    }
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [rows]);
  const typeOptions = useMemo(() => {
    const present = new Set<EarningType>(rows.map((r) => r.earning_type));
    for (const t of highlightTypes) present.add(t);
    return (Object.keys(EARNING_TYPE_LABEL) as EarningType[]).filter((t) => present.has(t));
  }, [rows, highlightTypes]);


  const filtered = useMemo(
    () => filterEarnings(rows, { type, status, product, counterparty: party, search }),
    [rows, type, status, product, party, search],
  );
  const totals = useMemo(() => summariseEarnings(filtered), [filtered]);
  const buckets = useMemo(() => bucketEarnings(filtered, period), [filtered, period]);

  const exportCsv = () => {
    downloadCsv(
      `wavewallet-earnings-${period}-${csvStamp()}.csv`,
      toCsv(EARNINGS_CSV_HEADERS, earningsCsvRows(filtered)),
    );
    toast.success("Earnings exported");
  };

  return (
    <>
      <PageSection
        title={title}
        description={
          description ??
          `Derived from finalized sales. Credit transfers are face value and never counted. Periods use ${EARNINGS_TZ} calendar dates.`
        }
      >
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {QUICK_RANGES.map((q) => (
              <Button
                key={q.id}
                size="sm"
                variant={quick === q.id ? "default" : "outline"}
                onClick={() => applyQuick(q.id)}
              >
                {q.label}
              </Button>
            ))}
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <Tabs value={period} onValueChange={(v) => setPeriod(v as PeriodId)} className="min-w-0">
              <TabsList className="flex w-full flex-wrap justify-start">
                {PERIOD_OPTIONS.map((p) => (
                  <TabsTrigger key={p.id} value={p.id}>
                    {p.label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
            <Button variant="outline" size="sm" onClick={exportCsv} disabled={loading} className="shrink-0">
              <Download className="size-4" /> Export CSV
            </Button>
          </div>

          <Card className="shadow-[var(--shadow-card)]">
            <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="earnFrom">From</Label>
                <Input
                  id="earnFrom"
                  type="date"
                  value={from}
                  onChange={(e) => {
                    setQuick("custom");
                    setFrom(e.target.value);
                  }}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="earnTo">To</Label>
                <Input
                  id="earnTo"
                  type="date"
                  value={to}
                  onChange={(e) => {
                    setQuick("custom");
                    setTo(e.target.value);
                  }}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Earning type</Label>
                <Select value={type} onValueChange={(v) => setType(v as EarningType | "all")}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All types</SelectItem>
                    {typeOptions.map((t) => (
                      <SelectItem key={t} value={t}>{EARNING_TYPE_LABEL[t]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Status</Label>
                <Select value={status} onValueChange={(v) => setStatus(v as "all" | "settled" | "reversed")}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All statuses</SelectItem>
                    <SelectItem value="settled">Settled</SelectItem>
                    <SelectItem value="reversed">Reversed</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Voucher / product</Label>
                <Select value={product} onValueChange={setProduct}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All products</SelectItem>
                    {products.map((p) => (
                      <SelectItem key={p} value={p}>{p}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Customer / downline</Label>
                <Select value={party} onValueChange={setParty}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Everyone</SelectItem>
                    {parties.map(([id, name]) => (
                      <SelectItem key={id} value={id}>{name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5 sm:col-span-2 lg:col-span-3">
                <Label htmlFor="earnSearch">Search reference or name</Label>
                <Input
                  id="earnSearch"
                  value={search}
                  placeholder="TX id, customer, product…"
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
            </CardContent>
          </Card>
        </div>
      </PageSection>

      <PageSection>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard
            label={netLabel}
            value={peso(
              netTypes ? netTypes.reduce((s, t) => s + totals.byType[t], 0) : totals.cash,
            )}
            tone="positive"
            hint={`${totals.count} records · ${totals.reversedCount} reversed`}
          />
          {showBenefit ? (
            <>
              <StatCard
                label="Discounts saved"
                value={peso(totals.discountSaved)}
                tone="brand"
                hint="Wholesale benefit, not cash"
              />
              <StatCard
                label="Total benefit"
                value={peso(totals.cash + totals.discountSaved)}
                tone="brand"
                hint="Earnings + discounts saved"
              />
            </>
          ) : null}
          {highlightTypes.map((t) => (
            <StatCard
              key={t}
              label={EARNING_TYPE_LABEL[t]}
              value={peso(totals.byType[t])}
              tone={t === "upline_commission" || t === "credit_generation" ? "brand" : "positive"}
            />
          ))}
        </div>
        {totals.reversed > 0 ? (
          <p className="mt-2 text-xs text-destructive">
            {peso(totals.reversed)} reversed by refunds and excluded from net earnings.
          </p>
        ) : null}
      </PageSection>

      <PageSection title="Period summary" description="Totals per calendar period for the current filters.">
        {buckets.length === 0 ? (
          <EmptyState title="No earnings yet" description="Finalized sales will appear here." />
        ) : (
          <Card className="shadow-[var(--shadow-card)]">
            <CardContent className="overflow-x-auto p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Period</TableHead>
                    <TableHead className="text-right">Records</TableHead>
                    <TableHead className="text-right">Gross sales</TableHead>
                    <TableHead className="text-right">Net earnings</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {buckets.map((b) => (
                    <TableRow key={b.key}>
                      <TableCell className="font-medium">{b.label}</TableCell>
                      <TableCell className="text-right">{b.totals.count}</TableCell>
                      <TableCell className="text-right">{peso(b.totals.gross)}</TableCell>
                      <TableCell className="text-right font-semibold text-success">
                        {peso(b.totals.net)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </PageSection>

      <PageSection
        title="Earning transactions"
        description={`${filtered.length} records · net ${peso(totals.net)}`}
      >
        {filtered.length === 0 ? (
          <EmptyState title="Nothing to show" description="Try widening the date range or filters." />
        ) : (
          <Card className="shadow-[var(--shadow-card)]">
            <CardContent className="overflow-x-auto p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Product</TableHead>
                    <TableHead>Party</TableHead>
                    <TableHead className="text-right">Gross</TableHead>
                    <TableHead className="text-right">Rate</TableHead>
                    <TableHead className="text-right">Earning</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Reference</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="whitespace-nowrap">{shortDateTime(r.occurred_at)}</TableCell>
                      <TableCell>{EARNING_TYPE_LABEL[r.earning_type]}</TableCell>
                      <TableCell>{r.product_name ?? "—"}</TableCell>
                      <TableCell>{r.counterparty_name ?? r.recipient_name ?? "—"}</TableCell>
                      <TableCell className="text-right">{peso(r.gross_amount)}</TableCell>
                      <TableCell className="text-right">{r.rate_percent}%</TableCell>
                      <TableCell
                        className={
                          r.status === "reversed"
                            ? "text-right text-muted-foreground line-through"
                            : "text-right font-semibold text-success"
                        }
                      >
                        {peso(r.earning_amount)}
                      </TableCell>
                      <TableCell>
                        <StatusBadge tone={r.status === "reversed" ? "danger" : "success"}>
                          {r.status === "reversed" ? "Reversed" : "Settled"}
                        </StatusBadge>
                      </TableCell>
                      <TableCell className="font-mono text-[11px]">{r.tx_id ?? "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </PageSection>
    </>
  );
}
