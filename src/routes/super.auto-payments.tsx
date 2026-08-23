import { createFileRoute } from "@tanstack/react-router";
import { AlertTriangle, Check, Search, ShieldCheck, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
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
import { Textarea } from "@/components/ui/textarea";
import { PageSection, StatCard, StatusBadge } from "@/components/ui-kit";
import { useSession } from "@/lib/session";
import { peso, shortDateTime } from "@/lib/wavewallet";
import {
  type AutoApprovedPayment,
  type AutoReviewState,
  REVIEW_LABEL,
  fetchAutoApprovedPayments,
  matchSignals,
  matchesSearch,
  planSummary,
  planTotal,
  reviewAutoApprovedPayment,
  reviewTone,
} from "@/lib/auto-payments";
import { toast } from "sonner";

type Filter = "all" | AutoReviewState;

const FILTERS: { value: Filter; label: string }[] = [
  { value: "pending", label: "Pending review" },
  { value: "verified", label: "Verified" },
  { value: "invalid", label: "Invalid" },
  { value: "all", label: "All" },
];

export const Route = createFileRoute("/super/auto-payments")({
  head: () => ({
    meta: [
      { title: "Auto-approved payments — WaveWallet Super Admin" },
      {
        name: "description",
        content:
          "Review every subscription payment the payment listener approved automatically: verify the money or mark it invalid and hold the shop's paid benefits.",
      },
      { property: "og:title", content: "Auto-approved payments — WaveWallet Super Admin" },
      {
        property: "og:description",
        content:
          "Review every subscription payment the payment listener approved automatically: verify the money or mark it invalid and hold the shop's paid benefits.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SuperAutoPayments,
});

function SuperAutoPayments() {
  const session = useSession("super_admin");
  const [rows, setRows] = useState<AutoApprovedPayment[]>([]);
  const [filter, setFilter] = useState<Filter>("pending");
  const [query, setQuery] = useState("");
  const [from, setFrom] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [invalidTarget, setInvalidTarget] = useState<AutoApprovedPayment | null>(null);

  const load = useCallback(async () => {
    try {
      setRows(await fetchAutoApprovedPayments("all"));
    } catch (e) {
      toast.error("Could not load automatic payments", { description: (e as Error).message });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = useMemo(
    () =>
      rows.filter(
        (r) =>
          (filter === "all" || r.review_state === filter) &&
          matchesSearch(r, query) &&
          (!from || (r.auto_approved_at ?? r.submitted_at ?? "") >= from),
      ),
    [rows, filter, query, from],
  );

  const counts = useMemo(
    () => ({
      pending: rows.filter((r) => r.review_state === "pending").length,
      verified: rows.filter((r) => r.review_state === "verified").length,
      invalid: rows.filter((r) => r.review_state === "invalid").length,
    }),
    [rows],
  );

  if (!session.account) return null;

  const decide = async (row: AutoApprovedPayment, decision: "verified" | "invalid", reason?: string) => {
    setBusy(row.id);
    try {
      await reviewAutoApprovedPayment({
        requestId: row.id,
        decision,
        ...(reason ? { reason } : {}),
      });
      await load();
      if (decision === "verified")
        toast.success("Payment verified", { description: `${row.shop_name ?? "Shop"} keeps full access.` });
      else
        toast.error("Payment marked invalid", {
          description: `${row.shop_name ?? "Shop"} paid benefits are on hold and the operator was notified.`,
        });
    } catch (e) {
      toast.error("Review failed", { description: (e as Error).message });
    } finally {
      setBusy(null);
      setInvalidTarget(null);
    }
  };

  return (
    <>
      <PageSection
        devSlot="auto-payments.summary"
        title="Auto-approved payments"
        description="Every subscription payment the payment listener approved without a human. Automatic approval activates the shop; the money still needs your confirmation."
      >
        <div className="grid grid-cols-3 gap-3">
          <StatCard label="Pending review" value={String(counts.pending)} tone="negative" />
          <StatCard label="Verified" value={String(counts.verified)} tone="positive" />
          <StatCard label="Invalid" value={String(counts.invalid)} tone="brand" />
        </div>
      </PageSection>

      <PageSection devSlot="auto-payments.list" title="Review queue">
        <div className="mb-3 flex flex-wrap items-center gap-2">
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
          <div className="relative min-w-48 flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-8"
              placeholder="Shop, operator, plan, reference or payer"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <Input
            type="date"
            className="w-40"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            aria-label="Approved on or after"
          />
        </div>

        {visible.length === 0 ? (
          <p className="text-sm text-muted-foreground">No automatic payments match this view.</p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {visible.map((row) => (
              <PaymentCard
                key={row.id}
                row={row}
                busy={busy === row.id}
                onVerify={() => void decide(row, "verified")}
                onInvalid={() => setInvalidTarget(row)}
              />
            ))}
          </div>
        )}
      </PageSection>

      <InvalidDialog
        row={invalidTarget}
        busy={busy === invalidTarget?.id}
        onClose={() => setInvalidTarget(null)}
        onConfirm={(reason) => invalidTarget && void decide(invalidTarget, "invalid", reason)}
      />
    </>
  );
}

function PaymentCard({
  row,
  busy,
  onVerify,
  onInvalid,
}: {
  row: AutoApprovedPayment;
  busy: boolean;
  onVerify: () => void;
  onInvalid: () => void;
}) {
  const signals = matchSignals(row);
  return (
    <Card className="shadow-[var(--shadow-card)]">
      <CardContent className="space-y-3 py-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="font-medium">{row.shop_name ?? "Shop"}</p>
            <p className="text-xs text-muted-foreground">{row.operator_name ?? "Operator"}</p>
          </div>
          <StatusBadge tone={reviewTone(row.review_state)}>{REVIEW_LABEL[row.review_state]}</StatusBadge>
        </div>

        <div className="rounded-lg bg-muted px-3 py-2 text-xs">
          <p className="font-medium">{planSummary(row)}</p>
          <p className="text-muted-foreground">Total paid {peso(planTotal(row))}</p>
        </div>

        <dl className="grid grid-cols-2 gap-y-2 text-xs">
          <Fact label="Reference" value={row.payment_reference} />
          <Fact label="Payer account" value={row.payer_number} />
          <Fact label="Paid into" value={row.payment_method_name} />
          <Fact label="Provider" value={row.listener_provider} />
          <Fact
            label="Notification"
            value={
              row.listener_sender || row.listener_amount != null
                ? `${row.listener_sender ?? "—"}${row.listener_amount != null ? ` · ${peso(Number(row.listener_amount))}` : ""}`
                : null
            }
          />
          <Fact
            label="Notification time"
            value={row.listener_posted_at ? shortDateTime(row.listener_posted_at) : null}
          />
          <Fact label="Submitted" value={row.submitted_at ? shortDateTime(row.submitted_at) : null} />
          <Fact
            label="Auto-approved"
            value={row.auto_approved_at ? shortDateTime(row.auto_approved_at) : null}
          />
        </dl>

        <p className="text-xs text-muted-foreground">
          Signals matched: {signals.length ? signals.join(", ") : "recorded on the payment"}
        </p>

        {row.review_state !== "pending" ? (
          <p className="text-xs text-muted-foreground">
            {REVIEW_LABEL[row.review_state]} by {row.reviewed_by_name ?? "—"} ·{" "}
            {row.reviewed_at ? shortDateTime(row.reviewed_at) : "—"}
            {row.review_reason ? ` · ${row.review_reason}` : ""}
          </p>
        ) : null}

        {row.entitlement_hold ? (
          <p className="flex items-start gap-1.5 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            Paid benefits are on hold. {row.frozen_reason ?? ""}
          </p>
        ) : null}

        <div className="flex gap-2">
          <Button size="sm" className="flex-1" disabled={busy || row.review_state === "verified"} onClick={onVerify}>
            <Check className="size-4" /> Verified
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="flex-1 text-destructive"
            disabled={busy || row.review_state === "invalid"}
            onClick={onInvalid}
          >
            <X className="size-4" /> Invalid
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function Fact({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium break-all">{value?.trim() ? value : "—"}</dd>
    </div>
  );
}

function InvalidDialog({
  row,
  busy,
  onClose,
  onConfirm,
}: {
  row: AutoApprovedPayment | null;
  busy: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  useEffect(() => {
    setReason("");
  }, [row?.id]);
  if (!row) return null;
  return (
    <Dialog open onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="size-4" /> Mark payment invalid
          </DialogTitle>
          <DialogDescription>
            {row.shop_name ?? "This shop"} keeps its account and history, but its paid subscription
            benefits go on hold immediately and the operator is notified.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="invalid-reason">Reason (shown to the operator)</Label>
          <Textarea
            id="invalid-reason"
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. no matching payment found in the receiving account"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={busy || !reason.trim()}
            onClick={() => onConfirm(reason)}
          >
            Mark invalid and hold benefits
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
