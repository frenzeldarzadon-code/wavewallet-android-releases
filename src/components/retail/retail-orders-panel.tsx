/**
 * Retail order review for one shop's admin.
 *
 * Approving finalises the order and the stock that was reserved when it was
 * placed; rejecting restores the stock and returns any held credits in full.
 * The database refuses a second decision on the same order, so a double click
 * or two admins racing each other can never double-charge or oversell.
 */
import { Check, Loader2, Mail, RefreshCw, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState, PageSection, StatusBadge } from "@/components/ui-kit";
import { shortDateTime } from "@/lib/wavewallet";
import {
  fetchShopRetailOrders,
  fetchStoreSettings,
  orderTone,
  reviewRetailOrder,
  type OrderStatus,
  type RetailOrder,
} from "@/lib/retail";
import { notifyRetailOrder } from "@/lib/retail-notify.functions";

const credits = (n: number) => `${n.toLocaleString(undefined, { maximumFractionDigits: 2 })} coins`;

export function RetailOrdersPanel({ ecosystemId }: { ecosystemId: string | null }) {
  const [orders, setOrders] = useState<RetailOrder[]>([]);
  const [status, setStatus] = useState<OrderStatus | "all">("pending");
  const [shopEmail, setShopEmail] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!ecosystemId) return;
    setLoading(true);
    try {
      const [o, s] = await Promise.all([
        fetchShopRetailOrders(ecosystemId, status),
        fetchStoreSettings(ecosystemId),
      ]);
      setOrders(o);
      setShopEmail(s.contactEmail);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [ecosystemId, status]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!ecosystemId) return null;

  const decide = async (order: RetailOrder, approve: boolean) => {
    if (busy) return;
    setBusy(order.id);
    try {
      await reviewRetailOrder(order.id, approve, notes[order.id]);
      toast.success(approve ? `Order ${order.order_no} approved` : `Order ${order.order_no} rejected`, {
        description: approve
          ? "Stock is finalised and the payment is confirmed."
          : "Stock is back and any held coins were returned in full.",
      });
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <PageSection
      title="Retail orders"
      description="Every order stays pending until you approve or reject it."
      action={
        <Button size="sm" variant="outline" onClick={() => void load()}>
          <RefreshCw className="size-4" /> Refresh
        </Button>
      }
    >
      {!shopEmail ? (
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
              {orders.map((o) => (
                <div key={o.id} className="space-y-2 rounded-xl border border-border px-3 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">
                        {o.order_no} · {o.customer_name}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        {shortDateTime(o.created_at)} · {o.fulfillment} · paid by {o.payment_method}
                      </p>
                    </div>
                    <StatusBadge tone={orderTone(o.status)}>{o.status}</StatusBadge>
                  </div>
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
                  <p className="text-sm font-semibold">Total {credits(o.total)}</p>
                  {o.status === "pending" ? (
                    <div className="flex flex-wrap gap-2">
                      <Input
                        value={notes[o.id] ?? ""}
                        placeholder="Note for the customer (optional)"
                        onChange={(e) => setNotes({ ...notes, [o.id]: e.target.value })}
                        className="min-w-40 flex-1"
                      />
                      <Button size="sm" disabled={busy === o.id} onClick={() => void decide(o, true)}>
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
                      {shopEmail ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={async () => {
                            const res = await notifyRetailOrder({ data: { orderId: o.id } });
                            toast[res.sent ? "success" : "error"](
                              res.sent ? `Emailed ${shopEmail}` : res.reason,
                            );
                          }}
                        >
                          <Mail className="size-4" /> Resend email
                        </Button>
                      ) : null}
                    </div>
                  ) : o.decision_note ? (
                    <p className="text-[11px] text-muted-foreground">Note: {o.decision_note}</p>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </PageSection>
  );
}
