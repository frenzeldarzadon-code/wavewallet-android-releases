/**
 * Admin wallet + earnings rollup: the admin's own shop wallet balance, the
 * shop earnings retained from completed purchases, recorded shop expenses and
 * net earnings, for daily / monthly / quarterly / yearly / lifetime periods.
 *
 * Shop earnings are the remainder of each completed sale after reseller and
 * subreseller cashback, using the rates snapshotted on that sale, plus approved
 * credit-paid retail orders. Platform issued credits, approved cash in, wallet
 * transfers and withdrawal holds/releases are never shop earnings. Expenses are
 * audited records and only reduce the net figure — they never touch a wallet.
 *
 * The wallet balance and the earnings figures are deliberately shown apart: a
 * balance is what is currently held, earnings are what was allocated.
 */
import { useCallback, useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowRight, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageSection, StatCard } from "@/components/ui-kit";
import { PeriodEarningsTable } from "@/components/period-earnings-table";
import { fetchEarnings, lifetimeFrom, EMPTY_PERIOD_TOTALS, type EarningRow } from "@/lib/earnings";
import { fetchExpenses } from "@/lib/expenses";
import { adminNetEarnings, type NetEarnings } from "@/lib/role-earnings";
import { fetchCreditBalance } from "@/lib/wallet";
import { peso } from "@/lib/wavewallet";

const EMPTY: NetEarnings = {
  earnings: EMPTY_PERIOD_TOTALS,
  expenses: EMPTY_PERIOD_TOTALS,
  net: EMPTY_PERIOD_TOTALS,
};

interface Breakdown {
  sales: number;
  gross: number;
  downline: number;
  retained: number;
}

/** Qualifying purchases only: settled shop-margin rows, never wallet movements. */
function breakdownOf(rows: EarningRow[]): Breakdown {
  const margin = rows.filter((r) => r.earning_type === "admin_shop_margin" && r.status === "settled");
  const gross = margin.reduce((n, r) => n + r.gross_amount, 0);
  const retained = margin.reduce((n, r) => n + r.earning_amount, 0);
  return { sales: margin.length, gross, downline: gross - retained, retained };
}

export function AdminEarningsPanel({
  ecosystemId,
  adminId = null,
  showLink = true,
}: {
  ecosystemId: string | null;
  /** The signed-in admin, so their own shop wallet balance can be shown. */
  adminId?: string | null;
  showLink?: boolean;
}) {
  const [totals, setTotals] = useState<NetEarnings>(EMPTY);
  const [breakdown, setBreakdown] = useState<Breakdown>({
    sales: 0,
    gross: 0,
    downline: 0,
    retained: 0,
  });
  const [balance, setBalance] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!ecosystemId) return;
    const from = lifetimeFrom();
    try {
      const [rows, expenses, walletBalance] = await Promise.all([
        fetchEarnings({ ecosystemId, from, to: new Date() }),
        fetchExpenses({ scope: "ecosystem", ecosystemId, from }),
        adminId ? fetchCreditBalance(adminId, ecosystemId) : Promise.resolve(null),
      ]);
      setTotals(adminNetEarnings(rows, expenses));
      setBreakdown(breakdownOf(rows));
      setBalance(walletBalance);
    } catch {
      setTotals(EMPTY);
    } finally {
      setLoading(false);
    }
  }, [ecosystemId, adminId]);

  useEffect(() => {
    void load();
  }, [load]);

  const hasExpenses = totals.expenses.total !== 0;

  return (
    <PageSection devSlot="admin-earnings-panel.wallet-earnings"
      title="Wallet & earnings"
      description="Your shop wallet balance and what the shop keeps from completed purchases after reseller and subreseller cashback, less recorded expenses. Platform-issued coins, cash-ins, transfers and withdrawal holds are never earnings."
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <StatCard
          label="Shop wallet balance"
          value={loading || balance === null ? "—" : peso(balance)}
          icon={Wallet}
          tone="brand"
          hint="Coins held in your wallet for this shop"
        />
        <StatCard
          label="Total earnings"
          value={loading ? "—" : peso(hasExpenses ? totals.net.total : totals.earnings.total)}
          tone="positive"
          hint={
            hasExpenses ? "Lifetime net of recorded expenses" : "Lifetime retained share of purchases"
          }
        />
      </div>

      <div className="mt-3">
        <PeriodEarningsTable
          loading={loading}
          format={peso}
          metrics={[
            {
              label: "Gross purchase earnings",
              hint: "Retained share of completed purchases",
              totals: totals.earnings,
              tone: "positive",
            },
            {
              label: "Expenses",
              hint: "Recorded shop and rewards-shop costs",
              totals: totals.expenses,
              tone: "negative",
            },
            {
              label: "Net earnings",
              hint: "Purchase earnings less expenses",
              totals: totals.net,
              tone: "brand",
              emphasis: true,
            },
          ]}
        />
      </div>

      <div className="mt-3 rounded-xl border border-border p-3 text-sm">
        <p className="font-medium">Purchase earnings breakdown</p>
        <p className="text-[11px] text-muted-foreground">
          Lifetime, from completed purchases only. Each sale keeps the discount and cashback rates
          used at the time.
        </p>
        <dl className="mt-2 space-y-1">
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Completed purchases</dt>
            <dd className="tabular-nums">{loading ? "—" : breakdown.sales}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Purchase value collected</dt>
            <dd className="tabular-nums">{loading ? "—" : peso(breakdown.gross)}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Non-admin allocations</dt>
            <dd className="tabular-nums text-destructive">
              {loading ? "—" : `− ${peso(breakdown.downline)}`}
            </dd>
          </div>
          <div className="flex justify-between gap-3 border-t border-border pt-1 font-semibold">
            <dt>Admin remainder</dt>
            <dd className="tabular-nums text-success">{loading ? "—" : peso(breakdown.retained)}</dd>
          </div>
        </dl>
      </div>

      {showLink ? (
        <Button asChild variant="outline" size="sm" className="mt-3">
          <Link to="/admin/reports">
            Open earnings, expenses &amp; reports <ArrowRight className="size-4" />
          </Link>
        </Button>
      ) : null}
    </PageSection>
  );
}
