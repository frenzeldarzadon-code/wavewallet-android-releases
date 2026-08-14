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
import {
  cashInFeePeriodTotals,
  fetchCashInFees,
  fetchCashOutFees,
  fetchShopTransferFees,
  feePeriodTotals,
  transferFeePeriodTotals,
} from "@/lib/platform-earnings";
import { platformNetEarnings, type NetEarnings } from "@/lib/role-earnings";
import { peso } from "@/lib/wavewallet";

const EMPTY_TOTALS = EMPTY_PERIOD_TOTALS;

const EMPTY: NetEarnings = {
  earnings: EMPTY_PERIOD_TOTALS,
  expenses: EMPTY_PERIOD_TOTALS,
  net: EMPTY_PERIOD_TOTALS,
};

export function SuperEarningsPanel({ showLink = true }: { showLink?: boolean }) {
  const [totals, setTotals] = useState<NetEarnings>(EMPTY);
  const [transferFees, setTransferFees] = useState(EMPTY_TOTALS);
  const [cashOutFees, setCashOutFees] = useState(EMPTY_TOTALS);
  const [cashInFees, setCashInFees] = useState(EMPTY_TOTALS);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const from = new Date();
    from.setMonth(0, 1);
    from.setHours(0, 0, 0, 0);
    try {
      const [fees, expenses, transfers, cashIns] = await Promise.all([
        fetchCashOutFees({ from }),
        fetchExpenses({ scope: "platform", from }),
        fetchShopTransferFees({ from }),
        fetchCashInFees({ from }).catch(() => []),
      ]);
      setTotals(platformNetEarnings(fees, expenses, cashIns));
      setTransferFees(transferFeePeriodTotals(transfers));
      setCashOutFees(feePeriodTotals(fees));
      setCashInFees(cashInFeePeriodTotals(cashIns));
    } catch {
      setTotals(EMPTY);
      setTransferFees(EMPTY_TOTALS);
      setCashOutFees(EMPTY_TOTALS);
      setCashInFees(EMPTY_TOTALS);
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
      description="Fees actually collected — cash-out fees on released withdrawals and cash-in fees on verified payments — less recorded platform expenses. Credit issuance and other credit movements are not earnings."
    >
      <PeriodEarningsTable
        loading={loading}
        format={peso}
        metrics={[
          {
            label: "Cash-out fees collected",
            hint: "Released withdrawals only",
            totals: cashOutFees,
            tone: "positive",
          },
          {
            label: "Cash-in fees collected",
            hint: "Verified cash in payments only",
            totals: cashInFees,
            tone: "positive",
          },
          {
            label: "Total fees collected",
            hint: "Cash out + cash in",
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
      <div className="mt-4">
        <p className="mb-2 text-xs text-muted-foreground">
          Shop-to-shop transfer fees are collected in credits, so they are reported separately from peso
          cash-out fees.
        </p>
        <PeriodEarningsTable
          loading={loading}
          format={(n) => `${n.toLocaleString()} credits`}
          metrics={[
            {
              label: "Shop transfer fees collected",
              hint: "Flat fee on member shop-to-shop credit transfers",
              totals: transferFees,
              tone: "positive",
            },
          ]}
        />
      </div>
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
