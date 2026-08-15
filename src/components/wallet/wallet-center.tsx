/**
 * Wallet Center — every wallet action in one screen.
 *
 * Balances per shop, the transfer actions available for the selected shop
 * wallet, and the full transaction history, all on one mobile-first page.
 * Two transfer capabilities are always visible (never buried in a menu):
 *
 *  1. "Send credits" to an eligible member of the selected shop. The eligible
 *     list comes from `wallet_shop_recipients`, which mirrors the permissions
 *     `transfer_credits_in_shop` enforces — subresellers see their own reseller
 *     and shop admins, resellers see their own subresellers, shop operators see
 *     their shop's members, and everyone sees the shop's customers.
 *  2. "Transfer between my shops" — only shown when the person actually owns
 *     more than one shop wallet, with the flat platform fee shown up front.
 *
 * Nothing here is an authorization layer: the database re-checks every rule.
 */
import {
  Gift,
  Info,
  Search,
  Send,
  ShoppingBag,
  Sparkles,
  Wallet,
} from "lucide-react";
import { Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EmptyState, PageSection, StatCard, StatusBadge } from "@/components/ui-kit";
import { MemberAvatar } from "@/components/member-avatar";
import { FacebookSupportCard } from "@/components/facebook-support-card";
import { ShopTransferCard } from "@/components/customer/shop-transfer-card";
import { PointsEarningsPanel } from "@/components/customer/points-earnings-panel";
import { HistoryPage } from "@/components/customer/history-page";
import { useSession } from "@/lib/session";
import { cn } from "@/lib/utils";
import { peso, roleLabel } from "@/lib/wavewallet";
import { fetchPointsAccount, type PointsAccount } from "@/lib/rewards";
import { fetchEarnings, summariseEarnings } from "@/lib/earnings";
import {
  emptyRecipientsHint,
  fetchShopRecipients,
  fetchWalletShops,
  projectedBalance,
  recipientRelationLabel,
  totalWalletBalance,
  transferInShop,
  transferSectionTitle,
  validateInShopTransfer,
  type ShopRecipient,
  type WalletShop,
} from "@/lib/wallet-center";

export interface WalletCenterProps {
  /** Route prefix for the quick links. */
  base: "/app" | "/reseller" | "/admin";
  /** Show wholesale discount + cashback totals (reseller / subreseller). */
  showSellerTotals?: boolean;
}

