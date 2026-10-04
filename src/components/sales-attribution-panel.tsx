import { useEffect, useMemo, useState } from "react";
import { PageSection, StatCard } from "@/components/ui-kit";
import {
  fetchAttributedCodes,
  fetchCodeUsage,
  fetchSalesAttribution,
  rangedSales,
  type AttributedSale,
  type DateRange,
  type SaleCode,
  type SalesFigure,
} from "@/lib/sales-attribution";
import type { VoucherState } from "@/lib/omada-voucher-view";
import { peso } from "@/lib/wavewallet";

const LIFETIME: DateRange = { start: new Date(0), end: new Date(8.64e15) };

/**
 * Projected vs Actual sales, attributed to whoever generated each voucher.
 * Projected = sold in the range (sale date). Actual = used in the range
 * (first-use date), same scope and attribution.
 */
export function SalesAttributionPanel({
  ecosystemId,
  hasNetwork,
  range,
  rangeLabel,
}: {
  ecosystemId: string | null;
  hasNetwork: boolean;
  range?: DateRange;
  rangeLabel?: string;
}) {
  const [rows, setRows] = useState<AttributedSale[] | null>(null);
  const [usage, setUsage] = useState<{
    codes: SaleCode[];
    statuses: Record<string, VoucherState | null>;
    usedAt: Record<string, string>;
  } | null>(null);

  useEffect(() => {
    let live = true;
    setRows(null);
    setUsage(null);
    if (!ecosystemId) return;
    void fetchSalesAttribution(ecosystemId)
      .then((r) => live && setRows(r))
      .catch(() => live && setRows([]));
    void fetchAttributedCodes(ecosystemId)
      .then(async (codes) => {
        const u = await fetchCodeUsage(ecosystemId, codes.map((c) => c.code));
        if (live) setUsage({ codes, ...u });
      })
      .catch(() => live && setUsage({ codes: [], statuses: {}, usedAt: {} }));
    return () => {
      live = false;
    };
  }, [ecosystemId]);

  const r = range ?? LIFETIME;
  const startMs = r.start.getTime();
  const endMs = r.end.getTime();
  const data = useMemo(() => {
    if (!rows) return null;
    const rr = { start: new Date(startMs), end: new Date(endMs) };
    return rangedSales(rows, usage?.codes ?? [], usage?.statuses ?? {}, usage?.usedAt ?? {}, rr);
  }, [rows, usage, startMs, endMs]);

  const fig = (f?: SalesFigure) => (f ? peso(f.amount) : "—");
  const projHint = (f?: SalesFigure) =>
    f ? `${f.vouchers} vouchers sold · ${f.sales} purchases` : "Loading…";
  const actHint = (f?: SalesFigure) =>
    !usage ? "Checking which vouchers were used…" : f ? `${f.vouchers} vouchers used` : "Loading…";
  const actual = usage ? data?.actual : undefined;

  return (
    <PageSection
      devSlot="sales-attribution-panel.sales"
      title="Sales: projected vs actual"
      description={`${rangeLabel ? `${rangeLabel}. ` : range ? "" : "Lifetime. "}Projected = vouchers sold in this period. Actual = vouchers actually used in this period, even if sold earlier. Each sale belongs to whoever generated the voucher; cashback is an earning, never a sale.`}
    >
      <div className={hasNetwork ? "grid gap-3 sm:grid-cols-2 lg:grid-cols-3" : "grid gap-3 sm:grid-cols-2"}>
        <StatCard label="My sales · projected" value={fig(data?.projected.own)} hint={projHint(data?.projected.own)} tone="brand" />
        {hasNetwork ? (
          <>
            <StatCard label="Network sales · projected" value={fig(data?.projected.network)} hint={projHint(data?.projected.network)} tone="positive" />
            <StatCard label="Total · projected" value={fig(data?.projected.combined)} hint="My + network, each counted once" />
          </>
        ) : null}
        <StatCard label="My sales · actual" value={fig(actual?.own)} hint={actHint(actual?.own)} tone="brand" />
        {hasNetwork ? (
          <>
            <StatCard label="Network sales · actual" value={fig(actual?.network)} hint={actHint(actual?.network)} tone="positive" />
            <StatCard label="Total · actual" value={fig(actual?.combined)} hint="My + network, each counted once" />
          </>
        ) : null}
      </div>
      {usage && data && data.usedUndated > 0 ? (
        <p className="mt-2 text-[11px] text-muted-foreground">
          {data.usedUndated} used vouchers have no recorded first-use time yet, so they are not placed
          in any period's Actual sales.
        </p>
      ) : null}
      {hasNetwork && data && data.projected.byGenerator.length > 0 ? (
        <div className="mt-3 rounded-xl border border-border p-3 text-sm">
          <p className="font-medium">Network sales by generator (projected · actual)</p>
          <dl className="mt-2 space-y-1">
            {data.projected.byGenerator.slice(0, 20).map((g) => {
              const a = actual?.byGenerator.find((x) => x.id === g.id);
              return (
                <div key={g.id} className="flex justify-between gap-3">
                  <dt className="truncate text-muted-foreground">
                    {g.name} <span className="text-[11px] capitalize">· {g.role}</span>
                  </dt>
                  <dd className="shrink-0 tabular-nums">
                    {peso(g.amount)} · {usage ? peso(a?.amount ?? 0) : "—"}
                  </dd>
                </div>
              );
            })}
          </dl>
        </div>
      ) : null}
    </PageSection>
  );
}
