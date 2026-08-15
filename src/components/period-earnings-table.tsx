/**
 * Compact daily / monthly / quarterly / yearly earnings matrix.
 *
 * One row per metric, one column per period, so a dashboard can present a
 * role's earnings for every period without a wall of stat cards. Values are
 * always pre-computed by the caller from ledger-backed records.
 */
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { PeriodTotals } from "@/lib/earnings";

export interface PeriodMetric {
  label: string;
  hint?: string;
  totals: PeriodTotals;
  tone?: "neutral" | "positive" | "negative" | "brand";
  emphasis?: boolean;
}

const toneClass = (tone: PeriodMetric["tone"]) =>
  tone === "positive"
    ? "text-success"
    : tone === "negative"
      ? "text-destructive"
      : tone === "brand"
        ? "text-primary"
        : "text-foreground";

const COLUMNS: { key: keyof PeriodTotals; label: string }[] = [
  { key: "today", label: "Daily" },
  { key: "month", label: "Monthly" },
  { key: "quarter", label: "Quarterly" },
  { key: "year", label: "Yearly" },
  { key: "total", label: "Total" },
];


export function PeriodEarningsTable({
  metrics,
  format,
  loading = false,
}: {
  metrics: PeriodMetric[];
  format: (value: number) => string;
  loading?: boolean;
}) {
  const show = (v: number) => (loading ? "—" : format(v));
  return (
    <Card className="overflow-hidden py-0 shadow-[var(--shadow-card)]">
      <CardContent className="px-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-[11px] uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-2 text-left font-medium">Earnings</th>
                {COLUMNS.map((c) => (
                  <th key={c.key} className="px-3 py-2 text-right font-medium">
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {metrics.map((m) => (
                <tr key={m.label} className={cn("border-b border-border last:border-0", m.emphasis && "bg-muted/40")}>
                  <td className="px-4 py-3">
                    <p className={cn("font-medium", m.emphasis && "font-semibold")}>{m.label}</p>
                    {m.hint ? <p className="text-[11px] text-muted-foreground">{m.hint}</p> : null}
                  </td>
                  {COLUMNS.map((c) => (
                    <td
                      key={c.key}
                      className={cn(
                        "px-3 py-3 text-right tabular-nums",
                        toneClass(m.tone),
                        m.emphasis && "font-semibold",
                      )}
                    >
                      {show(m.totals[c.key])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
