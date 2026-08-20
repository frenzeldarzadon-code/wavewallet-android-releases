/**
 * Unified transaction history (credits, vouchers, transfers, rewards),
 * shared by the member and reseller consoles. Read-only: no historical record
 * is modified here.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Download, Printer, Share2 } from "lucide-react";
import { toast } from "sonner";
import {
  downloadBlob,
  renderVoucherImage,
  shareVoucherImage,
  voucherFileName,
  type VoucherImageData,
} from "@/lib/voucher-image";
import { Button } from "@/components/ui/button";
import { buildCoinHistory, cashbackSummary, filterCoinHistory } from "@/lib/coin-history";
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
  const [direction, setDirection] = useState<"all" | "credit" | "debit">("all");
  const [entries, setEntries] = useState<CreditEntry[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [lots, setLots] = useState<CreditLot[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
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

  // Presentation-only grouping: one voucher purchase renders as one row, with
  // the viewer's own cashback summarised inside it. No amounts are recomputed.
  const rows = useMemo(() => buildCoinHistory(entries), [entries]);
  const visibleRows = useMemo(() => filterCoinHistory(rows, direction), [rows, direction]);

  // Presentation only: re-renders the image for a voucher already issued.
  const voucherImageData = (p: Purchase): VoucherImageData => ({
    code: p.code ?? "",
    productName: p.product_name,
    description: null,
    priceLabel: peso(Number(p.list_price ?? p.sale_price)),
    shopName: shopName ?? "WaveWallet",
    customerName: null,
    paymentStatus: null,
    index: 1,
    total: 1,
    txId: p.tx_id,
    issuedAt: new Date(p.created_at),
  });

  const saveVoucher = async (p: Purchase) => {
    if (!p.code) return;
    setBusyId(p.id);
    try {
      const data = voucherImageData(p);
      const blob = await renderVoucherImage(data);
      await downloadBlob(blob, voucherFileName(data));
      toast.success("Voucher image saved");
    } catch (e) {
      toast.error("Could not save the image", { description: (e as Error).message });
    } finally {
      setBusyId(null);
    }
  };

  const shareVoucher = async (p: Purchase) => {
    if (!p.code) return;
    setBusyId(p.id);
    try {
      const data = voucherImageData(p);
      const blob = await renderVoucherImage(data);
      const outcome = await shareVoucherImage(blob, voucherFileName(data), p.product_name);
      if (outcome === "shared") toast.success("Shared");
      else if (outcome === "downloaded") toast.success("Sharing isn't available here — image saved");
    } catch (e) {
      toast.error("Could not share the image", { description: (e as Error).message });
    } finally {
      setBusyId(null);
    }
  };

  if (!account) return null;


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
              <SelectItem value="credit">Money in</SelectItem>
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
                  {/* Presentation only: Download | Share | Print act on the
                      exact voucher already issued by this transaction. */}
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={!p.code || busyId === p.id}
                      onClick={() => void saveVoucher(p)}
                    >
                      <Download className="size-4" /> Download
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={!p.code || busyId === p.id}
                      onClick={() => void shareVoucher(p)}
                    >
                      <Share2 className="size-4" /> Share
                    </Button>
                    <Button asChild variant="outline" size="sm">
                      <Link to="/print/vouchers/$saleId" params={{ saleId: p.id }}>
                        <Printer className="size-4" /> Print
                      </Link>
                    </Button>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )
      ) : visibleRows.length === 0 ? (
        <EmptyState title="Nothing here yet" description="Transactions will appear as you use your wallet." />
      ) : (
        <Card className="shadow-[var(--shadow-card)]">
          <CardContent className="divide-y divide-border px-0 py-0">
            {visibleRows.map((row) => {
              const open = expanded === row.id;
              return (
                <div key={row.id} className="px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="break-words text-sm font-medium">{row.title}</p>
                      <p className="break-words text-[11px] text-muted-foreground">
                        {shortDateTime(row.createdAt)} · {row.txId ?? "—"}
                        {row.reference ? ` · ${row.reference}` : ""}
                      </p>
                      {row.cashback.length > 0 ? (
                        <p className="mt-1 break-words text-[11px] font-medium text-success">
                          {cashbackSummary(row)}
                        </p>
                      ) : null}
                    </div>
                    <div className="shrink-0 text-right">
                      <p
                        className={
                          row.direction === "credit"
                            ? "text-sm font-semibold text-success"
                            : "text-sm font-semibold text-destructive"
                        }
                      >
                        {row.direction === "credit" ? "+" : "−"}
                        {peso(row.amount)}
                      </p>
                      {row.balanceAfter !== null ? (
                        <p className="text-[11px] text-muted-foreground">Bal {peso(row.balanceAfter)}</p>
                      ) : null}
                    </div>
                  </div>

                  {row.entries.length > 1 ? (
                    <>
                      <button
                        type="button"
                        onClick={() => setExpanded(open ? null : row.id)}
                        className="mt-1 text-[11px] font-medium text-primary underline-offset-2 hover:underline"
                        aria-expanded={open}
                      >
                        {open ? "Hide details" : "View details"}
                      </button>
                      {open ? (
                        <div className="mt-2 space-y-1 rounded-md bg-muted/50 p-2">
                          {row.entries.map((e) => (
                            <div key={e.id} className="flex items-start justify-between gap-2">
                              <p className="min-w-0 break-words text-[11px] text-muted-foreground">
                                {e.reason}
                                {e.commission_percent ? ` · ${e.commission_percent}%` : ""}
                              </p>
                              <p
                                className={
                                  e.direction === "credit"
                                    ? "shrink-0 text-[11px] font-medium text-success"
                                    : "shrink-0 text-[11px] font-medium text-destructive"
                                }
                              >
                                {e.direction === "credit" ? "+" : "−"}
                                {peso(e.amount)}
                              </p>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </>
                  ) : null}
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}
    </PageSection>
  );
}

