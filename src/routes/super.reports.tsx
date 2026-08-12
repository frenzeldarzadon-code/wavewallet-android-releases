import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState, PageSection, StatCard, StatusBadge } from "@/components/ui-kit";
import { ReportRangePicker } from "@/components/report-range";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/lib/session";
import { peso, shortDateTime } from "@/lib/wavewallet";
import {
  csvStamp,
  downloadCsv,
  fetchCreditsReport,
  fetchSalesReport,
  resolveRange,
  summariseCredits,
  summariseSales,
  toCsv,
  type SaleReportRow,
} from "@/lib/reports";
import type { CreditEntry } from "@/lib/wallet";
import { toast } from "sonner";

export const Route = createFileRoute("/super/reports")({
  head: () => ({
    meta: [
      { title: "Cross-Tenant Reports — WaveWallet Super Admin" },
      {
        name: "description",
        content:
          "Platform-wide voucher revenue, credits issued and reseller commission broken down per ecosystem, across daily to yearly and custom ranges.",
      },
      { property: "og:title", content: "Cross-Tenant Reports — WaveWallet Super Admin" },
      {
        property: "og:description",
        content: "Compare ecosystem performance from immutable ledger records across any time range.",
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
  issued: number;
  commission: number;
  pointsSales: number;
}

function SuperReports() {
  const { account } = useSession("super_admin");
  const [range, setRange] = useState("monthly");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [sales, setSales] = useState<SaleReportRow[]>([]);
  const [credits, setCredits] = useState<CreditEntry[]>([]);
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
  const creditTotals = useMemo(() => summariseCredits(credits), [credits]);

  const perEcosystem = useMemo(() => {
    const map = new Map<string, EcoRow>();
    const blank = (): EcoRow => ({
      sales: 0,
      gross: 0,
      net: 0,
      discounts: 0,
      issued: 0,
      commission: 0,
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
    for (const c of credits) {
      const ecoId = (c as CreditEntry & { ecosystem_id?: string }).ecosystem_id;
      if (!ecoId) continue;
      const row = map.get(ecoId) ?? blank();
      if (c.direction === "credit") row.issued += c.amount;
      row.commission += Number(c.commission_amount ?? 0);
      map.set(ecoId, row);
    }
    return [...map.entries()].sort((a, b) => b[1].net - a[1].net);
  }, [sales, credits]);

  const ecoName = (id: string) => ecoNames[id] ?? `${id.slice(0, 8)}…`;

  const exportCsv = () => {
    const csv = toCsv(
      [
        "Ecosystem",
        "Vouchers sold",
        "Points-funded",
        "Gross",
        "Net collected",
        "Reseller discounts",
        "Credits issued",
        "Commission granted",
      ],
      perEcosystem.map(([id, r]) => [
        ecoName(id),
        r.sales,
        r.pointsSales,
        r.gross,
        r.net,
        r.discounts,
        r.issued,
        r.commission,
      ]),
    );
    downloadCsv(`wavewallet-platform-report-${csvStamp()}.csv`, csv);
    toast.success("Report exported");
  };

  if (!account) return null;

  return (
    <>
      <PageSection
        title="Cross-tenant reports"
        description={`${resolved.label}. Figures come from immutable ledger records; each ecosystem's snapshotted discounts, commission rates and points ratios are preserved.`}
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

      <PageSection title="Platform totals">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Gross sales" value={peso(salesTotals.gross)} tone="brand" />
          <StatCard label="Net collected" value={peso(salesTotals.net)} tone="positive" />
          <StatCard
            label="Vouchers sold"
            value={String(salesTotals.count)}
            hint={`${salesTotals.pointsCount} points-funded`}
          />
          <StatCard label="Credits issued" value={peso(creditTotals.issued)} />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Reseller discounts" value={peso(salesTotals.resellerMargin)} tone="negative" />
          <StatCard label="Commission granted" value={peso(creditTotals.commissionBonus)} tone="positive" />
          <StatCard label="Base released" value={peso(creditTotals.commissionBase)} />
          <StatCard label="Ecosystems with activity" value={String(perEcosystem.length)} />
        </div>
      </PageSection>

      <PageSection title="Ecosystem performance">
        {perEcosystem.length === 0 ? (
          <EmptyState title="No tenant activity in this range" description="Try a wider time window." />
        ) : (
          <Card className="overflow-hidden py-0 shadow-[var(--shadow-card)]">
            <CardContent className="px-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Ecosystem</TableHead>
                      <TableHead>Vouchers</TableHead>
                      <TableHead className="hidden sm:table-cell">Gross</TableHead>
                      <TableHead>Net</TableHead>
                      <TableHead className="hidden lg:table-cell">Credits issued</TableHead>
                      <TableHead className="text-right">Commission</TableHead>
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
                        <TableCell className="hidden lg:table-cell">{peso(r.issued)}</TableCell>
                        <TableCell className="text-right text-success">+{peso(r.commission)}</TableCell>
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
                      <TableHead className="hidden sm:table-cell">Ecosystem</TableHead>
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
    </>
  );
}
