import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageSection, StatCard } from "@/components/ui-kit";
import { peso } from "@/lib/wavewallet";
import {
  fetchEarnings,
  periodTotals,
  type EarningType,
  type PeriodTotals,
} from "@/lib/earnings";

const EMPTY: PeriodTotals = { today: 0, month: 0, quarter: 0, year: 0, total: 0 };

/**
 * Today / month / quarter / year rollup for one audience, computed from the
 * same ledger-backed earnings records as the full history page.
 */
export function EarningsSummaryCards({
  title,
  description,
  types,
  recipientId,
  ecosystemId,
  linkTo,
  linkLabel = "Open earnings history",
}: {
  title: string;
  description: string;
  types: EarningType[];
  recipientId?: string | null;
  ecosystemId?: string | null;
  linkTo?: string;
  linkLabel?: string;
}) {
  const [totals, setTotals] = useState<PeriodTotals>(EMPTY);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    const from = new Date();
    from.setMonth(0, 1);
    from.setHours(0, 0, 0, 0);
    void fetchEarnings({
      recipientId: recipientId ?? null,
      ecosystemId: ecosystemId ?? null,
      from,
      to: new Date(),
    })
      .then((rows) => {
        if (live) setTotals(periodTotals(rows, types));
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recipientId, ecosystemId, types.join(",")]);

  const show = (v: number) => (loading ? "—" : peso(v));

  return (
    <PageSection devSlot="earnings-summary-cards.earnings-summary-s" title={title} description={description}>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Today" value={show(totals.today)} tone="positive" />
        <StatCard label="This month" value={show(totals.month)} tone="positive" />
        <StatCard label="This quarter" value={show(totals.quarter)} tone="brand" />
        <StatCard label="This year" value={show(totals.year)} tone="brand" />
      </div>
      {linkTo ? (
        <Button asChild variant="outline" size="sm" className="mt-3">
          <Link to={linkTo}>
            {linkLabel} <ArrowRight className="size-4" />
          </Link>
        </Button>
      ) : null}
    </PageSection>
  );
}
