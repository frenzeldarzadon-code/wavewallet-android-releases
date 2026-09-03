/**
 * SUBSCRIPTION HISTORY — the shop's own subscription transactions.
 *
 * Presentation only. Rows come from `shop_subscription_history`, which reads
 * the existing subscription events, platform-owner expiry adjustments and
 * platform-issued Coins for this shop. The platform owner sees the same rows
 * from the Super Admin console.
 */
import { useCallback, useEffect, useState } from "react";
import { History, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { PageSection, StatusBadge } from "@/components/ui-kit";
import { peso, shortDateTime } from "@/lib/wavewallet";
import {
  fetchSubscriptionHistory,
  historyDetail,
  historySource,
  historyTitle,
  historyTone,
  type SubscriptionHistoryRow,
} from "@/lib/subscription-history";

export function SubscriptionHistoryCard({
  ecosystemId,
  audience = "operator",
  refreshKey = 0,
  bare = false,
}: {
  ecosystemId: string;
  audience?: "operator" | "owner";
  refreshKey?: number;
  /** Renders the list without the surrounding PageSection (e.g. in a dialog). */
  bare?: boolean;
}) {
  const [rows, setRows] = useState<SubscriptionHistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await fetchSubscriptionHistory(ecosystemId));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the subscription history");
    } finally {
      setLoading(false);
    }
  }, [ecosystemId]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const body = loading ? (
    <p className="flex items-center gap-2 px-4 text-sm text-muted-foreground">
      <Loader2 className="size-4 animate-spin" /> Loading subscription history…
    </p>
  ) : error ? (
    <p className="px-4 text-sm text-destructive">{error}</p>
  ) : rows.length === 0 ? (
    <p className="px-4 text-sm text-muted-foreground">
      No subscription transactions yet. Activations, renewals, extensions, plan changes and any
      ONE WAVE adjustments will appear here.
    </p>
  ) : (
    <ul className="divide-y">
      {rows.map((r) => {
        const amount = Number(r.amount_php ?? 0);
        const coins = Number(r.coins ?? 0);
        const detail = historyDetail(r, audience);
        return (
          <li key={`${r.source}-${r.id}`} className="px-4 py-2.5">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-semibold">{historyTitle(r)}</p>
                <p className="text-xs text-muted-foreground">
                  {shortDateTime(r.occurred_at)}
                  {r.actor_name ? ` · ${r.actor_name}` : ""}
                  {r.reference ? ` · Ref ${r.reference}` : ""}
                </p>
                {r.period_end ? (
                  <p className="text-xs text-muted-foreground">
                    {r.period_start ? `${shortDateTime(r.period_start)} → ` : "New expiry "}
                    {shortDateTime(r.period_end)}
                  </p>
                ) : null}
                {detail ? (
                  <p className="text-xs leading-relaxed text-muted-foreground">{detail}</p>
                ) : null}
              </div>
              <div className="text-right">
                <StatusBadge tone={historyTone(r)}>{historySource(r)}</StatusBadge>
                {amount > 0 ? (
                  <p className="mt-1 text-sm font-semibold">{peso(amount)}</p>
                ) : null}
                {coins > 0 ? (
                  <p className="text-xs text-success">+{coins.toLocaleString()} Coins</p>
                ) : null}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );

  if (bare) return <div className="max-h-[60vh] overflow-y-auto">{body}</div>;

  return (
    <PageSection
      devSlot="subscription-history-card.subscription-history"
      title="Subscription history"
      description="Every activation, renewal, extension, plan change and WaveWallet adjustment for this shop — the same records ONE WAVE reviews."
    >
      <Card className="shadow-[var(--shadow-card)]">
        <CardContent className="px-0">
          <p className="flex items-center gap-2 px-4 pb-2 text-xs text-muted-foreground">
            <History className="size-3.5" /> Most recent first
          </p>
          {body}
        </CardContent>
      </Card>
    </PageSection>
  );
}
