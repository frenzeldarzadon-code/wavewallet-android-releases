import { createFileRoute } from "@tanstack/react-router";
import { Check, Receipt, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageSection, StatCard, StatusBadge, subscriptionTone } from "@/components/ui-kit";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { peso, shortDate, statusLabel } from "@/lib/wavewallet";
import {
  fetchAllRequests,
  monthsLabel,
  periodLabel,
  requestMonths,
  proofUrl,
  requestTone,
  reviewSubscriptionRequest,
  type SubscriptionRequest,
} from "@/lib/subscription";
import { toast } from "sonner";

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

  const load = useCallback(async () => {
    // Flip lapsed tenants to "expired" before reading — retention is unaffected.
    await supabase.rpc("expire_stale_subscriptions");
    const [{ data, error }, reqs] = await Promise.all([
      supabase.from("ecosystems").select("*").order("created_at", { ascending: false }),
      fetchAllRequests().catch(() => [] as SubscriptionRequest[]),
    ]);
    if (error) {
      toast.error("Could not load tenants", { description: error.message });
      return;
    }
    setRows(data ?? []);
    setRequests(reqs);
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

  const pending = requests.filter((r) => r.status === "pending");
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

      <PageSection
        title="Approval queue"
        description="Manual review only — GCash payments are never verified automatically."
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

      <PageSection title="Tenant statuses" description="Tenant data is retained on expiry — never deleted.">
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
                    <TableHead>Ecosystem</TableHead>
                    <TableHead>Plan</TableHead>
                    <TableHead className="hidden sm:table-cell">Reference</TableHead>
                    <TableHead className="hidden md:table-cell">Period end</TableHead>
                    <TableHead>Status</TableHead>
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
                      <TableCell>
                        <StatusBadge tone={subscriptionTone(eco.subscription_state)}>
                          {statusLabel[eco.subscription_state]}
                        </StatusBadge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </PageSection>

      <PageSection title="Decision history" description="Approved amounts and periods are immutable records.">
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
          <StatusBadge tone="warning">Pending</StatusBadge>
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
          placeholder="Reason (required when rejecting)"
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