export function WalletCenter({ base, showSellerTotals = false }: WalletCenterProps) {
  const { account, ecosystem, ecosystemDbId } = useSession();
  const userId = account?.id ?? null;

  const [shops, setShops] = useState<WalletShop[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [recipients, setRecipients] = useState<ShopRecipient[]>([]);
  const [recipientsLoading, setRecipientsLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [points, setPoints] = useState<PointsAccount>({ balance: 0, held: 0, available: 0 });
  const [discountSaved, setDiscountSaved] = useState(0);
  const [cashback, setCashback] = useState(0);
  const [loading, setLoading] = useState(true);
  const [historyKey, setHistoryKey] = useState(0);

  // Send credits
  const [pick, setPick] = useState<ShopRecipient | null>(null);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const loadShops = useCallback(async () => {
    const list = await fetchWalletShops();
    setShops(list);
    setSelectedId((cur) => cur ?? ecosystemDbId ?? list[0]?.ecosystemId ?? null);
    setLoading(false);
  }, [ecosystemDbId]);

  useEffect(() => {
    void loadShops();
  }, [loadShops]);

  const selected = useMemo(
    () => shops.find((s) => s.ecosystemId === selectedId) ?? null,
    [shops, selectedId],
  );

  const loadRecipients = useCallback(async () => {
    if (!userId || !selectedId) {
      setRecipients([]);
      setRecipientsLoading(false);
      return;
    }
    setRecipientsLoading(true);
    setRecipients(await fetchShopRecipients(selectedId, search));
    setRecipientsLoading(false);
  }, [userId, selectedId, search]);

  useEffect(() => {
    const t = window.setTimeout(() => {
      void loadRecipients();
    }, 200);
    return () => window.clearTimeout(t);
  }, [loadRecipients]);

  const loadExtras = useCallback(async () => {
    if (!userId) return;
    setPoints(await fetchPointsAccount(userId, ecosystemDbId));
    if (!showSellerTotals) return;
    try {
      const from = new Date();
      from.setFullYear(from.getFullYear() - 1);
      const rows = await fetchEarnings({ recipientId: userId, from, to: new Date() });
      const totals = summariseEarnings(rows);
      setDiscountSaved(totals.discountSaved);
      setCashback(totals.byType.sale_cashback ?? 0);
    } catch {
      setDiscountSaved(0);
      setCashback(0);
    }
  }, [userId, ecosystemDbId, showSellerTotals]);

  useEffect(() => {
    void loadExtras();
  }, [loadExtras]);

  if (!account) return null;

  const isActiveShop = selected?.ecosystemId === ecosystemDbId;
  const multiShop = shops.length > 1;
  const value = Number(amount) || 0;
  const problem = validateInShopTransfer({
    ecosystemId: selected?.ecosystemId ?? null,
    recipientId: pick?.id ?? null,
    amount: value,
    balance: selected?.balance ?? 0,
  });

  const resetSend = () => {
    setPick(null);
    setAmount("");
    setNote("");
  };

  const send = async () => {
    if (!selected || !pick) return;
    setBusy(true);
    try {
      const tx = await transferInShop({
        ecosystemId: selected.ecosystemId,
        recipientId: pick.id,
        amount: value,
        note,
      });
      toast.success("Transfer sent", { description: `${peso(value)} to ${pick.full_name} · ${tx}` });
      setConfirming(false);
      resetSend();
      setHistoryKey((k) => k + 1);
      await Promise.all([loadShops(), loadRecipients()]);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageSection
        title="My wallets"
        description={
          multiShop
            ? `${shops.length} shop wallets · ${peso(totalWalletBalance(shops))} in total. Tap a shop to work with that wallet.`
            : "Your shop wallet balance."
        }
      >
        {loading ? (
          <EmptyState title="Loading wallets…" />
        ) : shops.length === 0 ? (
          <EmptyState
            title="No shop wallet yet"
            description="Join a shop from the Universe to open your first wallet."
          />
        ) : (
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {shops.map((s) => (
              <button
                key={s.ecosystemId}
                type="button"
                aria-pressed={s.ecosystemId === selectedId}
                onClick={() => {
                  setSelectedId(s.ecosystemId);
                  resetSend();
                }}
                className={cn(
                  "rounded-xl border px-4 py-3 text-left transition-colors",
                  s.ecosystemId === selectedId
                    ? "border-primary bg-brand-soft ring-2 ring-primary/40"
                    : "border-border bg-card hover:bg-muted",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-sm font-semibold">{s.ecosystemName}</p>
                  {s.ecosystemId === selectedId ? (
                    <StatusBadge tone="brand">Selected</StatusBadge>
                  ) : null}
                </div>
                <p className="text-lg font-bold text-success">{peso(s.balance)}</p>
                <p className="text-[11px] text-muted-foreground">
                  {s.role ? roleLabel(s.role) : "Member"}
                  {s.ecosystemId === ecosystemDbId ? " · current shop" : ""}
                </p>
              </button>
            ))}
          </div>
        )}
      </PageSection>

      {selected ? (
        <PageSection
          title={`Selected wallet — ${selected.ecosystemName}`}
          description={`Balances and transfer actions for this shop wallet${selected.role ? ` · you are ${roleLabel(selected.role)} here` : ""}.`}
        >
          <div
            className={
              showSellerTotals ? "grid gap-3 sm:grid-cols-2 xl:grid-cols-4" : "grid gap-3 sm:grid-cols-2"
            }
          >
            <StatCard
              label="Credit balance"
              value={peso(selected.balance)}
              hint="Validated against your ledger"
              icon={Wallet}
              tone="positive"
            />
            <StatCard
              label="Points balance"
              value={`${points.available} pts`}
              hint={
                isActiveShop
                  ? points.held > 0
                    ? `${points.held} pts held for redemptions`
                    : "Earned from voucher purchases"
                  : "Points shown for your current shop"
              }
              icon={Sparkles}
              tone="brand"
            />
            {showSellerTotals ? (
              <>
                <StatCard
                  label="Total discounts saved"
                  value={peso(discountSaved)}
                  hint="Wholesale margin, last 12 months"
                  icon={Gift}
                />
                <StatCard
                  label="Cashback rewards total"
                  value={peso(cashback)}
                  hint="Sales cashback, last 12 months"
                  icon={Gift}
                  tone="positive"
                />
              </>
            ) : null}
          </div>
        </PageSection>
      ) : null}

      {/* 1. Send credits — one area, recipient type tabs. Always visible. */}
      {selected ? (
        <PageSection
          title="Send credits"
          description={`${transferSectionTitle(selected.role)} · from your ${selected.ecosystemName} wallet, available ${peso(selected.balance)}. Only people you are allowed to send to are listed.`}
        >
          <Card className="shadow-[var(--shadow-card)]">
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-2" role="tablist" aria-label="Recipient type">
                {tabs.map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    role="tab"
                    aria-selected={t.key === tab}
                    onClick={() => {
                      setTab(t.key);
                      resetSend();
                    }}
                    className={cn(
                      "h-9 rounded-full border px-4 text-xs font-semibold transition-colors",
                      t.key === tab
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-card text-muted-foreground hover:bg-muted",
                    )}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              {tab === "shops" ? (
                <ShopTransferCard
                  embedded
                  onDone={() => {
                    setHistoryKey((k) => k + 1);
                    void loadShops();
                  }}
                />
              ) : (
                <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="wc-search">Recipient</Label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="wc-search"
                    className="h-11 pl-9"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search this shop by name or @handle"
                    autoComplete="off"
                  />
                </div>
              </div>

              {recipientsLoading ? (
                <p className="text-xs text-muted-foreground">Loading eligible recipients…</p>
              ) : recipients.length === 0 ? (
                <p className="flex items-start gap-2 rounded-lg bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                  <Info className="mt-0.5 size-3.5 shrink-0" />
                  {search.trim()
                    ? "No eligible recipient in this shop matches that search."
                    : emptyRecipientsHint(selected.role)}
                </p>
              ) : (
                <ul className="max-h-80 space-y-1 overflow-y-auto rounded-xl border border-border bg-card p-1">
                  {recipients.map((r) => (
                    <li key={r.id}>
                      <button
                        type="button"
                        onClick={() => setPick(r)}
                        className={cn(
                          "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors",
                          pick?.id === r.id ? "bg-brand-soft" : "hover:bg-muted",
                        )}
                      >
                        <MemberAvatar path={r.avatar_path} name={r.full_name} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{r.full_name}</span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {recipientRelationLabel(r.relation)}
                            {r.handle ? ` · @${r.handle}` : ""} · {selected.ecosystemName}
                          </span>
                        </span>
                        <StatusBadge tone="muted">{recipientRelationLabel(r.relation)}</StatusBadge>
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              {pick ? (
                <div className="flex items-center gap-3 rounded-xl border border-primary bg-brand-soft px-3 py-2.5">
                  <MemberAvatar path={pick.avatar_path} name={pick.full_name} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{pick.full_name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {recipientRelationLabel(pick.relation)} · {selected.ecosystemName}
                    </p>
                  </div>
                  <Button variant="ghost" size="sm" onClick={resetSend}>
                    Change
                  </Button>
                </div>
              ) : null}

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="wc-amount">Amount</Label>
                  <Input
                    id="wc-amount"
                    type="number"
                    inputMode="decimal"
                    className="h-11"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="0"
                  />
                  {value > 0 ? (
                    <p className="text-xs text-muted-foreground">
                      Balance after: {peso(projectedBalance(selected.balance, value))}
                    </p>
                  ) : null}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="wc-note">Note (optional)</Label>
                  <Input
                    id="wc-note"
                    className="h-11"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Reference"
                  />
                </div>
              </div>

              {problem && (pick || value > 0) ? (
                <p className="text-xs text-muted-foreground">{problem}</p>
              ) : null}

                  <Button
                    className="h-11 w-full"
                    disabled={!!problem}
                    onClick={() => setConfirming(true)}
                  >
                    <Send className="size-4" /> Review transfer
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </PageSection>
      ) : null}

      {showSellerTotals ? null : (
        <PointsEarningsPanel userId={account.id} ecosystemId={ecosystemDbId} />
      )}

      <HistoryPage
        key={`${selected?.ecosystemId ?? "none"}-${historyKey}`}
        ecosystemId={selected?.ecosystemId ?? null}
        {...(selected ? { shopName: selected.ecosystemName } : {})}
        shopOptions={shops.map((s) => ({ ecosystemId: s.ecosystemId, ecosystemName: s.ecosystemName }))}
        onShopChange={(id) => {
          setSelectedId(id);
          resetSend();
        }}
      />

      <PageSection title="Quick links">
        <div className="grid gap-2 sm:grid-cols-3">
          <Button asChild variant="outline" className="h-11">
            <Link to={base === "/app" ? "/app/shop" : base === "/reseller" ? "/reseller/shop" : "/admin/shop"}>
              <ShoppingBag className="size-4" /> Voucher shop
            </Link>
          </Button>
          <Button asChild variant="outline" className="h-11">
            <Link to={base === "/app" ? "/app/rewards" : base === "/reseller" ? "/reseller/rewards" : "/admin/rewards"}>
              <Gift className="size-4" /> Rewards
            </Link>
          </Button>
          <Button asChild variant="outline" className="h-11">
            <Link to={base === "/app" ? "/app/money" : base === "/reseller" ? "/reseller/money" : "/admin/money"}>
              <Wallet className="size-4" /> Cash in & cash out
            </Link>
          </Button>
        </div>
      </PageSection>

      {ecosystem ? (
        <PageSection title="Contact us / Support">
          <FacebookSupportCard
            url={ecosystem.facebookPageUrl}
            pageName={ecosystem.facebookPageName}
            title={`${ecosystem.name} support`}
            message="Message your shop's Facebook page for help with credits, vouchers and rewards."
            emptyHint="Your shop has not added a Facebook support page yet. Contact them directly for now."
          />
        </PageSection>
      ) : null}

      {/* Confirmation */}
      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Confirm transfer</DialogTitle>
            <DialogDescription>
              {peso(value)} to {pick?.full_name} ({pick ? recipientRelationLabel(pick.relation) : ""})
              from {selected?.ecosystemName}. Balance after:{" "}
              {peso(projectedBalance(selected?.balance ?? 0, value))}. This cannot be undone by you.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button onClick={() => void send()} disabled={busy}>
              {busy ? "Sending…" : <><Send className="size-4" /> Send credits</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
