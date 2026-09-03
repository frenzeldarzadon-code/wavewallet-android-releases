/**
 * Customer order history + tracking for one Retail shop.
 *
 * Presentation only: every action calls the existing authoritative RPCs
 * (cancel, confirm receipt, order chat, rating). Totals shown are the
 * customer-safe payload of `my_retail_orders` — Retail Prices with the fee
 * already embedded, plus the delivery fee when the shop charged one.
 */
import {
  Banknote,
  ChevronRight,
  ClipboardList,
  Coins,
  Loader2,
  MessageCircle,
  PackageCheck,
  Star,
  Store,
  Truck,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { EmptyState, PageSection, StatusBadge } from "@/components/ui-kit";
import { cn } from "@/lib/utils";
import { peso, shortDateTime } from "@/lib/wavewallet";
import {
  CUSTOMER_STAGES,
  canCancelOrder,
  canConfirmReceipt,
  canOpenOrderChat,
  cancelRetailOrder,
  countByCustomerStage,
  customerCancelBlockedReason,
  customerNextStep,
  customerOrderTotals,
  customerPaymentLabel,
  customerStage,
  customerTrackingSteps,
  fulfillmentLabel,
  fulfillmentTone,
  orderTimeline,
  updateRetailFulfillment,
  type CustomerStage,
  type RetailOrder,
} from "@/lib/retail";
import { openOrderChat } from "@/lib/retail-cod";

interface Props {
  orders: RetailOrder[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onChanged: () => Promise<void> | void;
  onChat: (threadId: string) => void;
  onRate: (order: RetailOrder, productId: string) => void;
}

const statusText = (o: RetailOrder) =>
  o.status === "approved" ? fulfillmentLabel(o.fulfillment_status, o.fulfillment) : o.status;

export function CustomerOrdersPanel({
  orders,
  loading,
  error,
  onRetry,
  onChanged,
  onChat,
  onRate,
}: Props) {
  const [stage, setStage] = useState<CustomerStage>("active");
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ kind: "cancel" | "received"; order: RetailOrder } | null>(
    null,
  );

  const counts = useMemo(() => countByCustomerStage(orders), [orders]);
  const visible = useMemo(() => orders.filter((o) => customerStage(o) === stage), [orders, stage]);
  const open = openId ? (orders.find((o) => o.id === openId) ?? null) : null;

  const run = async (o: RetailOrder, action: "cancel" | "received") => {
    if (busy) return;
    setBusy(o.id);
    try {
      if (action === "cancel") {
        await cancelRetailOrder(o.id);
        toast.success("Order cancelled — nothing was charged");
      } else {
        await updateRetailFulfillment(o.id, "completed");
        toast.success("Thanks — order marked as received");
      }
      await onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
      setConfirm(null);
    }
  };

  const goChat = async (o: RetailOrder) => {
    try {
      onChat(await openOrderChat(o.id));
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <PageSection
      devSlot="customer-orders-panel"
      id="orders"
      title="My orders"
      description="Track each order from review to hand-over."
    >
      <div
        role="tablist"
        aria-label="Order status"
        className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none]"
      >
        {CUSTOMER_STAGES.map((t) => {
          const active = t.id === stage;
          const n = counts[t.id];
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={active}
              title={t.hint}
              onClick={() => setStage(t.id)}
              className={cn(
                "flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors",
                active
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card text-muted-foreground hover:bg-muted/60",
              )}
            >
              {t.label}
              {n > 0 ? (
                <span
                  className={cn(
                    "rounded-full px-1.5 text-[10px] tabular-nums",
                    active ? "bg-primary-foreground/20" : "bg-muted",
                  )}
                >
                  {n}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      {loading ? (
        <div className="space-y-2" aria-busy>
          {[0, 1].map((i) => (
            <div key={i} className="h-28 animate-pulse rounded-2xl bg-muted/60" />
          ))}
        </div>
      ) : error ? (
        <EmptyState
          title="Couldn't load your orders"
          description={error}
          action={
            <Button size="sm" variant="outline" onClick={onRetry}>
              Retry
            </Button>
          }
        />
      ) : visible.length === 0 ? (
        <EmptyState
          title={
            orders.length === 0
              ? "No retail orders yet"
              : `No ${CUSTOMER_STAGES.find((t) => t.id === stage)?.label.toLowerCase()} orders`
          }
          description={CUSTOMER_STAGES.find((t) => t.id === stage)?.hint}
        />
      ) : (
        <div className="space-y-2">
          {visible.map((o) => {
            const t = customerOrderTotals(o);
            const qty = o.items.reduce((s, i) => s + i.quantity, 0);
            return (
              <Card key={o.id} className="shadow-[var(--shadow-card)]">
                <CardContent className="space-y-2">
                  <button
                    type="button"
                    className="flex w-full items-start justify-between gap-2 text-left"
                    onClick={() => setOpenId(o.id)}
                    aria-label={`Open order ${o.order_no}`}
                  >
                    <div className="min-w-0">
                      <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
                        <Store className="size-3" />
                        <span className="truncate">{o.shop_name ?? "Shop"}</span>
                      </p>
                      <p className="text-sm font-semibold">{o.order_no}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {shortDateTime(o.created_at)} · {o.fulfillment}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <StatusBadge tone={fulfillmentTone(o)}>{statusText(o)}</StatusBadge>
                      <ChevronRight className="size-4 text-muted-foreground" />
                    </div>
                  </button>

                  <ul className="space-y-0.5 text-xs text-muted-foreground">
                    {o.items.slice(0, 2).map((i) => (
                      <li key={i.product_id} className="flex justify-between gap-2">
                        <span className="truncate">
                          {i.quantity} × {i.name}
                        </span>
                        <span className="tabular-nums">{peso(i.line_total)}</span>
                      </li>
                    ))}
                    {o.items.length > 2 ? (
                      <li className="text-[11px]">+{o.items.length - 2} more item(s)</li>
                    ) : null}
                  </ul>

                  <p className="rounded-lg bg-muted/60 px-2.5 py-1.5 text-xs">{customerNextStep(o)}</p>

                  <div className="flex flex-wrap items-end justify-between gap-2">
                    <div className="text-[11px] text-muted-foreground">
                      <p className="flex items-center gap-1">
                        {o.payment_method === "credit" ? (
                          <Coins className="size-3" />
                        ) : (
                          <Banknote className="size-3" />
                        )}
                        {customerPaymentLabel(o)}
                      </p>
                      {t.delivery > 0 ? (
                        <p>
                          {peso(t.products)} products + {peso(t.delivery)} delivery
                        </p>
                      ) : null}
                    </div>
                    <p className="text-sm font-semibold">
                      {qty} item{qty === 1 ? "" : "s"} · {peso(t.total)}
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {canOpenOrderChat(o) ? (
                      <Button size="sm" variant="outline" onClick={() => void goChat(o)}>
                        <MessageCircle className="size-4" /> Chat
                      </Button>
                    ) : null}
                    {canConfirmReceipt(o) ? (
                      <Button size="sm" onClick={() => setConfirm({ kind: "received", order: o })}>
                        <PackageCheck className="size-4" /> I received it
                      </Button>
                    ) : null}
                    {canCancelOrder(o) ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setConfirm({ kind: "cancel", order: o })}
                      >
                        <X className="size-4" /> Cancel
                      </Button>
                    ) : null}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="ml-auto"
                      onClick={() => setOpenId(o.id)}
                    >
                      Track order
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Sheet open={!!open} onOpenChange={(v) => !v && setOpenId(null)}>
        <SheetContent
          side="bottom"
          className="max-h-[92dvh] overflow-y-auto rounded-t-3xl sm:mx-auto sm:max-w-lg"
        >
          {open ? <OrderDetail order={open} busy={busy === open.id} onChat={goChat} onRate={onRate} onConfirm={(kind) => setConfirm({ kind, order: open })} /> : null}
        </SheetContent>
      </Sheet>

      <AlertDialog open={!!confirm} onOpenChange={(v) => !v && !busy && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm?.kind === "cancel" ? "Cancel this order?" : "Confirm you received it?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm?.kind === "cancel"
                ? `Order ${confirm.order.order_no} will be cancelled. Nothing is charged and any held coins are returned in full.`
                : `This tells the shop that order ${confirm?.order.order_no} arrived complete. It cannot be undone.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={!!busy}>Back</AlertDialogCancel>
            <AlertDialogAction
              disabled={!!busy}
              onClick={(e) => {
                e.preventDefault();
                if (confirm) void run(confirm.order, confirm.kind);
              }}
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : null}
              {confirm?.kind === "cancel" ? "Cancel order" : "Yes, received"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageSection>
  );
}

function OrderDetail({
  order: o,
  busy,
  onChat,
  onRate,
  onConfirm,
}: {
  order: RetailOrder;
  busy: boolean;
  onChat: (o: RetailOrder) => Promise<void>;
  onRate: (o: RetailOrder, productId: string) => void;
  onConfirm: (kind: "cancel" | "received") => void;
}) {
  const t = customerOrderTotals(o);
  const steps = customerTrackingSteps(o);
  const history = orderTimeline(o).filter((h) => h.label !== "Settled" && h.label !== "Collector confirmed cash");
  const blocked = customerCancelBlockedReason(o);
  const closed = o.status === "rejected" || o.status === "cancelled";

  return (
    <div className="space-y-4 pb-2">
      <SheetHeader className="space-y-1 text-left">
        <SheetTitle className="flex items-center gap-2">
          <ClipboardList className="size-4 text-primary" /> {o.order_no}
        </SheetTitle>
        <SheetDescription className="flex items-center gap-1">
          <Store className="size-3" /> {o.shop_name ?? "Shop"}
          {o.seller_name ? ` · sold by ${o.seller_name}` : ""} · {shortDateTime(o.created_at)}
        </SheetDescription>
      </SheetHeader>

      <div className="flex items-center justify-between gap-2">
        <StatusBadge tone={fulfillmentTone(o)}>{statusText(o)}</StatusBadge>
        <span className="text-[11px] text-muted-foreground">{customerPaymentLabel(o)}</span>
      </div>
      <p className="rounded-xl bg-primary/10 px-3 py-2 text-xs font-medium text-primary">
        {customerNextStep(o)}
      </p>

      {closed ? (
        <p className="text-xs text-muted-foreground">
          {o.status === "rejected" ? "The shop rejected this order." : "You cancelled this order."}{" "}
          {o.decision_note ? `Note: ${o.decision_note}` : ""}
        </p>
      ) : (
        <ol className="space-y-0" aria-label="Order progress">
          {steps.map((s, i) => (
            <li key={s.label} className="flex gap-3">
              <div className="flex flex-col items-center">
                <span
                  className={cn(
                    "mt-0.5 size-3 rounded-full border-2",
                    s.done
                      ? s.current
                        ? "border-primary bg-primary"
                        : "border-success bg-success"
                      : "border-border bg-card",
                  )}
                />
                {i < steps.length - 1 ? (
                  <span className={cn("w-px flex-1 min-h-4", s.done && !s.current ? "bg-success" : "bg-border")} />
                ) : null}
              </div>
              <p
                className={cn(
                  "pb-3 text-xs",
                  s.current ? "font-semibold text-foreground" : s.done ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {s.label}
                {s.current ? <span className="ml-1 text-[10px] text-primary">· now</span> : null}
              </p>
            </li>
          ))}
        </ol>
      )}

      <div className="space-y-1 rounded-xl border border-border px-3 py-2 text-xs">
        <p className="font-medium">Items</p>
        <ul className="space-y-0.5 text-muted-foreground">
          {o.items.map((i) => (
            <li key={i.product_id} className="flex justify-between gap-2">
              <span>
                {i.quantity} × {i.name}
                {i.wholesale_applied ? (
                  <span className="ml-1 text-[10px] text-success">wholesale</span>
                ) : null}
              </span>
              <span className="tabular-nums">{peso(i.line_total)}</span>
            </li>
          ))}
        </ul>
        <div className="mt-1 space-y-0.5 border-t border-border pt-1.5 text-muted-foreground">
          <div className="flex justify-between">
            <span>Products</span>
            <span className="tabular-nums">{peso(t.products)}</span>
          </div>
          {o.fulfillment === "delivery" ? (
            <div className="flex justify-between">
              <span>Delivery fee</span>
              <span className="tabular-nums">{t.delivery > 0 ? peso(t.delivery) : "None"}</span>
            </div>
          ) : null}
          <div className="flex justify-between text-sm font-semibold text-foreground">
            <span>{o.payment_method === "cod" ? "Cash to pay" : "Total"}</span>
            <span className="tabular-nums">{peso(t.total)}</span>
          </div>
          <p className="text-[10px]">Prices shown already include everything — no extra fees.</p>
        </div>
      </div>

      {o.fulfillment === "delivery" ? (
        <div className="space-y-1 rounded-xl border border-border px-3 py-2 text-[11px] text-muted-foreground">
          <p className="flex items-center gap-1 font-medium text-foreground">
            <Truck className="size-3.5 text-primary" /> Delivery
          </p>
          {o.delivery_address ? (
            <p>
              To: {o.delivery_address}
              {o.delivery_notes ? ` · ${o.delivery_notes}` : ""}
            </p>
          ) : null}
          {o.status === "approved" ? (
            <p>
              {o.self_delivery
                ? "Delivered by the seller"
                : o.delivery_person_name
                  ? `Delivery person: ${o.delivery_person_name}`
                  : "Delivery person not assigned yet"}
              {o.payment_method === "cod" && o.collector_name
                ? ` · Cash collected by: ${o.collector_name}`
                : ""}
            </p>
          ) : null}
        </div>
      ) : null}

      {history.length > 1 ? (
        <div className="space-y-0.5 text-[11px] text-muted-foreground">
          <p className="font-medium text-foreground">History</p>
          {history.map((h) => (
            <p key={h.label + h.at} className="flex justify-between gap-2">
              <span>{h.label}</span>
              <span>{shortDateTime(h.at)}</span>
            </p>
          ))}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {canOpenOrderChat(o) ? (
          <Button variant="outline" onClick={() => void onChat(o)}>
            <MessageCircle className="size-4" /> Order chat
          </Button>
        ) : null}
        {canConfirmReceipt(o) ? (
          <Button onClick={() => onConfirm("received")} disabled={busy}>
            <PackageCheck className="size-4" /> I received it
          </Button>
        ) : null}
        {canCancelOrder(o) ? (
          <Button variant="outline" onClick={() => onConfirm("cancel")} disabled={busy}>
            <X className="size-4" /> Cancel order
          </Button>
        ) : blocked ? (
          <p className="w-full text-[11px] text-muted-foreground">{blocked}</p>
        ) : null}
        {o.status === "approved" && o.fulfillment_status === "completed"
          ? o.items.map((i) => (
              <Button
                key={i.product_id}
                size="sm"
                variant="outline"
                onClick={() => onRate(o, i.product_id)}
              >
                <Star className="size-4" /> Rate {i.name}
              </Button>
            ))
          : null}
      </div>
    </div>
  );
}
