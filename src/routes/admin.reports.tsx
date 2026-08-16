import { createFileRoute } from "@tanstack/react-router";
import { Undo2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState, PageSection, StatCard, StatusBadge } from "@/components/ui-kit";
import { ReportRangePicker } from "@/components/report-range";
import { EarningsHistory } from "@/components/earnings-history";
import { useSession } from "@/lib/session";
import { AdminEarningsPanel } from "@/components/admin-earnings-panel";
import { ExpensesCard } from "@/components/expenses-card";
import { peso, roleLabel, shortDateTime, type Role } from "@/lib/wavewallet";
import {
  csvStamp,
  downloadCsv,
  fetchCreditsReport,
  fetchNameMap,
  fetchPointsReport,
  fetchSaleCommissionsReport,
  fetchSalesReport,
  refundSale,
  resolveRange,
  summariseCreditFlow,
  adminShopEarnings,

  summarisePoints,
  summariseSaleCommissions,
  summariseSales,
  toCsv,
  type PointsEntryRow,
  type SaleCommissionReportRow,
  type SaleReportRow,
} from "@/lib/reports";
import type { CreditEntry } from "@/lib/wallet";
import { toast } from "sonner";


export const Route = createFileRoute("/admin/reports")({
  head: () => ({
    meta: [
      { title: "Earnings & Reports — WaveWallet Admin" },
      {
        name: "description",
        content:
          "Daily, monthly, quarterly, yearly and custom-range reporting on voucher sales, coins issued, reseller commission and points activity.",
      },
      { property: "og:title", content: "Earnings & Reports — WaveWallet Admin" },
      {
        property: "og:description",
        content:
          "Shop revenue, reseller commission and coin activity built from immutable ledger records.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AdminReports,
});

function AdminReports() {
  const { ecosystem, ecosystemDbId } = useSession("admin");
  const [expenseVersion, setExpenseVersion] = useState(0);
  const [range, setRange] = useState("monthly");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [sales, setSales] = useState<SaleReportRow[]>([]);
  const [credits, setCredits] = useState<CreditEntry[]>([]);
  const [points, setPoints] = useState<PointsEntryRow[]>([]);
  const [commissions, setCommissions] = useState<SaleCommissionReportRow[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [refunding, setRefunding] = useState<SaleReportRow | null>(null);
  const [refundReason, setRefundReason] = useState("");
  const [refundBusy, setRefundBusy] = useState(false);


  const resolved = useMemo(() => resolveRange(range, from, to), [range, from, to]);

  const load = useCallback(async () => {
    if (!ecosystemDbId) return;
    setLoading(true);
    try {
      const [s, c, p, n, sc] = await Promise.all([
        fetchSalesReport({ range: resolved, ecosystemId: ecosystemDbId }),
        fetchCreditsReport({ range: resolved, ecosystemId: ecosystemDbId }),
        fetchPointsReport({ range: resolved, ecosystemId: ecosystemDbId }),
        fetchNameMap(ecosystemDbId),
        fetchSaleCommissionsReport({ range: resolved, ecosystemId: ecosystemDbId }),
      ]);
      setSales(s);
      setCredits(c);
      setPoints(p);
      setNames(n);
      setCommissions(sc);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [ecosystemDbId, resolved]);

  useEffect(() => {
    void load();
  }, [load]);

  const salesTotals = useMemo(() => summariseSales(sales), [sales]);
  
  const creditFlow = useMemo(() => summariseCreditFlow(credits), [credits]);
  const shopEarnings = useMemo(() => adminShopEarnings(sales, commissions), [sales, commissions]);
  const commissionSplit = useMemo(() => summariseSaleCommissions(commissions), [commissions]);
  const pointTotals = useMemo(() => summarisePoints(points), [points]);

  /** Reseller rows use each sale's snapshotted discount, never today's rate. */
  const resellerRows = useMemo(() => {
    const map = new Map<
      string,
      {
        sales: number;
        gross: number;
        net: number;
        margin: number;
        commission: number;
        upline: number;
        role: string;
      }
    >();
    const blank = () => ({ sales: 0, gross: 0, net: 0, margin: 0, commission: 0, upline: 0, role: "reseller" });
    for (const s of sales) {
      if (s.payment_method === "points") continue;
      const isChannel = s.buyer_role === "reseller" || s.buyer_role === "subreseller";
      const id = s.reseller_id ?? (isChannel ? s.buyer_id : null);
      if (!id) continue;
      const row = map.get(id) ?? blank();
      if (isChannel && s.buyer_id === id) row.role = s.buyer_role;
      row.sales += 1;
      row.gross += s.list_price;
      row.net += s.sale_price;
      row.margin += s.list_price - s.sale_price;
      map.set(id, row);
    }
    for (const c of commissions) {
      if (c.reversed_at) continue;
      const row = map.get(c.recipient_id) ?? blank();
      if (c.kind === "upline") row.upline += c.commission_amount;
      else row.commission += c.commission_amount;
      map.set(c.recipient_id, row);
    }
    return [...map.entries()].sort(
      (a, b) => b[1].margin + b[1].commission + b[1].upline - (a[1].margin + a[1].commission + a[1].upline),
    );
  }, [sales, commissions]);

  const nameOf = (id: string) => names[id] ?? `${id.slice(0, 8)}…`;

  const exportCsv = () => {
    const csv = toCsv(
      [
        "Type",
        "Date",
        "Reference",
        "Account",
        "Detail",
        "Gross",
        "Net / Amount",
        "Wholesale discount",
        "Cashback / upline",
        "Points",
      ],
      [
        ...sales.map((s) => [
          s.payment_method === "points" ? "Voucher sale (points)" : "Voucher sale (coins)",
          s.created_at,
          s.tx_id,
          nameOf(s.buyer_id),
          s.product_name,
          s.payment_method === "points" ? "" : s.list_price,
          s.payment_method === "points" ? "" : s.sale_price,
          s.payment_method === "points" ? "" : s.list_price - s.sale_price,
          "",
          s.payment_method === "points" ? -s.points_spent : s.points_earned,
        ]),
        ...credits.map((c) => [
          `Coin ${c.direction}`,
          c.created_at,
          c.tx_id ?? "",
          nameOf(c.user_id),
          c.reason,
          "",
          c.direction === "debit" ? -c.amount : c.amount,
          "",
          c.entry_kind === "sale_commission" || c.entry_kind === "upline_commission" ? c.amount : 0,
          "",
        ]),
      ],
    );
    downloadCsv(`wavewallet-admin-report-${csvStamp()}.csv`, csv);
    toast.success("Report exported");
  };

  if (!ecosystem) return null;

  return (
    <>
      <EarningsHistory
        ecosystemId={ecosystemDbId}
        title="Shop earnings & financial reports"
        description="Shop earnings are the coins this shop keeps from completed voucher sales after reseller and subreseller cashback, using each sale's own snapshotted rates. Coins issued by the platform, approved cash-ins, wallet transfers and withdrawal holds are never shop earnings."
        highlightTypes={["admin_shop_margin", "sale_cashback", "upline_commission"]}
        netTypes={["admin_shop_margin"]}
        netLabel="Net shop earnings"
        showBenefit={false}
      />


      <PageSection
        title="Earnings & reports"
        description={`${ecosystem.name} · ${resolved.label}. Every figure comes from immutable ledger records — historical discounts, commission rates and points ratios are never recalculated.`}
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

      <AdminEarningsPanel ecosystemId={ecosystemDbId} showLink={false} />

      <ExpensesCard
        key={expenseVersion}
        scope="ecosystem"
        ecosystemId={ecosystemDbId}
        title="Shop expenses"
        format={peso}
        onChange={() => setExpenseVersion((v) => v + 1)}
      />

      <PageSection title="Revenue">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Gross sales" value={peso(salesTotals.gross)} tone="brand" />
          <StatCard
            label="Net collected"
            value={peso(salesTotals.net)}
            tone="positive"
            hint="After reseller discounts"
          />
          <StatCard label="Reseller discounts" value={peso(salesTotals.resellerMargin)} tone="negative" />
          <StatCard
            label="Vouchers sold"
            value={String(salesTotals.count)}
            hint={`${salesTotals.creditCount} coins · ${salesTotals.pointsCount} points`}
          />
        </div>
      </PageSection>

      <PageSection
        title="Coin activity & earnings"
        description="Cashflow of this shop: completed sales in, downline cashback out, and what the shop keeps. Coins issued by the platform, approved cash-ins, wallet transfers and withdrawal holds move coins but are never shop earnings."
      >
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard
            label="Sales collected"
            value={peso(shopEarnings.saleCollected)}
            tone="positive"
            hint={`${shopEarnings.saleCount} completed sales · in`}
          />
          <StatCard
            label="Subreseller & reseller cashback"
            value={peso(shopEarnings.cashbackPaid)}
            tone="negative"
            hint="Paid out of the sale · out"
          />
          <StatCard
            label="Upline commission"
            value={peso(shopEarnings.uplinePaid)}
            tone="negative"
            hint="Paid out of the sale · out"
          />
          <StatCard
            label="Admin earnings retained"
            value={peso(shopEarnings.retained)}
            tone="brand"
            hint="Sale less downline cashback"
          />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard
            label="Coins spent on vouchers"
            value={peso(creditFlow.spentOnVouchers)}
            hint="Buyer wallets · not earnings"
          />
          <StatCard
            label="Existing coins transferred"
            value={peso(creditFlow.transferred)}
            hint={`${creditFlow.transferCount} transfers · no earnings`}
          />
          <StatCard
            label="Platform coins received"
            value={peso(creditFlow.platformIssued + creditFlow.cashIn)}
            hint="Issuance & approved cash-in · no earnings"
          />
          <StatCard
            label="Reserved for withdrawal"
            value={peso(Math.max(creditFlow.withdrawalHeld - creditFlow.withdrawalReturned, 0))}
            hint="On hold · not a loss"
          />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard
            label="Discounts given"
            value={peso(salesTotals.resellerMargin)}
            tone="negative"
            hint="Wholesale benefit to channel"
          />
          <StatCard
            label="Refunded sales"
            value={peso(shopEarnings.refundedAmount)}
            tone="negative"
            hint={`${shopEarnings.refundedCount} reversed · excluded`}
          />
          <StatCard
            label="Coins revoked"
            value={peso(creditFlow.revoked)}
            tone="negative"
            hint="Admin corrections"
          />
          <StatCard
            label="Net shop earnings"
            value={peso(shopEarnings.retained)}
            tone="brand"
            hint="Completed sales less cashback and upline"
          />

        </div>
      </PageSection>

      <PageSection title="Points activity">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Points earned" value={String(pointTotals.earned)} tone="positive" />
          <StatCard label="Points spent" value={String(pointTotals.spent)} tone="negative" />
          <StatCard label="Adjustments" value={String(pointTotals.adjusted)} />
          <StatCard label="Points-funded vouchers" value={String(salesTotals.pointsCount)} />
        </div>
      </PageSection>

      <PageSection
        title="Reseller & subreseller performance"
        description="Margins use the discount captured at sale time; commission uses the rate snapshotted on each coin release."
      >
        {resellerRows.length === 0 ? (
          <EmptyState title="No reseller or subreseller activity in this range" />
        ) : (
          <Card className="overflow-hidden py-0 shadow-[var(--shadow-card)]">
            <CardContent className="px-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Channel partner</TableHead>
                      <TableHead>Vouchers</TableHead>
                      <TableHead className="hidden sm:table-cell">Gross</TableHead>
                      <TableHead>Discount saved</TableHead>
                      <TableHead className="text-right">Sale cashback</TableHead>
                      <TableHead className="text-right">Upline</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {resellerRows.map(([id, r]) => (
                      <TableRow key={id}>
                        <TableCell className="font-medium">
                          {nameOf(id)}
                          <span className="ml-2 text-[11px] font-normal text-muted-foreground">
                            {roleLabel(r.role as Role)}
                          </span>
                        </TableCell>
                        <TableCell>{r.sales}</TableCell>
                        <TableCell className="hidden sm:table-cell">{peso(r.gross)}</TableCell>
                        <TableCell className="text-destructive">{peso(r.margin)}</TableCell>
                        <TableCell className="text-right text-success">
                          {r.commission > 0 ? `+${peso(r.commission)}` : "—"}
                        </TableCell>
                        <TableCell className="text-right text-success">
                          {r.upline > 0 ? `+${peso(r.upline)}` : "—"}
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

      <PageSection title="Voucher sales in range">
        {sales.length === 0 ? (
          <EmptyState title="No sales in this range" description="Try a wider time window." />
        ) : (
          <Card className="overflow-hidden py-0 shadow-[var(--shadow-card)]">
            <CardContent className="px-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Transaction</TableHead>
                      <TableHead className="hidden sm:table-cell">Buyer</TableHead>
                      <TableHead>Paid</TableHead>
                      <TableHead className="hidden lg:table-cell">Points</TableHead>
                      <TableHead className="hidden md:table-cell">Date</TableHead>
                      <TableHead className="text-right">Refund</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sales.slice(0, 100).map((s) => (
                      <TableRow key={s.id}>
                        <TableCell>
                          <p className="text-sm font-medium">{s.product_name}</p>
                          <p className="font-mono text-[11px] text-muted-foreground">{s.tx_id}</p>
                        </TableCell>
                        <TableCell className="hidden sm:table-cell text-sm">{nameOf(s.buyer_id)}</TableCell>
                        <TableCell className="text-sm">
                          {s.payment_method === "points" ? (
                            <StatusBadge tone="brand">{s.points_spent} pts</StatusBadge>
                          ) : (
                            <span>
                              {peso(s.sale_price)}
                              {s.discount_percent > 0 ? (
                                <span className="ml-1 text-[11px] text-muted-foreground">
                                  −{s.discount_percent}%
                                </span>
                              ) : null}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="hidden lg:table-cell text-sm text-success">
                          {s.points_earned > 0 ? `+${s.points_earned}` : "—"}
                          {s.credits_per_point_used ? (
                            <span className="ml-1 text-[11px] text-muted-foreground">
                              @{s.credits_per_point_used}:1
                            </span>
                          ) : null}
                        </TableCell>
                        <TableCell className="hidden md:table-cell text-xs text-muted-foreground">
                          {shortDateTime(s.created_at)}
                        </TableCell>
                        <TableCell className="text-right">
                          {s.refunded_at ? (
                            <StatusBadge tone="danger">Refunded</StatusBadge>
                          ) : (
                            <Button size="sm" variant="outline" onClick={() => setRefunding(s)}>
                              <Undo2 className="size-4" /> Refund
                            </Button>
                          )}
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

      <PageSection title="Coin movements in range">
        {credits.length === 0 ? (
          <EmptyState title="No coin movements in this range" />
        ) : (
          <Card className="overflow-hidden py-0 shadow-[var(--shadow-card)]">
            <CardContent className="px-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Movement</TableHead>
                      <TableHead className="hidden sm:table-cell">Account</TableHead>
                      <TableHead>Amount</TableHead>
                      <TableHead className="hidden lg:table-cell">Legacy commission</TableHead>
                      <TableHead className="hidden md:table-cell text-right">Date</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {credits.slice(0, 100).map((c) => (
                      <TableRow key={c.id}>
                        <TableCell>
                          <p className="text-sm font-medium">{c.reason}</p>
                          <p className="font-mono text-[11px] text-muted-foreground">{c.tx_id ?? "—"}</p>
                        </TableCell>
                        <TableCell className="hidden sm:table-cell text-sm">{nameOf(c.user_id)}</TableCell>
                        <TableCell
                          className={`text-sm ${c.direction === "debit" ? "text-destructive" : "text-success"}`}
                        >
                          {c.direction === "debit" ? "−" : "+"}
                          {peso(c.amount)}
                        </TableCell>
                        <TableCell className="hidden lg:table-cell text-sm">
                          {Number(c.commission_amount ?? 0) > 0
                            ? `+${peso(Number(c.commission_amount))} @ ${c.commission_percent}%`
                            : "—"}
                        </TableCell>
                        <TableCell className="hidden md:table-cell text-right text-xs text-muted-foreground">
                          {shortDateTime(c.created_at)}
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

      <Dialog
        open={refunding !== null}
        onOpenChange={(o) => {
          if (!o) {
            setRefunding(null);
            setRefundReason("");
          }
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Refund this sale</DialogTitle>
            <DialogDescription>
              The original sale is never edited. We return what the buyer paid, reverse any credit-back
              and points earned, and void the released codes so they cannot be resold.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1 rounded-xl border border-border px-3 py-3 text-sm">
            <p className="flex justify-between">
              <span className="text-muted-foreground">Voucher</span>
              <span className="font-medium">{refunding?.product_name}</span>
            </p>
            <p className="flex justify-between">
              <span className="text-muted-foreground">Buyer</span>
              <span className="font-medium">{refunding ? nameOf(refunding.buyer_id) : ""}</span>
            </p>
            <p className="flex justify-between">
              <span className="text-muted-foreground">Returned</span>
              <span className="font-semibold text-success">
                {refunding?.payment_method === "points"
                  ? `${refunding?.points_spent} pts`
                  : peso(refunding?.sale_price ?? 0)}
              </span>
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="refundReason">Reason</Label>
            <Input
              id="refundReason"
              value={refundReason}
              onChange={(e) => setRefundReason(e.target.value)}
              placeholder="Codes did not work, duplicate purchase…"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRefunding(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={refundBusy || refundReason.trim().length < 3 || !refunding}
              onClick={() => {
                if (!refunding) return;
                setRefundBusy(true);
                void refundSale(refunding.id, refundReason.trim())
                  .then(async (r) => {
                    toast.success("Sale refunded", {
                      description: `${r.tx_id} · ${peso(r.credits_refunded)} returned · ${r.codes_voided} code(s) voided`,
                    });
                    setRefunding(null);
                    setRefundReason("");
                    await load();
                  })
                  .catch((e: Error) => toast.error(e.message))
                  .finally(() => setRefundBusy(false));
              }}
            >
              {refundBusy ? "Refunding…" : "Refund sale"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>

  );
}
