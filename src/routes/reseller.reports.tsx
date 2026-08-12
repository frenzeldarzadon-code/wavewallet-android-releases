import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState, PageSection, StatCard, StatusBadge } from "@/components/ui-kit";
import { ReportRangePicker } from "@/components/report-range";
import { useSession } from "@/lib/session";
import { peso, roleLabel, shortDateTime } from "@/lib/wavewallet";
import { commissionBreakdown, type CreditEntry } from "@/lib/wallet";
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
import { toast } from "sonner";

export const Route = createFileRoute("/reseller/reports")({
  head: () => ({
    meta: [
      { title: "Earnings & Reports — WaveWallet Reseller" },
      {
        name: "description",
        content:
          "Track your voucher margins, commission credits, customer credit loads and transaction history across daily, monthly, quarterly, yearly and custom ranges.",
      },
      { property: "og:title", content: "Earnings & Reports — WaveWallet Reseller" },
      {
        property: "og:description",
        content: "Your own earnings, commission credits and customer credit loads — nobody else's.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ResellerReports,
});

function ResellerReports() {
  const { account, ecosystem } = useSession("reseller");
  const [range, setRange] = useState("monthly");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [sales, setSales] = useState<SaleReportRow[]>([]);
  const [credits, setCredits] = useState<CreditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const userId = account?.id ?? null;

  const resolved = useMemo(() => resolveRange(range, from, to), [range, from, to]);

  const load = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const [s, c] = await Promise.all([
        fetchSalesReport({ range: resolved, buyerId: userId }),
        fetchCreditsReport({ range: resolved, userId }),
      ]);
      setSales(s);
      setCredits(c);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [userId, resolved]);

  useEffect(() => {
    void load();
  }, [load]);

  const salesTotals = useMemo(() => summariseSales(sales), [sales]);
  const creditTotals = useMemo(() => summariseCredits(credits), [credits]);
  const commissionEntries = useMemo(
    () => credits.filter((c) => c.direction === "credit" && Number(c.commission_amount ?? 0) > 0),
    [credits],
  );
  const customerLoads = useMemo(
    () => credits.filter((c) => c.direction === "debit" && c.reason === "Credit load to customer"),
    [credits],
  );
  const loadTotal = customerLoads.reduce((s, c) => s + c.amount, 0);
  // Subresellers never earn commission — their entire earning is the voucher discount margin.
  const isSubreseller = account?.role === "subreseller";

  const exportCsv = () => {
    const csv = toCsv(
      ["Type", "Date", "Reference", "Detail", "List price", "I paid", "My margin", "Commission", "Points"],
      [
        ...sales.map((s) => [
          s.payment_method === "points" ? "Voucher purchase (points)" : "Voucher purchase (credits)",
          s.created_at,
          s.tx_id,
          s.product_name,
          s.payment_method === "points" ? "" : s.list_price,
          s.payment_method === "points" ? "" : s.sale_price,
          s.payment_method === "points" ? "" : s.list_price - s.sale_price,
          "",
          s.payment_method === "points" ? -s.points_spent : s.points_earned,
        ]),
        ...credits.map((c) => [
          `Credit ${c.direction}`,
          c.created_at,
          c.tx_id ?? "",
          c.reason,
          "",
          c.direction === "debit" ? -c.amount : c.amount,
          "",
          Number(c.commission_amount ?? 0),
          "",
        ]),
      ],
    );
    downloadCsv(`wavewallet-reseller-report-${csvStamp()}.csv`, csv);
    toast.success("Report exported");
  };

  if (!account || !ecosystem) return null;

  return (
    <>
      <PageSection
        title={`My earnings${account?.role ? ` · ${roleLabel(account.role)}` : ""}`}
        description={
          isSubreseller
            ? `${resolved.label}. Your earning is the voucher discount captured at purchase time — subresellers do not receive credit commission.`
            : `${resolved.label}. Margins use the discount captured at sale time and commission uses the rate snapshotted on each credit release.`
        }
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

      <PageSection>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Gross value" value={peso(salesTotals.gross)} tone="brand" hint="At list price" />
          <StatCard label="My margin" value={peso(salesTotals.resellerMargin)} tone="positive" />
          <StatCard
            label="Vouchers bought"
            value={String(salesTotals.count)}
            hint={`${salesTotals.creditCount} credits · ${salesTotals.pointsCount} points`}
          />
          {isSubreseller ? (
            <StatCard label="Commission credits" value="—" hint="Subresellers earn discount only" />
          ) : (
            <StatCard
              label="Commission credits"
              value={peso(creditTotals.commissionBonus)}
              tone="positive"
              hint={`${creditTotals.commissionCount} releases`}
            />
          )}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Credits received (base)" value={peso(creditTotals.commissionBase)} />
          <StatCard
            label="Total credited to me"
            value={peso(creditTotals.commissionBase + creditTotals.commissionBonus)}
            tone="brand"
          />
          <StatCard
            label="Loaded to customers"
            value={peso(loadTotal)}
            tone="negative"
            hint={`${customerLoads.length} loads · no commission`}
          />
          <StatCard label="Points earned" value={String(salesTotals.pointsEarned)} />
        </div>
      </PageSection>

      <PageSection
        title={isSubreseller ? "Commission" : "Commission received"}
        description={
          isSubreseller
            ? "Subresellers do not receive credit commission — your margin comes from the voucher discount."
            : "Bonus credits granted by your shop admin on qualifying credit releases."
        }
      >
        {isSubreseller || commissionEntries.length === 0 ? (
          <EmptyState
            title={
              isSubreseller ? "Commission does not apply to subresellers" : "No commission credits in this range"
            }
          />
        ) : (
          <Card className="shadow-[var(--shadow-card)]">
            <CardContent className="divide-y divide-border px-0 py-0">
              {commissionEntries.map((e) => (
                <div key={e.id} className="flex items-start justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{e.reason}</p>
                    <p className="text-[11px] font-medium text-success">{commissionBreakdown(e)}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {shortDateTime(e.created_at)} · {e.tx_id ?? "—"}
                    </p>
                  </div>
                  <p className="shrink-0 text-sm font-semibold text-success">+{peso(e.amount)}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </PageSection>

      <PageSection title="My voucher purchases">
        {sales.length === 0 ? (
          <EmptyState title="No purchases in this range" />
        ) : (
          <Card className="overflow-hidden py-0 shadow-[var(--shadow-card)]">
            <CardContent className="px-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Transaction</TableHead>
                      <TableHead className="hidden sm:table-cell">List</TableHead>
                      <TableHead>I paid</TableHead>
                      <TableHead>My margin</TableHead>
                      <TableHead className="hidden md:table-cell text-right">Date</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sales.map((s) => (
                      <TableRow key={s.id}>
                        <TableCell>
                          <p className="text-sm font-medium">{s.product_name}</p>
                          <p className="font-mono text-[11px] text-muted-foreground">{s.tx_id}</p>
                        </TableCell>
                        <TableCell className="hidden sm:table-cell text-sm">
                          {s.payment_method === "points" ? "—" : peso(s.list_price)}
                        </TableCell>
                        <TableCell className="text-sm">
                          {s.payment_method === "points" ? (
                            <StatusBadge tone="brand">{s.points_spent} pts</StatusBadge>
                          ) : (
                            peso(s.sale_price)
                          )}
                        </TableCell>
                        <TableCell className="text-sm text-success">
                          {s.payment_method === "points" ? "—" : `+${peso(s.list_price - s.sale_price)}`}
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

      <PageSection title="Credit movements">
        {credits.length === 0 ? (
          <EmptyState title="No credit activity in this range" />
        ) : (
          <Card className="shadow-[var(--shadow-card)]">
            <CardContent className="divide-y divide-border px-0 py-0">
              {credits.slice(0, 100).map((c) => (
                <div key={c.id} className="flex items-start justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{c.reason}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {shortDateTime(c.created_at)} · {c.tx_id ?? "—"}
                      {c.reference ? ` · ${c.reference}` : ""}
                    </p>
                  </div>
                  <p
                    className={`shrink-0 text-sm font-semibold ${
                      c.direction === "debit" ? "text-destructive" : "text-success"
                    }`}
                  >
                    {c.direction === "debit" ? "−" : "+"}
                    {peso(c.amount)}
                  </p>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </PageSection>
    </>
  );
}
