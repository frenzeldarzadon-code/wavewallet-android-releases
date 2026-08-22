import { createFileRoute } from "@tanstack/react-router";
import { CalendarClock, Check, Receipt, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageSection, StatCard, StatusBadge, subscriptionTone } from "@/components/ui-kit";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { peso, shortDate, statusLabel } from "@/lib/wavewallet";
import {
  ADJUSTMENT_REASONS,
  adjustExpiration,
  adjustmentIsShortening,
  adjustmentSummary,
  adjustmentTimeFrame,
  fetchAdjustments,
  fetchAllRequests,
  prepaidRemaining,
  type SubscriptionAdjustment,
  monthsLabel,
  periodLabel,
  requestMonths,
  proofUrl,
  requestTone,
  reviewSubscriptionRequest,
  type SubscriptionRequest,
} from "@/lib/subscription";
import { toast } from "sonner";
import { RECEIPT_CHECK_LABEL, type ReceiptCheck } from "@/lib/cash-in-receipt";
import { describeGoLiveRequest } from "@/lib/go-live-status";

/** Receipt evidence stored on the request; never an approval authority. */
const receiptCheck = (r: { receipt_check?: string | null }): ReceiptCheck =>
  ((r.receipt_check as ReceiptCheck | null) ?? "skipped");

type EcoRow = Database["public"]["Tables"]["ecosystems"]["Row"];
type Filter = "all" | "active" | "awaiting_approval" | "pending" | "expired" | "rejected";

const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "awaiting_approval", label: "Pending" },
  { value: "expired", label: "Expired" },
  { value: "rejected", label: "Rejected" },
];

