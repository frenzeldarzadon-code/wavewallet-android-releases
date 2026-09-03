/**
 * Retail order review for one shop's admin / authorised seller.
 *
 * Approving finalises the order and the stock that was reserved when it was
 * placed; rejecting restores the stock and returns any held credits in full.
 * The database refuses a second decision on the same order, so a double click
 * or two admins racing each other can never double-charge or oversell.
 *
 * R6 (cash on delivery): the seller assigns a delivery person first and then a
 * collector. Assignment moves no coins — the collector's approval holds the
 * full customer cash total (products + delivery fee) from their AVAILABLE
 * Universe coins. Settlement happens once: collector CASH RECEIVED, or the
 * seller's release 3 days after the buyer confirmed receipt, or the shop
 * admin's discrepancy resolution.
 */
import {
  ArrowRight,
  Banknote,
  Check,
  Loader2,
  Mail,
  MessageCircle,
  RefreshCw,
  Truck,
  Unlock,
  UserCheck,
  X,
} from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { EmptyState, PageSection, StatusBadge } from "@/components/ui-kit";
import { MemberAvatar } from "@/components/member-avatar";
import { useSession } from "@/lib/session";
import { fetchCreditBalance } from "@/lib/wallet";
import { peso, shortDateTime } from "@/lib/wavewallet";
import {
  codCashTotal,
  fetchShopRetailOrders,
  fetchStoreSettings,
  fulfillmentActionLabel,
  fulfillmentLabel,
  fulfillmentTone,
  nextFulfillmentStep,
  orderTone,
  reviewRetailOrder,
  updateRetailFulfillment,
  type OrderStatus,
  type RetailOrder,
  type StoreSettings,
} from "@/lib/retail";
import {
  assignCodOrder,
  canSellerCancel,
  canSellerRelease,
  codStageLabel,
  fallbackCountdown,
  fallbackReleaseAt,
  fetchCodAssignees,
  openOrderChat,
  resolveCodDiscrepancy,
  sellerCancelCod,
  sellerReleaseCod,
  splitDeliveryFee,
  type CodAssignee,
} from "@/lib/retail-cod";

const credits = (n: number) => `${n.toLocaleString(undefined, { maximumFractionDigits: 2 })} coins`;

