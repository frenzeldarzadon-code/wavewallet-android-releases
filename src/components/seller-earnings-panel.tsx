/**
 * Reseller / subreseller dashboard earnings: cashback, discount savings and
 * their total, for daily / monthly / quarterly / yearly periods. Everything is
 * derived from the same ledger-backed earnings records as the earnings history
 * page; transfers, cash in and issued credits never appear.
 */
import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageSection } from "@/components/ui-kit";
import { PeriodEarningsTable } from "@/components/period-earnings-table";
import { fetchEarnings, EMPTY_PERIOD_TOTALS } from "@/lib/earnings";
import { sellerEarnings, type SellerEarnings } from "@/lib/role-earnings";
import { peso } from "@/lib/wavewallet";

const EMPTY: SellerEarnings = {
  cashback: EMPTY_PERIOD_TOTALS,
  discount: EMPTY_PERIOD_TOTALS,
  total: EMPTY_PERIOD_TOTALS,
};

export function SellerEarningsPanel({ recipientId }: { recipientId: string }) {
  const [totals, setTotals] = useState<SellerEarnings>(EMPTY);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    const from = new Date();
    from.setMonth(0, 1);
    from.setHours(0, 0, 0, 0);
    void fetchEarnings({ recipientId, from, to: new Date() })
      .then((rows) => {
        if (live) setTotals(sellerEarnings(rows));
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
  }, [recipientId]);

  return (
    <PageSection
      title="My earnings"
      description="Cashback earned on completed downline purchases plus your wholesale discount savings. Open the full history for transaction-level detail."
    >
      <PeriodEarningsTable
        loading={loading}
        format={peso}
        metrics={[
          {
            label: "Cashback earnings",
            hint: "From completed downline purchases",
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
            hint: "Cashback + discount",
            totals: totals.total,
            tone: "brand",
            emphasis: true,
          },
        ]}
      />
      <Button asChild variant="outline" size="sm" className="mt-3">
        <Link to="/reseller/earnings">
          Open earnings history <ArrowRight className="size-4" />
        </Link>
      </Button>
    </PageSection>
  );
}