export const Route = createFileRoute("/super/subscriptions")({
  head: () => ({
    meta: [
      { title: "Subscriptions & Revenue — WaveWallet Super Admin" },
      { name: "description", content: "Review GCash payment submissions, approve or reject tenant subscriptions and track revenue." },
      { property: "og:title", content: "Subscriptions & Revenue — WaveWallet Super Admin" },
      { property: "og:description", content: "Review GCash payment submissions, approve or reject tenant subscriptions and track revenue." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SuperSubscriptions,
});

function SuperSubscriptions() {
  const [rows, setRows] = useState<EcoRow[]>([]);
  const [requests, setRequests] = useState<SubscriptionRequest[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [adjustments, setAdjustments] = useState<SubscriptionAdjustment[]>([]);
  const [adjusting, setAdjusting] = useState<EcoRow | null>(null);

  const load = useCallback(async () => {
    // Flip lapsed tenants to "expired" before reading — retention is unaffected.
    await supabase.rpc("expire_stale_subscriptions");
    const [{ data, error }, reqs, adjs] = await Promise.all([
      // Legacy shops only — Subscription Shops have their own console area.
      supabase
        .from("ecosystems")
        .select("*")
        .eq("shop_kind", "legacy")
        .order("created_at", { ascending: false }),

      fetchAllRequests().catch(() => [] as SubscriptionRequest[]),
      fetchAdjustments().catch(() => [] as SubscriptionAdjustment[]),
    ]);
    if (error) {
      toast.error("Could not load tenants", { description: error.message });
      return;
    }
    setRows(data ?? []);
    setRequests(reqs);
    setAdjustments(adjs);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const ecoName = useMemo(
    () => Object.fromEntries(rows.map((e) => [e.id, e.name] as const)),
    [rows],
  );

  const review = async (req: SubscriptionRequest, decision: "approved" | "rejected") => {
    if (decision === "rejected" && !reasons[req.id]?.trim()) {
      toast.error("Add a reason before rejecting");
      return;
    }
    setBusy(req.id);
    try {
      await reviewSubscriptionRequest(req.id, decision, reasons[req.id]);
      await load();
      if (decision === "approved") toast.success(`Approved ${ecoName[req.ecosystem_id] ?? "tenant"}`);
      else toast.error(`Rejected ${ecoName[req.ecosystem_id] ?? "tenant"}`);
    } catch (e) {
      toast.error("Review failed", { description: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  // Legacy shops only — New Generation Go Live payments live in Subscription Shops.
  const pending = requests.filter((r) => r.status === "pending" && Boolean(ecoName[r.ecosystem_id]));
  const active = rows.filter((e) => e.subscription_state === "active");
  const mrr = active.reduce((s, e) => s + Number(e.plan_price), 0);
  const visible =
    filter === "all"
      ? rows
      : rows.filter((e) =>
          filter === "awaiting_approval"
            ? e.subscription_state === "awaiting_approval" || e.subscription_state === "pending"
            : e.subscription_state === filter,
        );

  return (
    <>
      <PageSection>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Recurring revenue" value={peso(mrr)} tone="positive" hint="Active tenants" />
          <StatCard label="Awaiting approval" value={String(pending.length)} tone="negative" />
          <StatCard label="Active tenants" value={String(active.length)} tone="brand" />
          <StatCard label="Total tenants" value={String(rows.length)} />
        </div>
      </PageSection>

      <PageSection devSlot="subscriptions.approval-queue"
        title="Approval queue"
        description="Legacy shop payments. Each card explains exactly why it is still open."
      >
        <div className="grid gap-3 md:grid-cols-2">
          {pending.length === 0 ? (
            <p className="text-sm text-muted-foreground">No submissions awaiting review.</p>
          ) : null}
          {pending.map((req) => (
            <PendingCard
              key={req.id}
              request={req}
              ecosystemName={ecoName[req.ecosystem_id] ?? "Unknown shop"}
              busy={busy === req.id}
              reason={reasons[req.id] ?? ""}
              onReason={(v) => setReasons((r) => ({ ...r, [req.id]: v }))}
              onReview={(d) => void review(req, d)}
            />
          ))}
        </div>
      </PageSection>

      <PageSection devSlot="subscriptions.tenant-statuses" title="Tenant statuses" description="Monthly rate is set per shop. Expiration adjustments are platform-owner only and never rewrite a payment.">
        <div className="mb-3 flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <Button
              key={f.value}
              size="sm"
              variant={filter === f.value ? "default" : "outline"}
              onClick={() => setFilter(f.value)}
            >
              {f.label}
            </Button>
          ))}
        </div>
        <Card className="shadow-[var(--shadow-card)]">
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Shop</TableHead>
                    <TableHead>Plan</TableHead>
                    <TableHead className="hidden sm:table-cell">Reference</TableHead>
                    <TableHead className="hidden md:table-cell">Period end</TableHead>
                    <TableHead className="hidden lg:table-cell">Prepaid left</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Expiration</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visible.map((eco) => (
                    <TableRow key={eco.id}>
                      <TableCell className="font-medium">{eco.name}</TableCell>
                      <TableCell className="text-sm">
                        {eco.plan_name} · {peso(Number(eco.plan_price))}
                      </TableCell>
                      <TableCell className="hidden sm:table-cell text-sm text-muted-foreground">
                        {eco.payment_reference ?? "—"}
                      </TableCell>
                      <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                        {eco.current_period_end ? shortDate(eco.current_period_end) : "—"}
                      </TableCell>
                      <TableCell className="hidden lg:table-cell text-sm text-muted-foreground">
                        {prepaidRemaining(eco.current_period_end).label}
                      </TableCell>
                      <TableCell>
                        <StatusBadge tone={subscriptionTone(eco.subscription_state)}>
                          {statusLabel[eco.subscription_state]}
                        </StatusBadge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" variant="outline" onClick={() => setAdjusting(eco)}>
                          <CalendarClock className="size-3.5" />
                          Adjust expiration
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </PageSection>

      <PageSection devSlot="subscriptions.expiration-adjustments"
        title="Expiration adjustments"
        description="Courtesy and dispute changes, kept separate from payment extensions."
      >
        {adjustments.length === 0 ? (
          <p className="text-sm text-muted-foreground">No manual adjustments recorded.</p>
        ) : (
          <div className="space-y-2">
            {adjustments.map((a) => (
              <Card key={a.id} className="shadow-[var(--shadow-card)]">
                <CardContent className="flex flex-wrap items-start justify-between gap-3 py-4">
                  <div className="space-y-1">
                    <p className="text-sm font-medium">
                      {ecoName[a.ecosystem_id] ?? "Shop"} · {adjustmentSummary(a)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {shortDate(a.created_at)}
                      {a.note ? ` · Note: ${a.note}` : ""}
                    </p>
                  </div>
                  <StatusBadge tone={a.direction === "shortened" ? "danger" : "warning"}>
                    {a.direction === "shortened" ? "Shortened" : "Courtesy"}{" "}
                    {adjustmentTimeFrame(a.previous_period_end, a.new_period_end)}
                  </StatusBadge>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </PageSection>

      <AdjustExpirationDialog
        ecosystem={adjusting}
        onClose={() => setAdjusting(null)}
        onDone={() => {
          setAdjusting(null);
          void load();
        }}
      />

      <PageSection devSlot="subscriptions.decision-history" title="Decision history" description="Approved amounts and periods are immutable records.">
        {requests.filter((r) => r.status !== "pending").length === 0 ? (
          <p className="text-sm text-muted-foreground">No decisions recorded yet.</p>
        ) : (
          <div className="space-y-2">
            {requests
              .filter((r) => r.status !== "pending")
              .map((r) => (
                <Card key={r.id} className="shadow-[var(--shadow-card)]">
                  <CardContent className="flex flex-wrap items-start justify-between gap-3 py-4">
                    <div className="space-y-1">
                      <p className="text-sm font-medium">
                        {ecoName[r.ecosystem_id] ?? "Shop"} · {peso(Number(r.amount_due))} ·{" "}
                        {monthsLabel(requestMonths(r))}
                        {r.monthly_rate ? ` @ ${peso(Number(r.monthly_rate))}/month` : ""}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Ref {r.payment_reference} · {r.reviewed_by_name ?? "—"} ·{" "}
                        {r.reviewed_at ? shortDate(r.reviewed_at) : "—"}
                      </p>
                      {r.period_end ? (
                        <p className="text-xs text-success">
                          Covered {r.period_start ? shortDate(r.period_start) : "—"} →{" "}
                          {shortDate(r.period_end)}
                        </p>
                      ) : null}
                      {r.decision_reason ? (
                        <p className="text-xs text-destructive">Reason: {r.decision_reason}</p>
                      ) : null}
                    </div>
                    <StatusBadge tone={requestTone(r.status)}>{r.status}</StatusBadge>
                  </CardContent>
                </Card>
              ))}
          </div>
        )}
      </PageSection>
    </>
  );
}

function PendingCard({
  request,
  ecosystemName,
  busy,
  reason,
  onReason,
  onReview,
}: {
  request: SubscriptionRequest;
  ecosystemName: string;
  busy: boolean;
  reason: string;
  onReason: (v: string) => void;
  onReview: (decision: "approved" | "rejected") => void;
}) {
  const status = describeGoLiveRequest(request);
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    void proofUrl(request.proof_path).then(setUrl);
  }, [request.proof_path]);

  return (
    <Card className="shadow-[var(--shadow-card)]">
      <CardContent className="space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="font-medium">{ecosystemName}</p>
            <p className="text-xs text-muted-foreground">{request.requested_by_name}</p>
          </div>
          <StatusBadge tone={status.tone}>{status.badge}</StatusBadge>
        </div>
        <div
          className={
            status.kind === "invalid" || status.kind === "review"
              ? "rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs leading-relaxed text-destructive"
              : "rounded-lg border border-border bg-muted/50 px-3 py-2 text-xs leading-relaxed text-muted-foreground"
          }
        >
          <p className="font-medium">{status.detail}</p>
          {status.fix ? <p className="mt-1">What to do: {status.fix}</p> : null}
          {!status.actionRequired ? <p className="mt-1 font-medium">No action required.</p> : null}
        </div>
        <dl className="grid grid-cols-2 gap-y-2 text-xs">
          <div>
            <dt className="text-muted-foreground">Amount due</dt>
            <dd className="font-medium">{peso(Number(request.amount_due))}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Amount paid</dt>
            <dd className="font-medium">
              {request.amount_paid == null ? "—" : peso(Number(request.amount_paid))}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Months covered</dt>
            <dd className="font-medium">
              {monthsLabel(requestMonths(request))}
              {request.monthly_rate ? ` @ ${peso(Number(request.monthly_rate))}/mo` : ""}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Reference</dt>
            <dd className="font-medium">{request.payment_reference}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Submitted</dt>
            <dd className="font-medium">{shortDate(request.created_at)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Receipt check</dt>
            <dd
              className={
                receiptCheck(request) === "matched"
                  ? "font-medium text-success"
                  : receiptCheck(request) === "mismatch"
                    ? "font-medium text-destructive"
                    : "font-medium"
              }
            >
              {RECEIPT_CHECK_LABEL[receiptCheck(request)] ?? "—"}
            </dd>
          </div>
        </dl>
        {url ? (
          <a href={url} target="_blank" rel="noreferrer" className="block">
            <img
              src={url}
              alt={`Proof of payment from ${ecosystemName}`}
              className="max-h-48 w-full rounded-lg border border-border object-contain"
              loading="lazy"
            />
          </a>
        ) : (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Receipt className="size-3.5" /> No receipt attached
          </p>
        )}
        <Input
          placeholder="Reason for deciding this by hand (required when rejecting)"
          value={reason}
          onChange={(e) => onReason(e.target.value)}
        />
        <div className="flex gap-2">
          <Button size="sm" className="flex-1" disabled={busy} onClick={() => onReview("approved")}>
            <Check className="size-4" /> Approve
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="flex-1 text-destructive"
            disabled={busy}
            onClick={() => onReview("rejected")}
          >
            <X className="size-4" /> Reject
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Platform-owner only. A courtesy/dispute change to the live expiry — recorded
 * as its own audit event; payment records stay untouched. Shortening an expiry
 * can cut a paying shop off early, so it needs an explicit confirmation.
 */
function AdjustExpirationDialog({
  ecosystem,
  onClose,
  onDone,
}: {
  ecosystem: EcoRow | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [date, setDate] = useState("");
  const [reason, setReason] = useState<string>(ADJUSTMENT_REASONS[0]);
  const [note, setNote] = useState("");
  const [confirmShorten, setConfirmShorten] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!ecosystem) return;
    const current = ecosystem.current_period_end
      ? new Date(ecosystem.current_period_end)
      : new Date();
    setDate(current.toISOString().slice(0, 10));
    setReason(ADJUSTMENT_REASONS[0]);
    setNote("");
    setConfirmShorten(false);
  }, [ecosystem]);

  if (!ecosystem) return null;

  const previous = ecosystem.current_period_end;
  const next = date ? new Date(`${date}T23:59:59`) : null;
  const shortening = next ? adjustmentIsShortening(previous, next) : false;
  const frame = next ? adjustmentTimeFrame(previous, next) : "—";

  const save = async () => {
    if (!next) return;
    setSaving(true);
    try {
      await adjustExpiration({
        ecosystemId: ecosystem.id,
        newPeriodEnd: next,
        reason,
        note,
        confirmShorten,
      });
      toast.success(`Expiration adjusted (${frame})`, { description: ecosystem.name });
      onDone();
    } catch (e) {
      toast.error("Could not adjust expiration", { description: (e as Error).message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Adjust expiration — {ecosystem.name}</DialogTitle>
          <DialogDescription>
            Separate from payment processing. The original payment record is never changed.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="rounded-lg bg-muted px-3 py-2 text-xs">
            <p>
              Monthly rate: <strong>{peso(Number(ecosystem.plan_price))}</strong> / month
            </p>
            <p>Current expiration: {previous ? shortDate(previous) : "none"}</p>
            <p>{prepaidRemaining(previous).label}</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-exp">New expiration date</Label>
            <Input id="new-exp" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            <p className={shortening ? "text-[11px] text-destructive" : "text-[11px] text-success"}>
              {frame} {shortening ? "— this shortens the paid period" : ""}
            </p>
          </div>
          <div className="space-y-1.5">
            <Label>Adjustment reason</Label>
            <Select value={reason} onValueChange={setReason}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ADJUSTMENT_REASONS.map((r) => (
                  <SelectItem key={r} value={r}>
                    {r}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="adj-note">Admin note (optional)</Label>
            <Textarea
              id="adj-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Context for the audit trail"
              rows={2}
            />
          </div>
          {shortening ? (
            <label className="flex items-start gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
              <Checkbox
                checked={confirmShorten}
                onCheckedChange={(v) => setConfirmShorten(v === true)}
              />
              I understand this shortens {ecosystem.name}&apos;s access and confirm the change.
            </label>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!date || saving || (shortening && !confirmShorten)}
            onClick={() => void save()}
          >
            Save adjustment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
