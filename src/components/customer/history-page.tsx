/**
 * Unified transaction history (credits, vouchers, transfers, rewards),
 * shared by the member and reseller consoles. Read-only: no historical record
 * is modified here.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
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
import {
  buildCoinHistory,
  cashbackSummary,
  filterCoinHistory,
  isCashbackEntry,
} from "@/lib/coin-history";
import { fetchCashbackSources, type CashbackSourceMap } from "@/lib/cashback-source";
import { lookupOmadaVoucherStatuses } from "@/lib/omada-vouchers.functions";
import {
  codeStatusLabel,
  statusSummary,
  type CodeStatusMap,
} from "@/lib/voucher-transactions";
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
  const navigate = useNavigate();

  // One tap on a voucher code: copy it (best-effort) and open the existing
  // Status Check tab with that exact code prefilled. No extra lookup runs here.
  const inspectVoucher = useCallback(
    async (code: string) => {
      try {
        await navigator.clipboard?.writeText(code);
        toast.success("Code copied");
      } catch {
        // Clipboard permission unavailable — navigation/prefill still works.
      }
      const role = account?.role;
      // Each console has its own Omada screen; land straight on Voucher Status.
      if (role === "admin" || role === "super_admin") {
        await navigate({ to: "/admin/omada", search: { code, tab: "status" } });
        return;
      }
      const reseller = role === "reseller" || role === "subreseller";
      if (reseller) {
        await navigate({ to: "/reseller/omada", search: { code, tab: "voucher" } });
        return;
      }
      // Customers monitor their vouchers live instead of the Status Check tab.
      await navigate({ to: "/app/monitor", search: { code } });
    },
    [account?.role, navigate],
  );
  const [filter, setFilter] = useState("all");
  const [direction, setDirection] = useState<"all" | "credit" | "debit">("all");
  const [entries, setEntries] = useState<CreditEntry[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [lots, setLots] = useState<CreditLot[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [sources, setSources] = useState<CashbackSourceMap>({});
  /** Omada statuses for every code on this page, fetched in one batched pass. */
  const [statuses, setStatuses] = useState<CodeStatusMap>({});
  const [statusBusy, setStatusBusy] = useState(false);
  /** Why no status is shown (controller unreachable / not connected). */
  const [statusNote, setStatusNote] = useState<string | null>(null);
  const [omadaConfigured, setOmadaConfigured] = useState(false);

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
    // Cashback origin comes from the sale's own recorded buyer role — one
    // batched read, never a per-row query.
    const saleIds = l
      .filter((e) => isCashbackEntry(e) && e.sale_id)
      .map((e) => e.sale_id as string);
    setSources(await fetchCashbackSources(saleIds));
    setLoading(false);
  }, [userId, scopeId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Presentation-only grouping: one voucher purchase renders as one row, with
  // the viewer's own cashback summarised inside it. No amounts are recomputed.
  const rows = useMemo(() => buildCoinHistory(entries, sources), [entries, sources]);
  const visibleRows = useMemo(() => filterCoinHistory(rows, direction), [rows, direction]);

  // Presentation only: re-renders the image for a voucher already issued.
  const voucherImageData = (p: Purchase, code: string, index: number): VoucherImageData => ({
    code,
    productName: p.product_name,
    description: null,
    priceLabel: peso(Number(p.list_price ?? p.sale_price)),
    shopName: shopName ?? "WaveWallet",
    customerName: null,
    paymentStatus: null,
    index: index + 1,
    total: p.codes.length,
    txId: p.tx_id,
    issuedAt: new Date(p.created_at),
  });

  /** Every code of this exact transaction — never another transaction's. */
  const saveVoucher = async (p: Purchase) => {
    if (p.codes.length === 0) return;
    setBusyId(p.id);
    let saved = 0;
    try {
      for (const [i, code] of p.codes.entries()) {
        const data = voucherImageData(p, code, i);
        const blob = await renderVoucherImage(data);
        await downloadBlob(blob, voucherFileName(data));
        saved += 1;
        if (p.codes.length > 1) await new Promise((r) => setTimeout(r, 400));
      }
      toast.success(`Saved ${saved} voucher image${saved > 1 ? "s" : ""}`);
    } catch (e) {
      toast.error("Could not save the image", { description: (e as Error).message });
    } finally {
      setBusyId(null);
    }
  };

  const shareVoucher = async (p: Purchase) => {
    if (p.codes.length === 0) return;
    setBusyId(p.id);
    let shared = 0;
    let downloaded = 0;
    try {
      for (const [i, code] of p.codes.entries()) {
        const data = voucherImageData(p, code, i);
        const blob = await renderVoucherImage(data);
        const outcome = await shareVoucherImage(blob, voucherFileName(data), p.product_name);
        if (outcome === "shared") shared += 1;
        else if (outcome === "downloaded") downloaded += 1;
        else break; // Share sheet dismissed.
      }
      if (shared > 0) toast.success(`Shared ${shared} voucher${shared > 1 ? "s" : ""}`);
      else if (downloaded > 0)
        toast.success("Sharing isn't available here — image saved instead");
    } catch (e) {
      toast.error("Could not share the image", { description: (e as Error).message });
    } finally {
      setBusyId(null);
    }
  };

  /**
   * Omada status for every code on this page, in ONE batched controller pass.
   * Runs as soon as the purchases are known so quantity-1 rows show a status
   * too — nothing is hidden behind an expander.
   */
  useEffect(() => {
    const codes = Array.from(
      new Set(purchases.flatMap((p) => p.codes.map((c) => c.toUpperCase()))),
    ).slice(0, 200);
    if (!scopeId || codes.length === 0) {
      setStatuses({});
      setStatusNote(null);
      setOmadaConfigured(false);
      return;
    }
    let cancelled = false;
    setStatusBusy(true);
    setStatusNote(null);
    void (async () => {
      try {
        const res = await lookupOmadaVoucherStatuses({ data: { ecosystemId: scopeId, codes } });
        if (cancelled) return;
        const map: CodeStatusMap = {};
        for (const code of codes) map[code] = res.statuses[code] ?? null;
        setStatuses(map);
        setOmadaConfigured(res.configured);
        setStatusNote(
          res.error ??
            (res.configured
              ? null
              : "This shop has no hotspot controller connected, so voucher status is unavailable."),
        );
      } catch (e) {
        if (cancelled) return;
        setStatuses({});
        setOmadaConfigured(false);
        setStatusNote((e as Error).message || "Voucher status could not be loaded.");
      } finally {
        if (!cancelled) setStatusBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [purchases, scopeId]);



  if (!account) return null;


  return (
    <PageSection devSlot="history-page.all-wallet-transactions"
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
            {statusNote ? (
              <p className="px-4 pt-3 text-[11px] text-muted-foreground">{statusNote}</p>
            ) : null}
            <CardContent className="divide-y divide-border px-0 py-0">

              {purchases.map((p) => {
                const many = p.codes.length > 1;
                const summary = many ? statusSummary(p.codes, statuses) : null;
                // Read-only history: every code of this transaction is shown
                // immediately — no expand/collapse, no details hyperlink.
                const shown = p.codes;
                return (
                <div key={p.id} className="space-y-1 px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {p.product_name}
                        {many ? ` ×${p.codes.length}` : ""}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        {shortDateTime(p.created_at)} · {p.tx_id} · {p.payment_method}
                      </p>
                    </div>
                    <p className="text-sm font-semibold text-destructive">−{peso(p.sale_price)}</p>
                  </div>
                  {p.codes.length === 0 ? (
                    <StatusBadge tone="muted">Code unavailable</StatusBadge>
                  ) : (
                    <>
                      {summary ? (
                        <p className="text-[11px] font-medium text-muted-foreground">{summary}</p>
                      ) : null}
                      <div className="mt-1 space-y-1 rounded-md bg-muted/50 p-2">
                        {statusBusy ? (
                          <p className="text-[11px] text-muted-foreground">Checking voucher status…</p>
                        ) : null}
                        {shown.map((code) => {
                          const label = codeStatusLabel(code, statuses);
                          return (
                            <div key={code} className="flex items-center justify-between gap-2">
                              <button
                                type="button"
                                title="Copy and check this voucher in Status Check"
                                className="font-mono text-sm font-semibold tracking-widest text-success underline decoration-dotted underline-offset-4 hover:text-success/80"
                                onClick={() => void inspectVoucher(code)}
                              >
                                {code}
                              </button>
                              {label ? (
                                <StatusBadge tone={label === "Unused" ? "success" : "muted"}>
                                  {label}
                                </StatusBadge>
                              ) : statusBusy ? null : (
                                <StatusBadge tone="muted">
                                  {omadaConfigured ? "Status unavailable" : "No status"}
                                </StatusBadge>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </>
                  )}

                  {/* Presentation only: Download | Share | Print act on every
                      voucher already issued by this exact transaction. */}
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={p.codes.length === 0 || busyId === p.id}
                      onClick={() => void saveVoucher(p)}
                    >
                      <Download className="size-4" />
                      {many ? `Download ${p.codes.length}` : "Download"}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={p.codes.length === 0 || busyId === p.id}
                      onClick={() => void shareVoucher(p)}
                    >
                      <Share2 className="size-4" />
                      {many ? `Share ${p.codes.length}` : "Share"}
                    </Button>
                    <Button asChild variant="outline" size="sm">
                      <Link to="/print/vouchers/$saleId" params={{ saleId: p.id }}>
                        <Printer className="size-4" /> Print
                      </Link>
                    </Button>
                  </div>
                </div>
                );
              })}

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

