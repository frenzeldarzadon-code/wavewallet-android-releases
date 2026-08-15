import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState, PageSection, StatCard, StatusBadge } from "@/components/ui-kit";
import { ReportRangePicker } from "@/components/report-range";
import { supabase } from "@/integrations/supabase/client";
import { EarningsHistory } from "@/components/earnings-history";
import { useSession } from "@/lib/session";
import { SuperEarningsPanel } from "@/components/super-earnings-panel";
import { ExpensesCard } from "@/components/expenses-card";
import { LovableCreditsCard } from "@/components/super/lovable-credits-card";

import { peso, shortDateTime } from "@/lib/wavewallet";
import {
  csvStamp,
  downloadCsv,
  fetchCreditsReport,
  fetchSalesReport,
  resolveRange,
  summariseCreditFlow,
  summariseSales,
  toCsv,
  type CreditReportEntry,
  type SaleReportRow,
} from "@/lib/reports";
import { toast } from "sonner";
import { WalletIntegrityCard } from "@/components/wallet-integrity-card";

export const Route = createFileRoute("/super/reports")({
  head: () => ({
    meta: [
      { title: "Cross-Tenant Reports — WaveWallet Super Admin" },
      {
        name: "description",
        content:
          "Platform subscription revenue plus per-shop voucher sales, credits generated and channel earnings, across daily to yearly and custom ranges.",
      },
      { property: "og:title", content: "Cross-Tenant Reports — WaveWallet Super Admin" },
      {
        property: "og:description",
        content: "Compare shop performance from immutable ledger records across any time range.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SuperReports,
});

interface EcoRow {
  sales: number;
  gross: number;
  net: number;
  discounts: number;
  generated: number;
  transferred: number;
  pointsSales: number;
}

function SuperReports() {
  const { account } = useSession("super_admin");
  const [expenseVersion, setExpenseVersion] = useState(0);
  const [range, setRange] = useState("monthly");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [sales, setSales] = useState<SaleReportRow[]>([]);
  const [credits, setCredits] = useState<CreditReportEntry[]>([]);
  const [ecoNames, setEcoNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  const resolved = useMemo(() => resolveRange(range, from, to), [range, from, to]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, c, { data: ecos }] = await Promise.all([
        fetchSalesReport({ range: resolved }),
        fetchCreditsReport({ range: resolved }),
        supabase.from("ecosystems").select("id, name"),
      ]);
      setSales(s);
      setCredits(c);
      setEcoNames(Object.fromEntries((ecos ?? []).map((e) => [e.id, e.name])));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [resolved]);

  useEffect(() => {
    void load();
  }, [load]);

  const salesTotals = useMemo(() => summariseSales(sales), [sales]);
  const creditFlow = useMemo(() => summariseCreditFlow(credits), [credits]);

  const perEcosystem = useMemo(() => {
    const map = new Map<string, EcoRow>();
    const blank = (): EcoRow => ({
      sales: 0,
      gross: 0,
      net: 0,
      discounts: 0,
      generated: 0,
      transferred: 0,
      pointsSales: 0,
    });
    for (const s of sales) {
      const row = map.get(s.ecosystem_id) ?? blank();
      row.sales += 1;
      if (s.payment_method === "points") {
        row.pointsSales += 1;
      } else {
        row.gross += s.list_price;
        row.net += s.sale_price;
        row.discounts += s.list_price - s.sale_price;
      }
      map.set(s.ecosystem_id, row);
    }
    const byEco = new Map<string, CreditReportEntry[]>();
    for (const c of credits) {
      if (!c.ecosystem_id) continue;
      const list = byEco.get(c.ecosystem_id);
      if (list) list.push(c);
      else byEco.set(c.ecosystem_id, [c]);
    }
    for (const [ecoId, entries] of byEco) {
      const flow = summariseCreditFlow(entries);
      const row = map.get(ecoId) ?? blank();
      row.generated += flow.generated;
      row.transferred += flow.transferred;
      map.set(ecoId, row);
    }
    return [...map.entries()].sort((a, b) => b[1].net - a[1].net);
  }, [sales, credits]);

  const ecoName = (id: string) => ecoNames[id] ?? `${id.slice(0, 8)}…`;

  const exportCsv = () => {
    const csv = toCsv(
      [
        "Shop",
        "Vouchers sold",
        "Points-funded",
        "Gross",
        "Net collected",
        "Wholesale discounts",
        "Credits generated",
        "Existing credits transferred",
      ],
      perEcosystem.map(([id, r]) => [
        ecoName(id),
        r.sales,
        r.pointsSales,
        r.gross,
        r.net,
        r.discounts,
        r.generated,
        r.transferred,
      ]),
    );
    downloadCsv(`wavewallet-platform-report-${csvStamp()}.csv`, csv);
    toast.success("Report exported");
  };

  if (!account) return null;

  return (
    <>
      <EarningsHistory
        title="Platform revenue & cross-shop earnings"
        description="Platform subscription revenue belongs to the platform; shop, reseller and subreseller earnings are listed separately per shop and never counted as platform revenue."
        highlightTypes={["platform_subscription", "credit_generation", "sale_cashback"]}
        netTypes={["platform_subscription"]}
        netLabel="Platform revenue"
        showBenefit={false}
      />


      <PageSection
        title="Cross-tenant reports"
        description={`${resolved.label}. Figures come from immutable ledger records; each ecosystem's snapshotted discounts, cashback rates and points ratios are preserved.`}
      >
        <ReportRangePicker
          range={range}
          onRangeChange={setRange}
          from={from}
          to={to}
          onFromChange={setFrom}
          onToChange={setTo}
          onExport={exportCsv}
          busy={loading}
        />
      </PageSection>

      <SuperEarningsPanel showLink={false} />

      <ExpensesCard
        key={expenseVersion}
        scope="platform"
        title="Platform expenses"
        format={peso}
        onChange={() => setExpenseVersion((v) => v + 1)}
      />

      <LovableCreditsCard onChange={() => setExpenseVersion((v) => v + 1)} />


      <PageSection title="Platform totals">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Gross sales" value={peso(salesTotals.gross)} tone="brand" />
          <StatCard label="Net collected" value={peso(salesTotals.net)} tone="positive" />
          <StatCard
            label="Vouchers sold"
            value={String(salesTotals.count)}
            hint={`${salesTotals.pointsCount} points-funded`}
          />
          <StatCard label="Credits generated" value={peso(creditFlow.generated)} />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Wholesale discounts given" value={peso(salesTotals.resellerMargin)} tone="negative" />
          <StatCard
            label="Seller cashback & upline"
            value={peso(creditFlow.cashbackPaid + creditFlow.uplinePaid)}
            hint="Paid by tenant shops, not the platform"
          />
          <StatCard
            label="Existing credits transferred"
            value={peso(creditFlow.transferred)}
            hint="Face value · no earnings"
          />
          <StatCard label="Shops with activity" value={String(perEcosystem.length)} />
        </div>
      </PageSection>

      <PageSection title="Shop performance">
        {perEcosystem.length === 0 ? (
          <EmptyState title="No tenant activity in this range" description="Try a wider time window." />
        ) : (
          <Card className="overflow-hidden py-0 shadow-[var(--shadow-card)]">
            <CardContent className="px-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Shop</TableHead>
                      <TableHead>Vouchers</TableHead>
                      <TableHead className="hidden sm:table-cell">Gross</TableHead>
                      <TableHead>Net</TableHead>
                      <TableHead className="hidden lg:table-cell">Credits generated</TableHead>
                      <TableHead className="text-right">Credits transferred</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {perEcosystem.map(([id, r]) => (
                      <TableRow key={id}>
                        <TableCell className="font-medium">{ecoName(id)}</TableCell>
                        <TableCell>
                          {r.sales}
                          {r.pointsSales > 0 ? (
                            <StatusBadge tone="brand">{r.pointsSales} pts</StatusBadge>
                          ) : null}
                        </TableCell>
                        <TableCell className="hidden sm:table-cell">{peso(r.gross)}</TableCell>
                        <TableCell className="text-success">{peso(r.net)}</TableCell>
                        <TableCell className="hidden lg:table-cell">{peso(r.generated)}</TableCell>
                        <TableCell className="text-right">{peso(r.transferred)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        )}
      </PageSection>

      <PageSection title="Recent platform sales">
        {sales.length === 0 ? (
          <EmptyState title="No sales in this range" />
        ) : (
          <Card className="overflow-hidden py-0 shadow-[var(--shadow-card)]">
            <CardContent className="px-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Transaction</TableHead>
                      <TableHead className="hidden sm:table-cell">Shop</TableHead>
                      <TableHead>Paid</TableHead>
                      <TableHead className="hidden md:table-cell text-right">Date</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sales.slice(0, 100).map((s) => (
                      <TableRow key={s.id}>
                        <TableCell>
                          <p className="text-sm font-medium">{s.product_name}</p>
                          <p className="font-mono text-[11px] text-muted-foreground">{s.tx_id}</p>
                        </TableCell>
                        <TableCell className="hidden sm:table-cell text-sm">
                          {ecoName(s.ecosystem_id)}
                        </TableCell>
                        <TableCell className="text-sm">
                          {s.payment_method === "points"
                            ? `${s.points_spent} pts`
                            : peso(s.sale_price)}
                        </TableCell>
                        <TableCell className="hidden md:table-cell text-right text-xs text-muted-foreground">
                          {shortDateTime(s.created_at)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        )}
      </PageSection>

      <WalletIntegrityCard />
    </>
  );
}
