/**
 * Shop credit request queue (platform owner only).
 *
 * The database is the authority: `review_credit_purchase_order` locks the
 * order row, refuses anything that is not still pending and writes the single
 * credit ledger entry, so approving twice — or two operators approving at the
 * same moment — can never double-credit. Freezing an approved order pulls the
 * credits back with a recorded reversal entry, never silently.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, Loader2, RefreshCw, Snowflake, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PageSection } from "@/components/ui-kit";
import { statusTone } from "@/components/credit-purchase-page";
import {
  STATUS_LABEL,
  fetchCreditPurchaseOrders,
  fetchCreditPurchaseSettings,
  formatPhp,
  freezeCreditPurchaseOrder,
  reviewCreditPurchaseOrder,
  type CreditPurchaseOrder,
  type OrderStatus,
} from "@/lib/credit-purchases";
import {
  QUEUE_FILTERS,
  fetchEcosystemNames,
  filterOrders,
  pendingCount,
  type QueueFilter,
} from "@/lib/credit-management";

type Pending = { order: CreditPurchaseOrder; kind: "reject" | "freeze" } | null;

export function CreditRequestsCard({ onCountChange }: { onCountChange?: (n: number) => void }) {
  const [orders, setOrders] = useState<CreditPurchaseOrder[]>([]);
  const [shops, setShops] = useState<Map<string, string>>(new Map());
  const [currency, setCurrency] = useState("PHP");
  const [filter, setFilter] = useState<QueueFilter>("pending");
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [dialog, setDialog] = useState<Pending>(null);
  const [reason, setReason] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [list, names, cfg] = await Promise.all([
        fetchCreditPurchaseOrders({ limit: 200 }),
        fetchEcosystemNames(),
        fetchCreditPurchaseSettings(),
      ]);
      setOrders(list);
      setShops(names);
      setCurrency(cfg?.currency ?? "PHP");
      onCountChange?.(pendingCount(list));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [onCountChange]);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (key: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(key);
    try {
      await fn();
      toast.success(ok);
      setDialog(null);
      setReason("");
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const visible = useMemo(() => filterOrders(orders, filter), [orders, filter]);
  const waiting = pendingCount(orders);

  return (
    <>
      <PageSection
        title="Shop coin requests"
        description="Admins pay the platform GCash account, then submit the reference here. Approving releases the coins exactly once; rejecting releases nothing; freezing pulls released coins back with a recorded reversal."
      >
        <Card className="shadow-[var(--shadow-card)]">
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              {QUEUE_FILTERS.map((f) => (
                <Button
                  key={f.value}
                  size="sm"
                  variant={filter === f.value ? "default" : "outline"}
                  onClick={() => setFilter(f.value)}
                >
                  {f.label}
                  {f.value === "pending" && waiting > 0 ? (
                    <span className="ml-1.5 rounded-full bg-destructive px-1.5 text-[11px] font-semibold text-destructive-foreground">
                      {waiting}
                    </span>
                  ) : null}
                </Button>
              ))}
              <Button
                size="sm"
                variant="ghost"
                className="ml-auto"
                onClick={() => void load()}
                aria-label="Refresh requests"
              >
                <RefreshCw className={loading ? "size-4 animate-spin" : "size-4"} /> Refresh
              </Button>
            </div>

            {loading && orders.length === 0 ? (
              <p className="text-sm text-muted-foreground">Loading coin requests…</p>
            ) : visible.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {filter === "pending"
                  ? "No coin requests are waiting for verification."
                  : "Nothing to show for this filter."}
              </p>
            ) : (
              visible.map((o) => (
                <div key={o.id} className="rounded-xl border border-border p-3 text-sm">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{o.buyer_name}</p>
                      <p className="text-xs text-muted-foreground">
                        {shops.get(o.ecosystem_id) ?? "Unknown shop"}
                      </p>
                    </div>
                    <Badge variant={statusTone(o.status)}>
                      {STATUS_LABEL[o.status as OrderStatus] ?? o.status}
                    </Badge>
                  </div>

                  <dl className="mt-3 grid gap-1.5 text-xs sm:grid-cols-2">
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted-foreground">Coins requested</dt>
                      <dd className="font-medium text-success">
                        {Number(o.credits).toLocaleString()}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted-foreground">Amount due</dt>
                      <dd className="font-medium">
                        {formatPhp(Number(o.amount_due), currency)}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted-foreground">Package</dt>
                      <dd>
                        {o.package_name} ×{o.quantity}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted-foreground">GCash reference</dt>
                      <dd className="font-mono">{o.payment_reference}</dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted-foreground">Submitted</dt>
                      <dd>{new Date(o.created_at).toLocaleString()}</dd>
                    </div>
                    {o.list_php ? (
                      <div className="flex justify-between gap-3">
                        <dt className="text-muted-foreground">Base rate</dt>
                        <dd>
                          {formatPhp(Number(o.list_php), currency)} · {o.discount_percent}% off
                        </dd>
                      </div>
                    ) : null}
                  </dl>

                  {o.note ? (
                    <p className="mt-2 text-xs text-muted-foreground">Note: {o.note}</p>
                  ) : null}
                  {o.reviewed_at ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {o.reviewer_name} on {new Date(o.reviewed_at).toLocaleString()}
                      {o.decision_reason ? ` — ${o.decision_reason}` : ""}
                    </p>
                  ) : null}

                  {o.status === "pending" ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        disabled={busy === o.id}
                        onClick={() =>
                          void run(
                            o.id,
                            () => reviewCreditPurchaseOrder(o.id, true),
                            "Payment verified — coins released once",
                          )
                        }
                      >
                        {busy === o.id ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <CheckCircle2 className="size-4" />
                        )}
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        disabled={busy === o.id}
                        onClick={() => {
                          setReason("");
                          setDialog({ order: o, kind: "reject" });
                        }}
                      >
                        <XCircle className="size-4" /> Reject
                      </Button>
                    </div>
                  ) : null}

                  {o.status === "approved" ? (
                    <div className="mt-3">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy === o.id}
                        onClick={() => {
                          setReason("");
                          setDialog({ order: o, kind: "freeze" });
                        }}
                      >
                        <Snowflake className="size-4" /> Freeze released coins
                      </Button>
                    </div>
                  ) : null}
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </PageSection>

      <Dialog open={dialog !== null} onOpenChange={(open) => (open ? null : setDialog(null))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {dialog?.kind === "freeze" ? "Freeze released coins" : "Reject coin request"}
            </DialogTitle>
            <DialogDescription>
              {dialog?.kind === "freeze"
                ? "The coins are pulled back with a recorded reversal entry and the reason is stored on the order and in the audit log."
                : "No coins are released. The reason is shown to the admin and stored in the audit log."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="decisionReason">Reason</Label>
            <Textarea
              id="decisionReason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={
                dialog?.kind === "freeze"
                  ? "GCash transaction could not be verified"
                  : "No matching GCash payment found"
              }
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)}>
              Cancel
            </Button>
            <Button
              variant={dialog?.kind === "freeze" ? "default" : "destructive"}
              disabled={!reason.trim() || busy !== null}
              onClick={() => {
                const target = dialog;
                if (!target) return;
                const text = reason.trim();
                void run(
                  target.order.id,
                  () =>
                    target.kind === "freeze"
                      ? freezeCreditPurchaseOrder(target.order.id, text)
                      : reviewCreditPurchaseOrder(target.order.id, false, text),
                  target.kind === "freeze" ? "Released coins frozen" : "Request rejected",
                );
              }}
            >
              {busy !== null ? <Loader2 className="size-4 animate-spin" /> : null}
              {dialog?.kind === "freeze" ? "Freeze coins" : "Reject request"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
