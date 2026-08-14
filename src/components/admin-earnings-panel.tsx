/**
 * Admin dashboard cashflow rollup: shop earnings retained, recorded shop
 * expenses, and net earnings, for daily / monthly / quarterly / yearly periods.
 *
 * Shop earnings are the retained share of COMPLETED sales after reseller and
 * subreseller cashback, using each sale's snapshotted rates. Platform issued
 * credits, approved cash in, wallet transfers and withdrawal holds/releases are
 * never shop earnings. Expenses are audited records and only reduce the net
 * figure — they never touch a wallet balance.
 */
import { useCallback, useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageSection } from "@/components/ui-kit";
import { PeriodEarningsTable } from "@/components/period-earnings-table";
import { fetchEarnings, EMPTY_PERIOD_TOTALS } from "@/lib/earnings";
import { fetchExpenses } from "@/lib/expenses";
import { adminNetEarnings, type NetEarnings } from "@/lib/role-earnings";
import { peso } from "@/lib/wavewallet";

const EMPTY: NetEarnings = {
  earnings: EMPTY_PERIOD_TOTALS,
  expenses: EMPTY_PERIOD_TOTALS,
  net: EMPTY_PERIOD_TOTALS,
};

export function AdminEarningsPanel({
  ecosystemId,
  showLink = true,
}: {
  ecosystemId: string | null;
  showLink?: boolean;
}) {
  const [totals, setTotals] = useState<NetEarnings>(EMPTY);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!ecosystemId) return;
    const from = new Date();
    from.setMonth(0, 1);
    from.setHours(0, 0, 0, 0);
    try {
      const [rows, expenses] = await Promise.all([
        fetchEarnings({ ecosystemId, from, to: new Date() }),
        fetchExpenses({ scope: "ecosystem", ecosystemId, from }),
      ]);
      setTotals(adminNetEarnings(rows, expenses));
    } catch {
      setTotals(EMPTY);
    } finally {
      setLoading(false);
    }
  }, [ecosystemId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <PageSection
      title="Shop cashflow"
      description="What the shop keeps from completed voucher sales after reseller and subreseller cashback, less recorded expenses. Platform-issued credits, cash-ins, transfers and withdrawal holds are never shop earnings."
    >
      <PeriodEarningsTable
        loading={loading}
        format={peso}
        metrics={[
          {
            label: "Shop earnings retained",
            hint: "Completed sales less downline cashback",
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
            hint: "Shop earnings less expenses",
            totals: totals.net,
            tone: "brand",
            emphasis: true,
          },
        ]}
      />
      {showLink ? (
        <Button asChild variant="outline" size="sm" className="mt-3">
          <Link to="/admin/reports">
            Open earnings, expenses & reports <ArrowRight className="size-4" />
          </Link>
        </Button>
      ) : null}
    </PageSection>
  );
}