export function RetailOrdersPanel({ ecosystemId }: { ecosystemId: string | null }) {
  const { account } = useSession();
  const navigate = useNavigate();
  const [orders, setOrders] = useState<RetailOrder[]>([]);
  const [status, setStatus] = useState<OrderStatus | "all">("pending");
  const [settings, setSettings] = useState<StoreSettings | null>(null);
  const [available, setAvailable] = useState<number | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [assigning, setAssigning] = useState<RetailOrder | null>(null);
  const [cancelling, setCancelling] = useState<RetailOrder | null>(null);
  const [cancelNote, setCancelNote] = useState("");
  const isAdmin = account?.role === "admin" || account?.role === "super_admin";

  const load = useCallback(async () => {
    if (!ecosystemId) return;
    setLoading(true);
    try {
      const [o, s, b] = await Promise.all([
        fetchShopRetailOrders(ecosystemId, status),
        fetchStoreSettings(ecosystemId),
        account ? fetchCreditBalance(account.id, null) : Promise.resolve(null),
      ]);
      setOrders(o);
      setSettings(s);
      setAvailable(b);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [ecosystemId, status, account]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!ecosystemId) return null;

  const run = async (
    id: string,
    fn: () => Promise<void>,
    ok: { title: string; description?: string },
  ) => {
    if (busy) return;
    setBusy(id);
    try {
      await fn();
      toast.success(ok.title, { description: ok.description });
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const decide = (order: RetailOrder, approve: boolean) =>
    run(order.id, () => reviewRetailOrder(order.id, approve, notes[order.id]), {
      title: approve ? `Order ${order.order_no} approved` : `Order ${order.order_no} rejected`,
      description: approve
        ? order.payment_method === "cod"
          ? "Stock is finalised. Assign a delivery person and a collector next."
          : "Stock is finalised and the payment is confirmed."
        : "Stock is back and any held coins were returned in full.",
    });

  const advance = (order: RetailOrder) => {
    const next = nextFulfillmentStep(order.fulfillment_status, order.fulfillment);
    if (!next) return;
    return run(order.id, () => updateRetailFulfillment(order.id, next), {
      title: `${order.order_no}: ${fulfillmentLabel(next, order.fulfillment)}`,
      description: "The customer has been notified. No coins moved.",
    });
  };

  const goToChat = async (o: RetailOrder) => {
    try {
      const thread = await openOrderChat(o.id);
      void navigate({ to: "/universe/messages", search: { thread } });
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const shopEmail = settings?.contactEmail ?? null;

  return (
    <PageSection
      devSlot="retail-orders-panel.retail-orders"
      title="Retail orders"
      description="Every order stays pending until you approve or reject it."
      action={
        <Button size="sm" variant="outline" onClick={() => void load()}>
          <RefreshCw className="size-4" /> Refresh
        </Button>
      }
    >
      {settings && !shopEmail && isAdmin ? (
        <Card className="mb-3 border-warning/40 bg-warning/10">
          <CardContent className="flex items-start gap-2 py-3">
            <Mail className="mt-0.5 size-4 text-warning-foreground" />
            <p className="text-xs text-warning-foreground">
              No shop email is configured, so order notification emails cannot be delivered. Add a
              contact email in Shop settings — orders still arrive here in the meantime.
            </p>
          </CardContent>
        </Card>
      ) : null}

      {settings?.codEnabled ? (
        <Card className="mb-3 shadow-[var(--shadow-card)]">
          <CardContent className="flex flex-wrap items-center justify-between gap-2 py-3 text-xs">
            <div className="flex items-center gap-2">
              <Banknote className="size-4 text-primary" />
              <div>
                <p className="font-medium">Cash on delivery is on</p>
                <p className="text-muted-foreground">
                  Delivery fee {peso(settings.deliveryFee)} · split {settings.deliveryPct}% delivery
                  / {settings.collectorPct}% collector. Each order needs its embedded platform fee
                  available in the settlement wallet (₱1 per ₱101 retail).
                </p>
              </div>
            </div>
            {available !== null ? (
              <StatusBadge tone={available > 0 ? "success" : "warning"}>
                Available Universe coins: {peso(available)}
              </StatusBadge>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <Card className="shadow-[var(--shadow-card)]">
        <CardContent className="space-y-3">
          <Select value={status} onValueChange={(v) => setStatus(v as OrderStatus | "all")}>
            <SelectTrigger className="h-11" aria-label="Filter orders">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="approved">Approved</SelectItem>
              <SelectItem value="rejected">Rejected</SelectItem>
              <SelectItem value="cancelled">Cancelled</SelectItem>
              <SelectItem value="all">All</SelectItem>
            </SelectContent>
          </Select>

          {loading ? (
            <p className="text-xs text-muted-foreground">Loading orders…</p>
          ) : orders.length === 0 ? (
            <EmptyState title="No orders here" />
          ) : (
            <div className="space-y-3">
              {orders.map((o) => {
                const cod = o.payment_method === "cod";
                const next = nextFulfillmentStep(o.fulfillment_status, o.fulfillment);
                const needsCollectorFirst = cod && next === "out_for_delivery" && !o.hold_held;
                const canAssign =
                  o.status === "approved" &&
                  o.fulfillment === "delivery" &&
                  ["accepted", "preparing", "ready"].includes(o.fulfillment_status);
                const releaseAt = fallbackReleaseAt(o.completed_at);
                const countdown = fallbackCountdown(o.completed_at);
                return (
                  <div key={o.id} className="space-y-2 rounded-xl border border-border px-3 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">
                          {o.order_no} · {o.customer_name}
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          {shortDateTime(o.created_at)} · {o.fulfillment} · paid by{" "}
                          {cod ? "cash on delivery" : o.payment_method}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        <StatusBadge tone={orderTone(o.status)}>{o.status}</StatusBadge>
                        {o.status === "approved" ? (
                          <StatusBadge tone={fulfillmentTone(o)}>
                            {fulfillmentLabel(o.fulfillment_status, o.fulfillment)}
                          </StatusBadge>
                        ) : null}
                        {cod ? (
                          <StatusBadge
                            tone={
                              o.cod_settled_at
                                ? "success"
                                : o.cod_discrepancy
                                  ? "danger"
                                  : o.hold_held
                                    ? "brand"
                                    : "warning"
                            }
                          >
                            {codStageLabel(o)}
                          </StatusBadge>
                        ) : null}
                      </div>
                    </div>
                    {o.seller_name ? (
                      <p className="text-[11px] text-muted-foreground">
                        Storefront seller: {o.seller_name}
                      </p>
                    ) : null}
                    <ul className="space-y-1 text-xs text-muted-foreground">
                      {o.items.map((i) => (
                        <li key={i.product_id} className="flex justify-between gap-2">
                          <span>
                            {i.quantity} × {i.name}
                          </span>
                          <span>{credits(i.line_total)}</span>
                        </li>
                      ))}
                    </ul>
                    {o.delivery_address ? (
                      <p className="text-[11px] text-muted-foreground">
                        Deliver to: {o.delivery_address}
                        {o.delivery_notes ? ` · ${o.delivery_notes}` : ""}
                      </p>
                    ) : null}

                    {cod ? (
                      <CodBreakdown o={o} />
                    ) : (
                      <p className="text-sm font-semibold">Total {credits(o.total)}</p>
                    )}

                    {o.status === "approved" && o.fulfillment === "delivery" ? (
                      <div className="rounded-lg bg-muted/50 px-2.5 py-2 text-[11px] text-muted-foreground">
                        <p className="flex items-center gap-1 font-medium text-foreground">
                          <Truck className="size-3.5 text-primary" /> Delivery
                        </p>
                        <p>
                          {o.self_delivery
                            ? "Self-delivery by the seller"
                            : o.delivery_person_name
                              ? `Delivery person: ${o.delivery_person_name}`
                              : "No delivery person assigned"}
                        </p>
                        {cod ? (
                          <p>
                            Collector:{" "}
                            {o.collector_name
                              ? `${o.collector_name} (${o.collector_status})`
                              : "none — assign a collector with ≥ " +
                                peso(codCashTotal(o)) +
                                " available coins"}
                          </p>
                        ) : null}
                        {cod && o.hold_held ? (
                          <p>
                            Float held:{" "}
                            <strong className="text-foreground">
                              {peso(o.cod_expected_cash ?? codCashTotal(o))}
                            </strong>
                            {o.cod_cash_received_at && !o.cod_settled_at
                              ? ` · collector reported ${peso(o.cod_actual_cash ?? 0)}`
                              : ""}
                          </p>
                        ) : null}
                        {cod &&
                        o.hold_held &&
                        !o.cod_settled_at &&
                        o.completed_at &&
                        !o.cod_cash_received_at ? (
                          <p>
                            Buyer confirmed receipt {shortDateTime(o.completed_at)}.{" "}
                            {countdown
                              ? `You can release the held coins in ${countdown} (${releaseAt ? shortDateTime(releaseAt.toISOString()) : ""}) if the collector has not confirmed cash.`
                              : "The 3-day window has passed — you can release the held coins now."}
                          </p>
                        ) : null}
                        {cod && o.cod_settled_at ? (
                          <p>
                            Settled {shortDateTime(o.cod_settled_at)} (
                            {o.cod_settlement_kind?.replace(/_/g, " ")})
                          </p>
                        ) : null}
                      </div>
                    ) : null}

                    {o.status === "pending" ? (
                      <div className="flex flex-wrap gap-2">
                        <Input
                          value={notes[o.id] ?? ""}
                          placeholder="Note for the customer (optional)"
                          onChange={(e) => setNotes({ ...notes, [o.id]: e.target.value })}
                          className="min-w-40 flex-1"
                        />
                        <Button
                          size="sm"
                          disabled={busy === o.id}
                          onClick={() => void decide(o, true)}
                        >
                          {busy === o.id ? (
                            <Loader2 className="size-4 animate-spin" />
                          ) : (
                            <Check className="size-4" />
                          )}
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy === o.id}
                          onClick={() => void decide(o, false)}
                        >
                          <X className="size-4" /> Reject
                        </Button>
                      </div>
                    ) : null}

                    {o.status === "approved" ? (
                      <div className="flex flex-wrap gap-2">
                        {canAssign ? (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy === o.id}
                            onClick={() => setAssigning(o)}
                          >
                            <UserCheck className="size-4" />{" "}
                            {o.delivery_person_id || o.self_delivery
                              ? "Change assignment"
                              : "Assign delivery"}
                          </Button>
                        ) : null}
                        {o.fulfillment === "delivery" ? (
                          <Button size="sm" variant="outline" onClick={() => void goToChat(o)}>
                            <MessageCircle className="size-4" /> Order chat
                          </Button>
                        ) : null}
                        {next ? (
                          <Button
                            size="sm"
                            disabled={busy === o.id || needsCollectorFirst}
                            title={
                              needsCollectorFirst
                                ? "A collector must approve (coins held) before the order can go out"
                                : undefined
                            }
                            onClick={() => void advance(o)}
                          >
                            {busy === o.id ? (
                              <Loader2 className="size-4 animate-spin" />
                            ) : (
                              <ArrowRight className="size-4" />
                            )}
                            {fulfillmentActionLabel(next, o.fulfillment)}
                          </Button>
                        ) : null}
                        {cod && canSellerRelease(o) ? (
                          <Button
                            size="sm"
                            disabled={busy === o.id}
                            onClick={() =>
                              void run(o.id, () => sellerReleaseCod(o.id), {
                                title: `${o.order_no} settled`,
                                description:
                                  "The held float was settled once through the standard settlement path.",
                              })
                            }
                          >
                            <Unlock className="size-4" /> Release held coins
                          </Button>
                        ) : null}
                        {cod && o.cod_discrepancy && !o.cod_settled_at && isAdmin ? (
                          <>
                            <Button
                              size="sm"
                              disabled={busy === o.id}
                              onClick={() =>
                                void run(o.id, () => resolveCodDiscrepancy(o.id, "settle"), {
                                  title: `${o.order_no} settled by admin`,
                                  description:
                                    "Settled on the locked order economics; the actual cash reported stays on record.",
                                })
                              }
                            >
                              <Check className="size-4" /> Settle anyway
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={busy === o.id}
                              onClick={() =>
                                void run(
                                  o.id,
                                  () => resolveCodDiscrepancy(o.id, "cancel", "Cash discrepancy"),
                                  {
                                    title: `${o.order_no} cancelled`,
                                    description:
                                      "The collector's float was released in full and stock restored.",
                                  },
                                )
                              }
                            >
                              <X className="size-4" /> Cancel &amp; release float
                            </Button>
                          </>
                        ) : null}
                        {cod && canSellerCancel(o) ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busy === o.id}
                            onClick={() => {
                              setCancelNote("");
                              setCancelling(o);
                            }}
                          >
                            <X className="size-4" /> Cancel order
                          </Button>
                        ) : null}
                        {!next && !cod ? (
                          <p className="text-[11px] text-muted-foreground">
                            {o.fulfillment_status === "delivered"
                              ? "Waiting for the customer to confirm receipt."
                              : o.completed_at
                                ? `Completed ${shortDateTime(o.completed_at)}`
                                : null}
                          </p>
                        ) : null}
                      </div>
                    ) : null}
                    {o.status !== "pending" && o.decision_note ? (
                      <p className="text-[11px] text-muted-foreground">Note: {o.decision_note}</p>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {assigning ? (
        <AssignDialog
          order={assigning}
          onClose={() => setAssigning(null)}
          onDone={async () => {
            setAssigning(null);
            await load();
          }}
        />
      ) : null}

      <Dialog open={!!cancelling} onOpenChange={(open) => !open && setCancelling(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel {cancelling?.order_no}?</DialogTitle>
            <DialogDescription>
              Stock returns to the shelf.{" "}
              {cancelling?.hold_held
                ? `The collector's ${peso(cancelling.cod_expected_cash ?? 0)} float is released in full. `
                : ""}
              No coins are created or lost.
            </DialogDescription>
          </DialogHeader>
          <Input
            value={cancelNote}
            onChange={(e) => setCancelNote(e.target.value)}
            placeholder="Reason shown to the customer (optional)"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelling(null)}>
              Keep order
            </Button>
            <Button
              variant="destructive"
              disabled={!!busy}
              onClick={() => {
                const o = cancelling;
                if (!o) return;
                setCancelling(null);
                void run(o.id, () => sellerCancelCod(o.id, cancelNote), {
                  title: `${o.order_no} cancelled`,
                  description: o.hold_held
                    ? "Held coins were released to the collector."
                    : "Nothing was charged.",
                });
              }}
            >
              Cancel order
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageSection>
  );
}

/** Locked per-order economics: products (fee inside) + delivery fee = cash; split preview / actuals. */
function CodBreakdown({ o }: { o: RetailOrder }) {
  const dPct = o.delivery_split_delivery_pct ?? 0;
  const split = splitDeliveryFee(o.delivery_fee ?? 0, dPct);
  const settled = !!o.cod_settled_at;
  return (
    <div className="space-y-0.5 rounded-lg border border-border px-2.5 py-2 text-[11px]">
      <div className="flex justify-between gap-2">
        <span className="text-muted-foreground">Products (retail price, 1% fee inside)</span>
        <span>{peso(o.total)}</span>
      </div>
      <div className="flex justify-between gap-2">
        <span className="text-muted-foreground">Delivery fee (no platform fee)</span>
        <span>{peso(o.delivery_fee ?? 0)}</span>
      </div>
      <div className="flex justify-between gap-2 text-sm font-semibold">
        <span>Customer pays cash · collector float</span>
        <span>{peso(codCashTotal(o))}</span>
      </div>
      <div className="mt-1 grid grid-cols-2 gap-x-3 text-muted-foreground">
        <span>Seller's cut</span>
        <span className="text-right">{peso(o.seller_total ?? 0)}</span>
        <span>Platform fee (seller-side)</span>
        <span className="text-right">{peso(o.platform_fee_amount ?? 0)}</span>
        <span>Delivery share ({dPct}%)</span>
        <span className="text-right">
          {peso(settled ? (o.delivery_share_amount ?? 0) : split.delivery)}
        </span>
        <span>Collector share ({o.delivery_split_collector_pct ?? 0}%)</span>
        <span className="text-right">
          {peso(settled ? (o.collector_share_amount ?? 0) : split.collector)}
        </span>
        {settled ? (
          <>
            <span>Seller credited</span>
            <span className="text-right">{peso(o.seller_amount ?? 0)}</span>
            <span>Cashback paid</span>
            <span className="text-right">{peso(o.cashback_amount ?? 0)}</span>
          </>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Delivery person first, then collector. Collector candidates are marked
 * eligible only when their AVAILABLE Universe coins cover the full cash total;
 * held coins never count. Saving moves no coins.
 */
function AssignDialog({
  order,
  onClose,
  onDone,
}: {
  order: RetailOrder;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const cod = order.payment_method === "cod";
  const need = codCashTotal(order);
  const [people, setPeople] = useState<CodAssignee[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [selfDelivery, setSelfDelivery] = useState(order.self_delivery ?? false);
  const [deliveryId, setDeliveryId] = useState<string | null>(order.delivery_person_id ?? null);
  const [collectorId, setCollectorId] = useState<string | null>(order.collector_id ?? null);
  const [q, setQ] = useState("");
  const lockedCollector = cod && !!order.hold_held;

  useEffect(() => {
    let live = true;
    fetchCodAssignees(order.id)
      .then((p) => live && setPeople(p))
      .catch((e: Error) => toast.error(e.message))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [order.id]);

  const filtered = people.filter(
    (p) =>
      !q.trim() ||
      p.full_name.toLowerCase().includes(q.toLowerCase()) ||
      (p.handle ?? "").toLowerCase().includes(q.toLowerCase()),
  );
  const eligible = filtered.filter((p) => p.collector_eligible);
  const collectorPick = people.find((p) => p.user_id === collectorId);
  const collectorProblem =
    cod && collectorId && collectorPick && !collectorPick.collector_eligible
      ? `${collectorPick.full_name} does not have ${peso(need)} available`
      : null;

  const save = async () => {
    setBusy(true);
    try {
      await assignCodOrder(order.id, {
        selfDelivery,
        deliveryPersonId: selfDelivery ? null : deliveryId,
        collectorId: cod ? collectorId : null,
      });
      toast.success("Assignment saved", {
        description:
          cod && collectorId && collectorId !== order.collector_id
            ? `${collectorPick?.full_name ?? "The collector"} was asked to approve. Coins are held only when they approve.`
            : "No coins moved.",
      });
      await onDone();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const PersonRow = ({
    p,
    selected,
    onPick,
    disabled,
  }: {
    p: CodAssignee;
    selected: boolean;
    onPick: () => void;
    disabled?: boolean;
  }) => (
    <button
      type="button"
      disabled={disabled}
      onClick={onPick}
      className={`flex w-full items-center gap-2 rounded-lg border px-2 py-1.5 text-left text-xs transition-colors ${
        selected ? "border-primary bg-brand-soft/50" : "border-border hover:bg-muted/50"
      } disabled:opacity-50`}
    >
      <MemberAvatar path={p.avatar_path} name={p.full_name} className="size-7" />
      <span className="min-w-0 flex-1 truncate">
        {p.full_name}
        {p.handle ? <span className="text-muted-foreground"> @{p.handle}</span> : null}
      </span>
      {cod ? (
        <StatusBadge tone={p.collector_eligible ? "success" : "muted"}>
          {p.collector_eligible ? `≥ ${peso(need)} available` : "not enough available"}
        </StatusBadge>
      ) : null}
    </button>
  );

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Assign {order.order_no}</DialogTitle>
          <DialogDescription>
            Step 1 — who delivers.{" "}
            {cod
              ? `Step 2 — who collects ${peso(need)} in cash and floats it in Universe coins.`
              : ""}{" "}
            Saving never moves coins.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between gap-3 rounded-xl border border-border px-3 py-2.5">
          <div>
            <Label htmlFor="self-delivery" className="text-sm">
              I deliver this myself
            </Label>
            <p className="text-[11px] text-muted-foreground">
              {cod
                ? "Self-delivery with no collector opens a seller + customer chat only."
                : "Opens a seller + customer chat."}
            </p>
          </div>
          <Switch
            id="self-delivery"
            checked={selfDelivery}
            onCheckedChange={(v) => {
              setSelfDelivery(v);
              if (v) setDeliveryId(null);
            }}
          />
        </div>

        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search shop members…"
        />

        {loading ? (
          <p className="text-xs text-muted-foreground">Loading members…</p>
        ) : (
          <>
            {!selfDelivery ? (
              <div className="space-y-1.5">
                <Label>1 · Delivery person</Label>
                <div className="max-h-44 space-y-1 overflow-y-auto">
                  {filtered.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No members match.</p>
                  ) : (
                    filtered.map((p) => (
                      <PersonRow
                        key={p.user_id}
                        p={{ ...p, collector_eligible: false }}
                        selected={deliveryId === p.user_id}
                        onPick={() => setDeliveryId(deliveryId === p.user_id ? null : p.user_id)}
                      />
                    ))
                  )}
                </div>
              </div>
            ) : null}

            {cod ? (
              <div className="space-y-1.5">
                <Label>
                  2 · Collector (needs {peso(need)} available — held coins do not count)
                </Label>
                {lockedCollector ? (
                  <p className="text-xs text-muted-foreground">
                    {order.collector_name} already holds the float; the collector cannot change.
                    Cancel the order to release it.
                  </p>
                ) : (
                  <div className="max-h-44 space-y-1 overflow-y-auto">
                    {eligible.length === 0 ? (
                      <p className="text-xs text-destructive">
                        No member has {peso(need)} available right now.
                      </p>
                    ) : (
                      eligible.map((p) => (
                        <PersonRow
                          key={p.user_id}
                          p={p}
                          selected={collectorId === p.user_id}
                          onPick={() =>
                            setCollectorId(collectorId === p.user_id ? null : p.user_id)
                          }
                        />
                      ))
                    )}
                  </div>
                )}
                {collectorProblem ? (
                  <p className="text-xs text-destructive">{collectorProblem}</p>
                ) : null}
              </div>
            ) : null}
          </>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Close
          </Button>
          <Button
            onClick={() => void save()}
            disabled={busy || !!collectorProblem || (!selfDelivery && !deliveryId && !collectorId)}
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : <UserCheck className="size-4" />}
            Save assignment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
