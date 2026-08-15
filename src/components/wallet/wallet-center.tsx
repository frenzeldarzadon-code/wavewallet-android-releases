/**
 * Wallet Center — every wallet action in one screen.
 *
 * Balances per shop, the history of the selected shop, sending credits to a
 * permitted recipient (including a subreseller's upward path to their own
 * reseller or a shop admin), and moving credits between the person's own
 * shops. Financial behaviour is unchanged: `transfer_credits_in_shop` moves
 * face value with no commission and the cross-shop move keeps the existing
 * flat platform fee. The database authorizes every action.
 */
import {
  ArrowLeftRight,
  Gift,
  Info,
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
import { RecipientSearch } from "@/components/customer/recipient-search";
import { ShopTransferCard } from "@/components/customer/shop-transfer-card";
import { PointsEarningsPanel } from "@/components/customer/points-earnings-panel";
import { useSession } from "@/lib/session";
import { cn } from "@/lib/utils";
import { peso, roleLabel, shortDateTime } from "@/lib/wavewallet";
import { recipientIdentityLine } from "@/lib/recipient-search";
import { fetchCreditLedger, type CreditEntry, type RecipientMatch } from "@/lib/wallet";
import { fetchPointsAccount, type PointsAccount } from "@/lib/rewards";
import { fetchEarnings, summariseEarnings } from "@/lib/earnings";
import {
  canSendUpward,
  fetchUpwardRecipients,
  fetchWalletShops,
  projectedBalance,
  totalWalletBalance,
  transferInShop,
  upwardRelationLabel,
  validateInShopTransfer,
  type UpwardRecipient,
  type WalletShop,
} from "@/lib/wallet-center";

export interface WalletCenterProps {
  /** Route prefix for the quick links. */
  base: "/app" | "/reseller" | "/admin";
  /** Show wholesale discount + cashback totals (reseller / subreseller). */
  showSellerTotals?: boolean;
}

type Target = { id: string; name: string; detail: string; avatar: string | null };

export function WalletCenter({ base, showSellerTotals = false }: WalletCenterProps) {
  const { account, ecosystem, ecosystemDbId } = useSession();
  const userId = account?.id ?? null;

  const [shops, setShops] = useState<WalletShop[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [entries, setEntries] = useState<CreditEntry[]>([]);
  const [upward, setUpward] = useState<UpwardRecipient[]>([]);
  const [points, setPoints] = useState<PointsAccount>({ balance: 0, held: 0, available: 0 });
  const [discountSaved, setDiscountSaved] = useState(0);
  const [cashback, setCashback] = useState(0);
  const [loading, setLoading] = useState(true);

  // Send credits
  const [sendOpen, setSendOpen] = useState(false);
  const [crossOpen, setCrossOpen] = useState(false);
  const [match, setMatch] = useState<RecipientMatch | null>(null);
  const [upwardPick, setUpwardPick] = useState<UpwardRecipient | null>(null);
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

  const loadShopData = useCallback(async () => {
    if (!userId || !selectedId) return;
    const [ledger, up] = await Promise.all([
      fetchCreditLedger(userId, selectedId, 100),
      fetchUpwardRecipients(selectedId),
    ]);
    setEntries(ledger);
    setUpward(up);
  }, [userId, selectedId]);

  useEffect(() => {
    void loadShopData();
  }, [loadShopData]);

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
  const target: Target | null = upwardPick
    ? {
        id: upwardPick.id,
        name: upwardPick.full_name,
        detail: `${upwardRelationLabel(upwardPick.relation)}${upwardPick.handle ? ` · @${upwardPick.handle}` : ""}`,
        avatar: upwardPick.avatar_path,
      }
    : match
      ? {
          id: match.id,
          name: match.full_name,
          detail: recipientIdentityLine(match),
          avatar: match.avatar_path ?? null,
        }
      : null;

  const value = Number(amount) || 0;
  const problem = validateInShopTransfer({
    ecosystemId: selected?.ecosystemId ?? null,
    recipientId: target?.id ?? null,
    amount: value,
    balance: selected?.balance ?? 0,
  });

  const resetSend = () => {
    setMatch(null);
    setUpwardPick(null);
    setAmount("");
    setNote("");
  };

  const send = async () => {
    if (!selected || !target) return;
    setBusy(true);
    try {
      const tx = await transferInShop({
        ecosystemId: selected.ecosystemId,
        recipientId: target.id,
        amount: value,
        note,
      });
      toast.success("Transfer sent", { description: `${peso(value)} to ${target.name} · ${tx}` });
      setConfirming(false);
      setSendOpen(false);
      resetSend();
      await Promise.all([loadShops(), loadShopData()]);
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
          shops.length > 1
            ? `${shops.length} shop wallets · ${peso(totalWalletBalance(shops))} in total. Each shop keeps its own balance.`
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
                onClick={() => setSelectedId(s.ecosystemId)}
                className={cn(
                  "rounded-xl border px-4 py-3 text-left transition-colors",
                  s.ecosystemId === selectedId
                    ? "border-primary bg-brand-soft"
                    : "border-border bg-card hover:bg-muted",
                )}
              >
                <p className="truncate text-sm font-semibold">{s.ecosystemName}</p>
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
          title={selected.ecosystemName}
          description={`Balances and actions for this shop wallet${selected.role ? ` · ${roleLabel(selected.role)}` : ""}.`}
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

          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <Button className="h-11" onClick={() => setSendOpen(true)}>
              <Send className="size-4" /> Send credits
            </Button>
            <Button variant="outline" className="h-11" onClick={() => setCrossOpen(true)}>
              <ArrowLeftRight className="size-4" /> Transfer between my shops
            </Button>
          </div>
        </PageSection>
      ) : null}

      {showSellerTotals ? null : (
        <PointsEarningsPanel userId={account.id} ecosystemId={ecosystemDbId} />
      )}

      <HistoryPage
        ecosystemId={selected?.ecosystemId ?? null}
        {...(selected ? { shopName: selected.ecosystemName } : {})}
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

      {/* Send credits */}
      <Dialog
        open={sendOpen}
        onOpenChange={(o) => {
          setSendOpen(o);
          if (!o) resetSend();
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Send credits</DialogTitle>
            <DialogDescription>
              From your {selected?.ecosystemName ?? "shop"} wallet · available{" "}
              {peso(selected?.balance ?? 0)}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {canSendUpward(selected) && upward.length > 0 ? (
              <div className="space-y-2">
                <Label>Send to my reseller or a shop admin</Label>
                <ul className="space-y-1 rounded-xl border border-border bg-card p-1">
                  {upward.map((r) => (
                    <li key={`${r.id}-${r.relation}`}>
                      <button
                        type="button"
                        onClick={() => {
                          setUpwardPick(r);
                          setMatch(null);
                        }}
                        className={cn(
                          "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors",
                          upwardPick?.id === r.id ? "bg-brand-soft" : "hover:bg-muted",
                        )}
                      >
                        <MemberAvatar path={r.avatar_path} name={r.full_name} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{r.full_name}</span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {upwardRelationLabel(r.relation)}
                            {r.handle ? ` · @${r.handle}` : ""}
                          </span>
                        </span>
                        <StatusBadge tone="muted">{upwardRelationLabel(r.relation)}</StatusBadge>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {isActiveShop ? (
              <RecipientSearch
                selected={match}
                onSelect={(m) => {
                  setMatch(m);
                  setUpwardPick(null);
                }}
              />
            ) : (
              <p className="flex items-start gap-2 rounded-lg bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                <Info className="mt-0.5 size-3.5 shrink-0" />
                Member search runs in your current shop. Switch to {selected?.ecosystemName} to search
                its members, or move credits with “Transfer between my shops”.
              </p>
            )}

            {target ? (
              <div className="flex items-center gap-3 rounded-xl border border-primary bg-brand-soft px-3 py-2.5">
                <MemberAvatar path={target.avatar} name={target.name} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{target.name}</p>
                  <p className="truncate text-xs text-muted-foreground">{target.detail}</p>
                </div>
                <Button variant="ghost" size="sm" onClick={resetSend}>
                  Change
                </Button>
              </div>
            ) : null}

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
                  Balance after: {peso(projectedBalance(selected?.balance ?? 0, value))}
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

            {problem ? <p className="text-xs text-muted-foreground">{problem}</p> : null}
          </div>

          <DialogFooter>
            <Button className="h-11 w-full" disabled={!!problem} onClick={() => setConfirming(true)}>
              <Send className="size-4" /> Review transfer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Transfer between my shops */}
      <Dialog open={crossOpen} onOpenChange={setCrossOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Transfer between my shops</DialogTitle>
            <DialogDescription>
              Only wallets in your own name. A flat platform fee applies and is shown before you
              confirm.
            </DialogDescription>
          </DialogHeader>
          <ShopTransferCard
            onDone={() => {
              setCrossOpen(false);
              void loadShops();
              void loadShopData();
            }}
          />
        </DialogContent>
      </Dialog>

      {/* Confirmation */}
      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Confirm transfer</DialogTitle>
            <DialogDescription>
              {peso(value)} to {target?.name} from {selected?.ecosystemName}. Balance after:{" "}
              {peso(projectedBalance(selected?.balance ?? 0, value))}. This cannot be undone by you.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button onClick={() => void send()} disabled={busy}>
              {busy ? "Sending…" : "Send credits"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
