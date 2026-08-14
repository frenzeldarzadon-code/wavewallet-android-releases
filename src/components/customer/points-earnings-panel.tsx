/**
 * Customer dashboard earnings — points only.
 *
 * Customers deliberately see no credit-to-cash valuation, margin, commission
 * or cashback derivation on their dashboard. Points earned come straight from
 * the points ledger's `earn` entries.
 */
import { useEffect, useState } from "react";
import { PageSection } from "@/components/ui-kit";
import { PeriodEarningsTable } from "@/components/period-earnings-table";
import { supabase } from "@/integrations/supabase/client";
import { EMPTY_PERIOD_TOTALS, type PeriodTotals } from "@/lib/earnings";
import { pointsEarnings, type PointsEarningRow } from "@/lib/role-earnings";

export function PointsEarningsPanel({
  userId,
  ecosystemId,
}: {
  userId: string;
  /** Points, like credits, belong to one shop membership. */
  ecosystemId: string | null;
}) {
  const [totals, setTotals] = useState<PeriodTotals>(EMPTY_PERIOD_TOTALS);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    const from = new Date();
    from.setMonth(0, 1);
    from.setHours(0, 0, 0, 0);
    void (async () => {
      const scoped = supabase
        .from("points_ledger")
        .select("entry_type, direction, amount, created_at")
        .eq("user_id", userId);
      const { data } = await (ecosystemId
        ? scoped.eq("ecosystem_id", ecosystemId)
        : scoped.is("ecosystem_id", null)
      )
        .gte("created_at", from.toISOString())
        .order("created_at", { ascending: false })
        .limit(1000);
      if (!live) return;
      const rows = ((data ?? []) as unknown as PointsEarningRow[]).map((r) => ({
        ...r,
        amount: Number(r.amount),
      }));
      setTotals(pointsEarnings(rows));
      setLoading(false);
    })();
    return () => {
      live = false;
    };
  }, [userId, ecosystemId]);

  return (
    <PageSection
      title="Points earnings"
      description="Points you earned from purchases. Open your transaction history for the full detail."
    >
      <PeriodEarningsTable
        loading={loading}
        format={(v) => `${Math.round(v)} pts`}
        metrics={[
          {
            label: "Points earned",
            hint: "Credited to your points balance",
            totals,
            tone: "brand",
            emphasis: true,
          },
        ]}
      />
    </PageSection>
  );
}
