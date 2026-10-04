import { useEffect, useState } from "react";
import { PageSection, StatCard } from "@/components/ui-kit";
import {
  fetchSalesAttribution,
  summariseAttribution,
  type SalesAttribution,
} from "@/lib/sales-attribution";
import { peso } from "@/lib/wavewallet";

/** My Sales vs Network Sales, attributed to whoever generated each voucher. */
export function SalesAttributionPanel({
  ecosystemId,
  hasNetwork,
}: {
  ecosystemId: string | null;
  hasNetwork: boolean;
}) {
  const [data, setData] = useState<SalesAttribution | null>(null);

  useEffect(() => {
    let live = true;
    setData(null);
    if (!ecosystemId) return;
    void fetchSalesAttribution(ecosystemId)
      .then((rows) => live && setData(summariseAttribution(rows)))
      .catch(() => live && setData(summariseAttribution([])));
    return () => {
      live = false;
    };
  }, [ecosystemId]);

  const fig = (f?: { amount: number; vouchers: number; sales: number }) =>
    f ? peso(f.amount) : "—";
  const hint = (f?: { vouchers: number; sales: number }) =>
    f ? `${f.vouchers} vouchers · ${f.sales} purchases` : undefined;

  return (
    <PageSection
      devSlot="sales-attribution-panel.sales"
      title="Sales"
      description={
        hasNetwork
          ? "Each sale belongs to whoever generated the voucher. Cashback you earn from your network is an earning, never your sale."
          : "Vouchers you generated yourself. Cashback is an earning, never a sale."
      }
    >
      <div className={hasNetwork ? "grid gap-3 sm:grid-cols-3" : "grid gap-3"}>
        <StatCard label="My sales" value={fig(data?.own)} hint={hint(data?.own)} tone="brand" />
        {hasNetwork ? (
          <>
            <StatCard
              label="Network sales"
              value={fig(data?.network)}
              hint={hint(data?.network)}
              tone="positive"
            />
            <StatCard
              label="Total (overview)"
              value={fig(data?.combined)}
              hint="My sales + network sales, each counted once"
            />
          </>
        ) : null}
      </div>
      {hasNetwork && data && data.byGenerator.length > 0 ? (
        <div className="mt-3 rounded-xl border border-border p-3 text-sm">
          <p className="font-medium">Network sales by generator</p>
          <dl className="mt-2 space-y-1">
            {data.byGenerator.slice(0, 20).map((g) => (
              <div key={g.id} className="flex justify-between gap-3">
                <dt className="truncate text-muted-foreground">
                  {g.name} <span className="text-[11px] capitalize">· {g.role}</span>
                </dt>
                <dd className="shrink-0 tabular-nums">
                  {peso(g.amount)} · {g.vouchers}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}
    </PageSection>
  );
}
