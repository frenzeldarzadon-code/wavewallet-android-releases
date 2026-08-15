/**
 * Reseller / subreseller wallet + earnings: their shop wallet balance shown
 * separately from cashback earned, discount savings and the combined total,
 * for daily / monthly / quarterly / yearly / lifetime periods.
 *
 * Everything is derived from the same ledger-backed earnings records as the
 * earnings history page: cashback comes from the allocation recorded on each
 * completed purchase, at the rates snapshotted then. Transfers, cash in and
 * issued credits are wallet movements, never earnings.
 */
import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowRight, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageSection, StatCard } from "@/components/ui-kit";
import { PeriodEarningsTable } from "@/components/period-earnings-table";
import { fetchEarnings, lifetimeFrom, EMPTY_PERIOD_TOTALS } from "@/lib/earnings";
import { sellerEarnings, type SellerEarnings } from "@/lib/role-earnings";
import { fetchCreditBalance } from "@/lib/wallet";
import { peso } from "@/lib/wavewallet";

const EMPTY: SellerEarnings = {
  cashback: EMPTY_PERIOD_TOTALS,
  discount: EMPTY_PERIOD_TOTALS,
  total: EMPTY_PERIOD_TOTALS,
};

export function SellerEarningsPanel({
  recipientId,
  ecosystemId = null,
  showBalance = true,
}: {
  recipientId: string;
  ecosystemId?: string | null;
  showBalance?: boolean;
}) {
  const [totals, setTotals] = useState<SellerEarnings>(EMPTY);
  const [balance, setBalance] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    const from = lifetimeFrom();
    void Promise.all([
      fetchEarnings({ recipientId, from, to: new Date() }),
      showBalance ? fetchCreditBalance(recipientId, ecosystemId) : Promise.resolve(null),
    ])
      .then(([rows, walletBalance]) => {
        if (!live) return;
        setTotals(sellerEarnings(rows));
        setBalance(walletBalance);
      })
      .catch(() => {
        if (live) setTotals(EMPTY);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [recipientId, ecosystemId, showBalance]);

  return (
    <PageSection
      title="Wallet & earnings"
      description="Your shop wallet balance, plus cashback allocated to you on completed downline purchases and your own wholesale discount savings. Receiving or sending credits is never an earning."
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {showBalance ? (
          <StatCard
            label="Shop wallet balance"
            value={loading || balance === null ? "—" : peso(balance)}
            icon={Wallet}
            tone="brand"
            hint="Credits held in your wallet for this shop"
          />
        ) : null}
        <StatCard
          label="Total earnings"
          value={loading ? "—" : peso(totals.total.total)}
          tone="positive"
          hint="Lifetime cashback + discount savings"
        />
      </div>

      <div className="mt-3">
        <PeriodEarningsTable
          loading={loading}
          format={peso}
          metrics={[
            {
              label: "Cashback earnings",
              hint: "Allocated to you on completed downline purchases",
              totals: totals.cashback,
              tone: "positive",
            },
            {
              label: "Discount earnings",
              hint: "Wholesale discount saved on your own purchases",
              totals: totals.discount,
              tone: "brand",
            },
            {
              label: "Total earnings",
              hint: "Cashback + discount, counted once",
              totals: totals.total,
              tone: "brand",
              emphasis: true,
            },
          ]}
        />
      </div>

      <Button asChild variant="outline" size="sm" className="mt-3">
        <Link to="/reseller/earnings">
          Open earnings history <ArrowRight className="size-4" />
        </Link>
      </Button>
    </PageSection>
  );
}
