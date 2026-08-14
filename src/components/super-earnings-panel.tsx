/**
 * Platform owner earnings rollup.
 *
 * Super Admin earnings are collected cash-out fees ONLY — the fee snapshotted
 * on each withdrawal at submission and kept when the withdrawal was released.
 * Credit issuance, approved cash in, shop credit supply, member balances and
 * every other credit movement are explicitly NOT platform earnings. Recorded
 * platform expenses reduce the net figure only.
 */
import { useCallback, useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageSection } from "@/components/ui-kit";
import { PeriodEarningsTable } from "@/components/period-earnings-table";
import { EMPTY_PERIOD_TOTALS } from "@/lib/earnings";
import { fetchExpenses } from "@/lib/expenses";
import { fetchCashOutFees } from "@/lib/platform-earnings";
import { platformNetEarnings, type NetEarnings } from "@/lib/role-earnings";
import { peso } from "@/lib/wavewallet";

const EMPTY: NetEarnings = {
  earnings: EMPTY_PERIOD_TOTALS,
  expenses: EMPTY_PERIOD_TOTALS,
  net: EMPTY_PERIOD_TOTALS,
};

export function SuperEarningsPanel({ showLink = true }: { showLink?: boolean }) {
  const [totals, setTotals] = useState<NetEarnings>(EMPTY);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const from = new Date();
    from.setMonth(0, 1);
    from.setHours(0, 0, 0, 0);
    try {
      const [fees, expenses] = await Promise.all([
        fetchCashOutFees({ from }),
        fetchExpenses({ scope: "platform", from }),
      ]);
      setTotals(platformNetEarnings(fees, expenses));
    } catch {
      setTotals(EMPTY);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <PageSection
      title="Platform earnings"
      description="Cash-out fees actually collected on released withdrawals, less recorded platform expenses. Credit issuance, cash in and other credit movements are not earnings."
    >
      <PeriodEarningsTable
        loading={loading}
        format={peso}
        metrics={[
          {
            label: "Cash-out fees collected",
            hint: "Released withdrawals only",
            totals: totals.earnings,
            tone: "positive",
          },
          {
            label: "Platform expenses",
            hint: "Recorded operating costs",
            totals: totals.expenses,
            tone: "negative",
          },
          {
            label: "Net platform earnings",
            hint: "Fees less expenses",
            totals: totals.net,
            tone: "brand",
            emphasis: true,
          },
        ]}
      />
      {showLink ? (
        <Button asChild variant="outline" size="sm" className="mt-3">
          <Link to="/super/reports">
            Open platform reports & expenses <ArrowRight className="size-4" />
          </Link>
        </Button>
      ) : null}
    </PageSection>
  );
}
