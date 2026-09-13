/**
 * The order itself, inside its Messenger conversation.
 *
 * Every button calls the same authoritative RPC the Retail order screens use
 * (`retail_review_order`, `retail_update_fulfillment`, `cancel_retail_order`,
 * `retail_seller_cancel_order`, `retail_cod_cash_received`), so there is no
 * second copy of order state anywhere.
 */
import { Loader2, PackageCheck, Truck, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
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
import { StatusBadge } from "@/components/ui-kit";
import { peso } from "@/lib/wavewallet";
import {
  cancelRetailOrder,
  fulfillmentActionLabel,
  fulfillmentLabel,
  nextFulfillmentStep,
  reviewRetailOrder,
  updateRetailFulfillment,
} from "@/lib/retail";
import { confirmCodCashReceived } from "@/lib/retail-cod";
import {
  fetchOrderWorkspace,
  roleTitle,
  sellerCancelOrder,
  type OrderWorkspace,
} from "@/lib/order-workspace";

type Busy = null | "review" | "advance" | "cancel" | "receipt" | "cash";

export function OrderWorkspacePanel({ threadId }: { threadId: string }) {
  const [ws, setWs] = useState<OrderWorkspace | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    try {
      setWs(await fetchOrderWorkspace(threadId));
    } catch {
      setWs(null);
    }
  }, [threadId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!ws) return null;

  const next =
    ws.status === "approved" ? nextFulfillmentStep(ws.fulfillment_status, ws.fulfillment) : null;

  const run = async (kind: Busy, fn: () => Promise<void>, ok: string) => {
    if (busy) return;
    setBusy(kind);
    try {
      await fn();
      toast.success(ok);
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
      setCancelOpen(false);
    }
  };

  const spin = (kind: Busy) => (busy === kind ? <Loader2 className="size-4 animate-spin" /> : null);

  return (
    <div className="space-y-2 rounded-xl border border-border bg-card px-3 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">
            {ws.order_no} · {peso(ws.buyer_charge + (ws.payment_method === "cod" ? 0 : 0))}
          </p>
          <p className="truncate text-[11px] text-muted-foreground">
            {roleTitle[ws.role]} · {ws.items.reduce((s, i) => s + i.quantity, 0)} item(s) ·{" "}
            {ws.fulfillment === "delivery" ? "Delivery" : "Pickup"}
          </p>
        </div>
        <StatusBadge tone={ws.status === "cancelled" || ws.status === "rejected" ? "danger" : "brand"}>
          {ws.status === "approved"
            ? fulfillmentLabel(ws.fulfillment_status, ws.fulfillment)
            : ws.status}
        </StatusBadge>
      </div>

      {ws.delivery_address ? (
        <p className="flex items-start gap-1 text-[11px] text-muted-foreground">
          <Truck className="mt-0.5 size-3 shrink-0" /> {ws.delivery_address}
        </p>
      ) : null}
      {ws.decision_note ? (
        <p className="text-[11px] text-muted-foreground">Note: {ws.decision_note}</p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {ws.can_review ? (
          <>
            <Button
              size="sm"
              disabled={!!busy}
              onClick={() =>
                void run("review", () => reviewRetailOrder(ws.order_id, true), "Order accepted")
              }
            >
              {spin("review")} Accept
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!!busy}
              onClick={() =>
                void run("review", () => reviewRetailOrder(ws.order_id, false), "Order rejected")
              }
            >
              Reject
            </Button>
          </>
        ) : null}

        {ws.can_advance && next ? (
          <Button
            size="sm"
            disabled={!!busy}
            onClick={() =>
              void run(
                "advance",
                () => updateRetailFulfillment(ws.order_id, next),
                fulfillmentLabel(next, ws.fulfillment),
              )
            }
          >
            {spin("advance")} {fulfillmentActionLabel(next, ws.fulfillment)}
          </Button>
        ) : null}

        {ws.can_confirm_receipt ? (
          <Button
            size="sm"
            disabled={!!busy}
            onClick={() =>
              void run(
                "receipt",
                () => updateRetailFulfillment(ws.order_id, "completed"),
                "Marked as received",
              )
            }
          >
            {spin("receipt")} <PackageCheck className="size-4" /> I received it
          </Button>
        ) : null}

        {ws.can_collector_confirm ? (
          <Button
            size="sm"
            variant="outline"
            disabled={!!busy}
            onClick={() =>
              void run(
                "cash",
                () => confirmCodCashReceived(ws.order_id, ws.buyer_charge + ws.delivery_fee),
                "Cash confirmed",
              )
            }
          >
            {spin("cash")} Cash received
          </Button>
        ) : null}

        {ws.can_customer_cancel ? (
          <Button
            size="sm"
            variant="outline"
            disabled={!!busy}
            onClick={() =>
              void run("cancel", () => cancelRetailOrder(ws.order_id), "Order cancelled")
            }
          >
            {spin("cancel")} <X className="size-4" /> Cancel
          </Button>
        ) : null}

        {ws.can_seller_cancel ? (
          <Button size="sm" variant="outline" disabled={!!busy} onClick={() => setCancelOpen(true)}>
            <X className="size-4" /> Cancel order
          </Button>
        ) : null}
      </div>

      <AlertDialog open={cancelOpen} onOpenChange={(v) => !v && !busy && setCancelOpen(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel order {ws.order_no}?</AlertDialogTitle>
            <AlertDialogDescription>
              Any coins already taken are returned to the customer, the stock goes back and reward
              points for this order are removed. Everyone on this order is notified.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Textarea
            rows={2}
            value={note}
            placeholder="Reason for the customer (optional)"
            onChange={(e) => setNote(e.target.value)}
          />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={!!busy}>Back</AlertDialogCancel>
            <AlertDialogAction
              disabled={!!busy}
              onClick={(e) => {
                e.preventDefault();
                void run(
                  "cancel",
                  () => sellerCancelOrder(ws.order_id, note),
                  "Order cancelled",
                ).then(() => setNote(""));
              }}
            >
              {spin("cancel")} Cancel order
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
