/**
 * R6 — the member's own cash-on-delivery duties, shown in the Universe Wallet.
 *
 * Collector: approving a request holds the full customer cash total from the
 * member's AVAILABLE Universe coins (the one and only hold); held coins are
 * shown separately and cannot be spent. Confirming CASH RECEIVED settles the
 * order exactly once. A wrong amount never settles silently — it opens a
 * discrepancy for the shop admin.
 *
 * Delivery person: sees assigned deliveries, can mark them delivered, and sees
 * their delivery-fee share (Shop Admin's configured split only).
 */
import {
  Banknote,
  Check,
  Loader2,
  Lock,
  MessageCircle,
  PackageCheck,
  Truck,
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
import { PageSection, StatusBadge } from "@/components/ui-kit";
import { RETAIL_VISIBLE } from "@/lib/features";
import { peso, shortDateTime } from "@/lib/wavewallet";
import {
  fulfillmentLabel,
  updateRetailFulfillment,
  type Fulfillment,
  type FulfillmentStatus,
} from "@/lib/retail";
import {
  confirmCashReceived,
  fetchCodHeldTotal,
  fetchMyCodAssignments,
  respondToCollectorRequest,
  type CodAssignment,
} from "@/lib/retail-cod";

export function CodAssignmentsCard({
  available,
  onChanged,
}: {
  available: number;
  onChanged?: () => void;
}) {
  const navigate = useNavigate();
  const [rows, setRows] = useState<CodAssignment[]>([]);
  const [held, setHeld] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [cashFor, setCashFor] = useState<CodAssignment | null>(null);
  const [cashAmount, setCashAmount] = useState("");

  const load = useCallback(async () => {
    try {
      const [r, h] = await Promise.all([fetchMyCodAssignments(), fetchCodHeldTotal()]);
      setRows(r);
      setHeld(h);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (!RETAIL_VISIBLE) return null;
  if (!loading && rows.length === 0 && held === 0) return null;

  const run = async (id: string, fn: () => Promise<void>, ok: string, description?: string) => {
    if (busy) return;
    setBusy(id);
    try {
      await fn();
      toast.success(ok, { description });
      await load();
      onChanged?.();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const openChat = (a: CodAssignment) => {
    if (!a.chat_thread_id) {
      toast.error("The order chat is not open yet");
      return;
    }
    void navigate({ to: "/universe/messages", search: { thread: a.chat_thread_id } });
  };

  return (
    <PageSection
      devSlot="cod-assignments-card.duties"
      title="Deliveries & collections"
      description="Cash-on-delivery duties assigned to you. Held coins float a customer's cash and cannot be spent."
    >
      <div className="mb-3 grid grid-cols-2 gap-2">
        <Card className="shadow-[var(--shadow-card)]">
          <CardContent className="py-3">
            <p className="text-[11px] text-muted-foreground">Available to spend</p>
            <p className="text-lg font-semibold text-success">{peso(available)}</p>
          </CardContent>
        </Card>
        <Card className="border-warning/40 bg-warning/10 shadow-[var(--shadow-card)]">
          <CardContent className="py-3">
            <p className="flex items-center gap-1 text-[11px] text-warning-foreground">
              <Lock className="size-3" /> Held in floats (locked)
            </p>
            <p className="text-lg font-semibold text-warning-foreground">{peso(held)}</p>
          </CardContent>
        </Card>
      </div>

      {loading ? (
        <p className="text-xs text-muted-foreground">Loading…</p>
      ) : (
        <div className="space-y-2">
          {rows.map((a) => {
            const isCollector = a.my_role === "collector";
            const active = a.status === "approved" && !a.settled_at;
            const canApprove =
              isCollector && a.collector_status === "proposed" && a.status === "approved";
            const canCash =
              isCollector &&
              a.hold_held &&
              !a.cash_received_at &&
              ["out_for_delivery", "delivered", "completed"].includes(a.fulfillment_status);
            const canDeliver =
              !isCollector &&
              a.status === "approved" &&
              a.fulfillment_status === "out_for_delivery";
            const shortBy = Math.max(0, a.expected_cash - available);
            return (
              <Card key={`${a.id}-${a.my_role}`} className="shadow-[var(--shadow-card)]">
                <CardContent className="space-y-2 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="flex items-center gap-1 text-sm font-semibold">
                        {isCollector ? (
                          <Banknote className="size-4 text-primary" />
                        ) : (
                          <Truck className="size-4 text-primary" />
                        )}
                        {a.order_no} · {a.shop_name}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        {shortDateTime(a.created_at)} · {a.customer_name}
                        {a.delivery_address ? ` · ${a.delivery_address}` : ""}
                        {a.delivery_notes ? ` · ${a.delivery_notes}` : ""}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      <StatusBadge tone="brand">
                        {isCollector ? "Collector" : "Delivery"}
                      </StatusBadge>
                      <StatusBadge tone={a.status === "approved" ? "success" : "muted"}>
                        {a.status === "approved"
                          ? fulfillmentLabel(
                              a.fulfillment_status as FulfillmentStatus,
                              "delivery" as Fulfillment,
                            )
                          : a.status}
                      </StatusBadge>
                    </div>
                  </div>

                  {isCollector ? (
                    <div className="space-y-0.5 rounded-lg bg-muted/50 px-2.5 py-2 text-[11px]">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">
                          Expected cash (products + delivery)
                        </span>
                        <span className="font-semibold">{peso(a.expected_cash)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Float status</span>
                        <span>
                          {a.settled_at
                            ? `Settled ${shortDateTime(a.settled_at)}`
                            : a.hold_held
                              ? `${peso(a.expected_cash)} held (locked)`
                              : a.collector_status === "proposed"
                                ? "Awaiting your approval — nothing held yet"
                                : a.collector_status}
                        </span>
                      </div>
                      {a.actual_cash !== null ? (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Cash you reported</span>
                          <span className={a.discrepancy ? "text-destructive" : ""}>
                            {peso(a.actual_cash)}
                            {a.discrepancy ? " · discrepancy, admin reviewing" : ""}
                          </span>
                        </div>
                      ) : null}
                      {a.settled_at ? (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Your collector share</span>
                          <span className="text-success">{peso(a.my_share)}</span>
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <div className="space-y-0.5 rounded-lg bg-muted/50 px-2.5 py-2 text-[11px]">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Delivery fee share</span>
                        <span>
                          {a.settled_at ? (
                            <span className="text-success">{peso(a.my_share)} credited</span>
                          ) : (
                            "Paid when the order settles"
                          )}
                        </span>
                      </div>
                    </div>
                  )}

                  <div className="flex flex-wrap gap-2">
                    {a.chat_thread_id && active ? (
                      <Button size="sm" variant="outline" onClick={() => openChat(a)}>
                        <MessageCircle className="size-4" /> Order chat
                      </Button>
                    ) : null}
                    {canApprove ? (
                      <>
                        <Button
                          size="sm"
                          disabled={busy === a.id || shortBy > 0}
                          title={
                            shortBy > 0 ? `You need ${peso(shortBy)} more available` : undefined
                          }
                          onClick={() =>
                            void run(
                              a.id,
                              () => respondToCollectorRequest(a.id, true),
                              "Float held",
                              `${peso(a.expected_cash)} is now locked until the order settles or is cancelled.`,
                            )
                          }
                        >
                          {busy === a.id ? (
                            <Loader2 className="size-4 animate-spin" />
                          ) : (
                            <Check className="size-4" />
                          )}
                          Approve &amp; hold {peso(a.expected_cash)}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy === a.id}
                          onClick={() =>
                            void run(
                              a.id,
                              () => respondToCollectorRequest(a.id, false),
                              "Request declined",
                            )
                          }
                        >
                          <X className="size-4" /> Decline
                        </Button>
                        {shortBy > 0 ? (
                          <p className="w-full text-[11px] text-destructive">
                            You have {peso(available)} available; this float needs{" "}
                            {peso(a.expected_cash)}.
                          </p>
                        ) : null}
                      </>
                    ) : null}
                    {canCash ? (
                      <Button
                        size="sm"
                        disabled={busy === a.id}
                        onClick={() => {
                          setCashAmount(String(a.expected_cash));
                          setCashFor(a);
                        }}
                      >
                        <Banknote className="size-4" /> Cash received
                      </Button>
                    ) : null}
                    {canDeliver ? (
                      <Button
                        size="sm"
                        disabled={busy === a.id}
                        onClick={() =>
                          void run(
                            a.id,
                            () => updateRetailFulfillment(a.id, "delivered"),
                            "Marked delivered",
                            "The customer was asked to confirm receipt.",
                          )
                        }
                      >
                        <PackageCheck className="size-4" /> Mark delivered
                      </Button>
                    ) : null}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={!!cashFor} onOpenChange={(open) => !open && setCashFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm cash for {cashFor?.order_no}</DialogTitle>
            <DialogDescription>
              Expected {cashFor ? peso(cashFor.expected_cash) : ""}. Enter exactly what you
              received. A different amount does not settle — it is flagged for the shop admin.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="cash-actual">Cash received (₱)</Label>
            <Input
              id="cash-actual"
              type="number"
              inputMode="decimal"
              step="0.01"
              min={0}
              value={cashAmount}
              onChange={(e) => setCashAmount(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCashFor(null)}>
              Back
            </Button>
            <Button
              disabled={!!busy || cashAmount === "" || Number(cashAmount) < 0}
              onClick={() => {
                const a = cashFor;
                if (!a) return;
                const amt = Number(cashAmount);
                setCashFor(null);
                void run(
                  a.id,
                  () => confirmCashReceived(a.id, amt),
                  amt === a.expected_cash ? `${a.order_no} settled` : `${a.order_no} flagged`,
                  amt === a.expected_cash
                    ? "Your float was settled and your collector share credited."
                    : "The amount differs from the expected cash; the shop admin will resolve it.",
                );
              }}
            >
              <Check className="size-4" /> Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageSection>
  );
}
