import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState, PageSection, StatusBadge } from "@/components/ui-kit";
import { useSession } from "@/lib/session";
import { peso, shortDateTime } from "@/lib/wavewallet";
import {
  creditSourceLabel,
  fetchCreditLedger,
  fetchCreditLots,
  fetchMyPurchases,
  type CreditEntry,
  type CreditLot,
} from "@/lib/wallet";


export const Route = createFileRoute("/app/history")({
  head: () => ({
    meta: [
      { title: "Transaction History — WaveWallet" },
      {
        name: "description",
        content:
          "Complete history of credit movements and voucher purchases, each with its unique transaction ID and issued code.",
      },
      { property: "og:title", content: "Transaction History — WaveWallet" },
      {
        property: "og:description",
        content: "Credit movements and voucher purchases with transaction IDs and issued codes.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CustomerHistory,
});

type Purchase = Awaited<ReturnType<typeof fetchMyPurchases>>[number];

function CustomerHistory() {
  const { account } = useSession("customer");
  const [filter, setFilter] = useState("all");
  const [entries, setEntries] = useState<CreditEntry[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [lots, setLots] = useState<CreditLot[]>([]);
  const [loading, setLoading] = useState(true);
  const userId = account?.id ?? null;

  const load = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    const [l, p, k] = await Promise.all([
      fetchCreditLedger(userId, 100),
      fetchMyPurchases(userId),
      fetchCreditLots(userId),
    ]);
    setEntries(l);
    setPurchases(p);
    setLots(k);
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!account) return null;

  return (
    <PageSection title="Transaction history" description="Every movement carries a unique transaction ID.">
      <Tabs value={filter} onValueChange={setFilter} className="mb-3">
        <TabsList className="flex w-full flex-wrap justify-start">
          <TabsTrigger value="all">Credits</TabsTrigger>
          <TabsTrigger value="vouchers">Vouchers</TabsTrigger>
          <TabsTrigger value="sources">Sources</TabsTrigger>
        </TabsList>
      </Tabs>

      {loading ? (
        <EmptyState title="Loading history…" />
      ) : filter === "sources" ? (
        lots.length === 0 ? (
          <EmptyState
            title="No credits received yet"
            description="Credits you receive are tracked by source and spent oldest-first."
          />
        ) : (
          <Card className="shadow-[var(--shadow-card)]">
            <CardContent className="divide-y divide-border px-0 py-0">
              {lots.map((lot) => (
                <div key={lot.id} className="flex items-start justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{creditSourceLabel(lot)}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {shortDateTime(lot.created_at)} · received {peso(lot.amount)}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p
                      className={
                        lot.remaining > 0
                          ? "text-sm font-semibold text-success"
                          : "text-sm font-semibold text-muted-foreground"
                      }
                    >
                      {peso(lot.remaining)}
                    </p>
                    <p className="text-[11px] text-muted-foreground">{lot.remaining > 0 ? "left" : "fully spent"}</p>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )
      ) : filter === "vouchers" ? (

        purchases.length === 0 ? (
          <EmptyState title="No voucher purchases yet" description="Buy a voucher from the shop to see it here." />
        ) : (
          <Card className="shadow-[var(--shadow-card)]">
            <CardContent className="divide-y divide-border px-0 py-0">
              {purchases.map((p) => (
                <div key={p.id} className="space-y-1 px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{p.product_name}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {shortDateTime(p.created_at)} · {p.tx_id} · {p.payment_method}
                      </p>
                    </div>
                    <p className="text-sm font-semibold text-destructive">−{peso(p.sale_price)}</p>
                  </div>
                  {p.code ? (
                    <p className="font-mono text-sm font-semibold tracking-widest text-success">{p.code}</p>
                  ) : (
                    <StatusBadge tone="muted">Code unavailable</StatusBadge>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        )
      ) : entries.length === 0 ? (
        <EmptyState title="Nothing here yet" description="Transactions will appear as you use your wallet." />
      ) : (
        <Card className="shadow-[var(--shadow-card)]">
          <CardContent className="divide-y divide-border px-0 py-0">
            {entries.map((e) => (
              <div key={e.id} className="flex items-start justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{e.reason}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {shortDateTime(e.created_at)} · {e.tx_id ?? "—"}
                    {e.reference ? ` · ${e.reference}` : ""}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p
                    className={
                      e.direction === "credit"
                        ? "text-sm font-semibold text-success"
                        : "text-sm font-semibold text-destructive"
                    }
                  >
                    {e.direction === "credit" ? "+" : "−"}
                    {peso(e.amount)}
                  </p>
                  <p className="text-[11px] text-muted-foreground">Bal {peso(e.balance_after)}</p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </PageSection>
  );
}
