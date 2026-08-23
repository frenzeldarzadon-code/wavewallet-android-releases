/**
 * Go Live payments — platform owner view.
 *
 * Every New Generation Shop payment with the actual reconciliation state the
 * existing engine wrote, in plain words. Manual Approve/Reject stays available
 * but is presented as the exception path: a request that is simply waiting for
 * the GCash listener says so and offers no decision buttons.
 *
 * Read-only over the listener: nothing here changes matching, tolerance,
 * timing or duplicate-reference behaviour.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, Receipt, ShieldAlert, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageSection, StatusBadge } from "@/components/ui-kit";
import { describeGoLiveRequest, goLiveStatusWeight } from "@/lib/go-live-status";
import {
  fetchAllRequests,
  monthsLabel,
  proofUrl,
  requestMonths,
  reviewSubscriptionRequest,
  type SubscriptionRequest,
} from "@/lib/subscription";
import { peso, shortDate } from "@/lib/wavewallet";

export function GoLiveRequestsCard({
  shopNames,
  onChanged,
}: {
  /** ecosystem id → shop name, for the Subscription Shops on screen. */
  shopNames: Record<string, string>;
  onChanged?: () => void;
}) {
  const [requests, setRequests] = useState<SubscriptionRequest[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const all = await fetchAllRequests();
      setRequests(all.filter((r) => r.purpose === "go_live" || r.purpose === "plan_change"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not load Go Live payments");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const ordered = useMemo(
    () =>
      [...requests].sort(
        (a, b) =>
          goLiveStatusWeight(describeGoLiveRequest(a)) -
            goLiveStatusWeight(describeGoLiveRequest(b)) ||
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      ),
    [requests],
  );

  const needing = ordered.filter((r) => describeGoLiveRequest(r).actionRequired).length;

  return (
    <PageSection devSlot="go-live-requests-card.go-live-payments"
      title="Go Live payments"
      description="Verified GCash payments activate a shop automatically. Only the states marked below need you."
    >
      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : ordered.length === 0 ? (
        <Card className="shadow-[var(--shadow-card)]">
          <CardContent className="px-4 text-sm text-muted-foreground">
            No Go Live payments submitted yet.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            {needing === 0
              ? "Nothing needs a manual decision right now."
              : `${needing} payment${needing === 1 ? "" : "s"} need a manual decision.`}
          </p>
          {ordered.map((r) => (
            <RequestRow
              key={r.id}
              request={r}
              shopName={shopNames[r.ecosystem_id] ?? "Shop"}
              onDone={() => {
                void load();
                onChanged?.();
              }}
            />
          ))}
        </div>
      )}
    </PageSection>
  );
}

function RequestRow({
  request,
  shopName,
  onDone,
}: {
  request: SubscriptionRequest;
  shopName: string;
  onDone: () => void;
}) {
  const status = describeGoLiveRequest(request);
  const [url, setUrl] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [manual, setManual] = useState(false);

  useEffect(() => {
    void proofUrl(request.proof_path).then(setUrl);
  }, [request.proof_path]);

  const review = async (decision: "approved" | "rejected") => {
    if (decision === "rejected" && !reason.trim()) {
      toast.error("Add a reason before rejecting");
      return;
    }
    setBusy(true);
    try {
      await reviewSubscriptionRequest(request.id, decision, reason);
      toast.success(decision === "approved" ? `Approved ${shopName}` : `Rejected ${shopName}`);
      onDone();
    } catch (e) {
      toast.error("Could not record that decision", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setBusy(false);
    }
  };

  const problem = status.kind === "invalid" || status.kind === "review";

  return (
    <Card className="shadow-[var(--shadow-card)]">
      <CardContent className="space-y-3 px-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="text-sm font-semibold tracking-tight">{shopName}</p>
            <p className="text-xs text-muted-foreground">
              {request.plan_name} · {peso(Number(request.amount_due))} ·{" "}
              {monthsLabel(requestMonths(request))} · Ref {request.payment_reference} ·{" "}
              {request.payment_method_name ? `Paid to ${request.payment_method_name} · ` : ""}
              {shortDate(request.created_at)}

            </p>
          </div>
          <StatusBadge tone={status.tone}>{status.badge}</StatusBadge>
        </div>

        <div
          className={
            problem
              ? "rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs leading-relaxed text-destructive"
              : "rounded-xl border border-border bg-muted/50 px-3 py-2 text-xs leading-relaxed text-muted-foreground"
          }
        >
          <p className="flex items-start gap-1.5 font-medium">
            {problem ? <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> : null}
            {status.detail}
          </p>
          {status.fix ? <p className="mt-1">What to do: {status.fix}</p> : null}
          {status.note ? <p className="mt-1 opacity-90">{status.note}</p> : null}
          {!status.actionRequired && request.status === "pending" ? (
            <p className="mt-1 font-medium">No action required.</p>
          ) : null}
        </div>

        {url ? (
          <a href={url} target="_blank" rel="noreferrer" className="block">
            <img
              src={url}
              alt={`GCash payment screenshot from ${shopName}`}
              className="max-h-48 w-full rounded-lg border border-border object-contain"
              loading="lazy"
            />
          </a>
        ) : (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Receipt className="size-3.5" /> No screenshot attached
          </p>
        )}

        {request.status === "pending" ? (
          manual ? (
            <div className="space-y-2 rounded-xl border border-warning/40 bg-warning/10 px-3 py-2.5">
              <p className="flex items-center gap-1.5 text-xs font-medium">
                <ShieldAlert className="size-3.5" /> Manual override — exception path
              </p>
              <Input
                placeholder="Why are you deciding this by hand? (required when rejecting)"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
              <div className="flex gap-2">
                <Button
                  size="sm"
                  className="flex-1"
                  disabled={busy}
                  onClick={() => void review("approved")}
                >
                  <Check className="size-4" /> Approve
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1 text-destructive"
                  disabled={busy}
                  onClick={() => void review("rejected")}
                >
                  <X className="size-4" /> Reject
                </Button>
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => setManual(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <Button size="sm" variant="outline" onClick={() => setManual(true)}>
              <ShieldAlert className="size-4" />
              {problem ? "Decide manually" : "Override manually (not needed)"}
            </Button>
          )
        ) : null}
      </CardContent>
    </Card>
  );
}
