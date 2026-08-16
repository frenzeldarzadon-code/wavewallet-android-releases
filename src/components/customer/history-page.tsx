/**
 * Unified transaction history (credits, vouchers, transfers, rewards),
 * shared by the member and reseller consoles. Read-only: no historical record
 * is modified here.
 */
import { useCallback, useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

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


type Purchase = Awaited<ReturnType<typeof fetchMyPurchases>>[number];

export interface HistoryPageProps {
  /** Read another shop wallet the caller owns; defaults to the active shop. */
  ecosystemId?: string | null;
  /** Shop name, shown so it is clear which wallet the history belongs to. */
  shopName?: string;
  /** Optional shop filter — every wallet the caller owns. */
  shopOptions?: { ecosystemId: string; ecosystemName: string }[];
  /** Called when the shop filter changes. */
  onShopChange?: (ecosystemId: string) => void;
}

export function HistoryPage({ ecosystemId, shopName, shopOptions, onShopChange }: HistoryPageProps = {}) {
  const { account, ecosystemDbId } = useSession();
  const [filter, setFilter] = useState("all");
  const [direction, setDirection] = useState<"all" | "coin" | "debit">("all");
  const [entries, setEntries] = useState<CreditEntry[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [lots, setLots] = useState<CreditLot[]>([]);
  const [loading, setLoading] = useState(true);
  const userId = account?.id ?? null;
  const scopeId = ecosystemId === undefined ? ecosystemDbId : ecosystemId;

  const load = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    const [l, p, k] = await Promise.all([
      fetchCreditLedger(userId, scopeId, 100),
      fetchMyPurchases(userId, scopeId),
      fetchCreditLots(userId, scopeId),
    ]);
    setEntries(l);
    setPurchases(p);
    setLots(k);
    setLoading(false);
  }, [userId, scopeId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!account) return null;

  const visibleEntries =
    direction === "all" ? entries : entries.filter((e) => e.direction === direction);

  return (
    <PageSection
      title="All wallet transactions"
      description={
        shopName
          ? `${shopName} · every movement carries a unique transaction ID.`
          : "Every movement carries a unique transaction ID."
      }
    >

      <Tabs value={filter} onValueChange={setFilter} className="mb-3">
        <TabsList className="flex w-full flex-wrap justify-start">
          <TabsTrigger value="all">Coins</TabsTrigger>
          <TabsTrigger value="vouchers">Vouchers</TabsTrigger>
          <TabsTrigger value="sources">Sources</TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="mb-3 grid gap-2 sm:grid-cols-2">
        {shopOptions && shopOptions.length > 1 && onShopChange ? (
          <Select {...(scopeId ? { value: scopeId } : {})} onValueChange={onShopChange}>
            <SelectTrigger className="h-11" aria-label="Filter by shop">
              <SelectValue placeholder="All shops" />
            </SelectTrigger>
            <SelectContent>
              {shopOptions.map((s) => (
                <SelectItem key={s.ecosystemId} value={s.ecosystemId}>
                  {s.ecosystemName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
        {filter === "all" ? (
          <Select value={direction} onValueChange={(v) => setDirection(v as typeof direction)}>
            <SelectTrigger className="h-11" aria-label="Filter by direction">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All directions</SelectItem>
              <SelectItem value="coin">Money in</SelectItem>
              <SelectItem value="debit">Money out</SelectItem>
            </SelectContent>
          </Select>
        ) : null}
      </div>


      {loading ? (
        <EmptyState title="Loading history…" />
      ) : filter === "sources" ? (
        lots.length === 0 ? (
          <EmptyState
            title="No coins received yet"
            description="Coins you receive are tracked by source and spent oldest-first."
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
      ) : visibleEntries.length === 0 ? (
        <EmptyState title="Nothing here yet" description="Transactions will appear as you use your wallet." />
      ) : (
        <Card className="shadow-[var(--shadow-card)]">
          <CardContent className="divide-y divide-border px-0 py-0">
            {visibleEntries.map((e) => (

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
                      e.direction === "coin"
                        ? "text-sm font-semibold text-success"
                        : "text-sm font-semibold text-destructive"
                    }
                  >
                    {e.direction === "coin" ? "+" : "−"}
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
