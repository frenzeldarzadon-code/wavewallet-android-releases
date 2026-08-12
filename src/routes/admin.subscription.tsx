import { createFileRoute } from "@tanstack/react-router";
import { CheckCircle2, Clock, Info, Upload, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageSection, StatusBadge, subscriptionTone } from "@/components/ui-kit";
import { useSession } from "@/lib/session";
import { peso, shortDate, statusLabel } from "@/lib/wavewallet";
import {
  fetchPlatformSettings,
  fetchRequestsForEcosystem,
  monthsForPayment,
  monthsLabel,
  prepaidRemaining,
  periodLabel,
  projectedExpiry,
  proofUrl,
  requestMonths,
  requestTone,
  submitSubscriptionRequest,
  uploadProof,
  validateProof,
  type PlatformSettings,
  type SubscriptionRequest,
} from "@/lib/subscription";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/subscription")({
  head: () => ({
    meta: [
      { title: "Subscription — WaveWallet Admin" },
      { name: "description", content: "View your plan, send the GCash payment and track manual approval status." },
      { property: "og:title", content: "Subscription — WaveWallet Admin" },
      { property: "og:description", content: "View your plan, send the GCash payment and track manual approval status." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AdminSubscription,
});

function AdminSubscription() {
  const { ecosystem, ecosystemDbId, reload } = useSession("admin");
  const [settings, setSettings] = useState<PlatformSettings | null>(null);
  const [requests, setRequests] = useState<SubscriptionRequest[]>([]);
  const [reference, setReference] = useState("");
  const [amountPaid, setAmountPaid] = useState("");
  const [proof, setProof] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const [s, r] = await Promise.all([
      fetchPlatformSettings(),
      ecosystemDbId ? fetchRequestsForEcosystem(ecosystemDbId) : Promise.resolve([]),
    ]);
    setSettings(s);
    setRequests(r);
    if (!amountPaid) {
      const rate = Number(ecosystem?.subscription.priceMonthly || s?.plan_price || 0);
      if (rate > 0) setAmountPaid(String(rate));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ecosystemDbId, ecosystem?.subscription.priceMonthly]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!ecosystem) return null;
  const sub = ecosystem.subscription;
  const notice = stateNotice(sub.status);
  const detailsMissing = Boolean(settings && !settings.gcash_number.trim());
  const pending = requests.find((r) => r.status === "pending") ?? null;
  // Only surface a rejection while it is still the outcome the operator must act on.
  const lastRejected =
    requests[0]?.status === "rejected" && sub.status !== "active" ? requests[0] : null;
  const per = settings ? periodLabel(settings.billing_period) : "month";
  // This shop's own monthly rate drives how many months a payment buys.
  const monthlyRate = Number(sub.priceMonthly || settings?.plan_price || 0);
  const quote = monthsForPayment(Number(amountPaid), monthlyRate);
  const newExpiry = quote.ok
    ? projectedExpiry(sub.status === "active" ? sub.currentPeriodEnd : null, quote.months)
    : null;

  const submit = async () => {
    if (!ecosystemDbId) return;
    setSaving(true);
    try {
      let proofPath: string | null = null;
      if (proof) proofPath = await uploadProof(ecosystemDbId, proof);
      await submitSubscriptionRequest({
        ecosystemId: ecosystemDbId,
        reference: reference.trim(),
        amountPaid: amountPaid ? Number(amountPaid) : null,
        proofPath,
      });
      setReference("");
      setProof(null);
      await load();
      reload();
      toast.success("Submitted — awaiting approval", {
        description: "The platform owner will review your payment.",
      });
    } catch (e) {
      toast.error("Could not submit payment", { description: (e as Error).message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <PageSection title="Current plan">
        <Card className="shadow-[var(--shadow-card)]">
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm text-muted-foreground">{settings?.plan_name ?? sub.planName}</p>
                <p className="text-2xl font-semibold tracking-tight">
                  {peso(Number(settings?.plan_price ?? sub.priceMonthly))}
                  <span className="text-sm font-normal text-muted-foreground"> / {per}</span>
                </p>
              </div>
              <StatusBadge tone={subscriptionTone(sub.status)}>{statusLabel[sub.status]}</StatusBadge>
            </div>
            <dl className="grid grid-cols-2 gap-y-3 border-t border-border pt-4 text-sm sm:grid-cols-4">
              <div>
                <dt className="text-xs text-muted-foreground">Period ends</dt>
                <dd className="font-medium">{sub.currentPeriodEnd ? shortDate(sub.currentPeriodEnd) : "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Grace period</dt>
                <dd className="font-medium">{sub.gracePeriodDays} days</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Last reference</dt>
                <dd className="font-medium">{requests[0]?.payment_reference ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Submitted</dt>
                <dd className="font-medium">{requests[0] ? shortDate(requests[0].created_at) : "—"}</dd>
              </div>
            </dl>
            {notice ? (
              <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">{notice}</p>
            ) : null}
            {pending ? (
              <p className="flex items-start gap-2 rounded-lg bg-warning/15 px-3 py-2 text-xs text-warning-foreground">
                <Clock className="mt-0.5 size-3.5 shrink-0" />
                Payment {pending.payment_reference} is awaiting approval. Restricted operator tools stay
                locked until it is approved.
              </p>
            ) : null}
            {!pending && lastRejected?.decision_reason ? (
              <p className="flex items-start gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
                <X className="mt-0.5 size-3.5 shrink-0" />
                Last payment was rejected: {lastRejected.decision_reason}. You can submit again below.
              </p>
            ) : null}
          </CardContent>
        </Card>
      </PageSection>

      <PageSection
        title="Pay via GCash"
        description="Send the exact amount, then submit your reference number and receipt for manual approval."
      >
        <div className="grid gap-3 lg:grid-cols-2">
          <Card className="shadow-[var(--shadow-card)]">
            <CardHeader>
              <CardTitle className="text-sm">Payment details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <Row label="GCash number" value={settings?.gcash_number || "—"} />
              <Row label="Account name" value={settings?.gcash_account_name || "—"} />
              <Row label="Billing period" value={`Every ${per}`} />
              <Row label="Monthly rate (this shop)" value={`${peso(monthlyRate)} / month`} />
              <Row
                label="Current expiration"
                value={sub.currentPeriodEnd ? shortDate(sub.currentPeriodEnd) : "—"}
              />
              <Row label="Prepaid time remaining" value={prepaidRemaining(sub.currentPeriodEnd).label} />
              <Row
                label="Amount due"
                value={quote.ok ? `${peso(quote.amount)} · ${monthsLabel(quote.months)}` : peso(monthlyRate)}
                highlight
              />
              <p className="text-[11px] text-muted-foreground">
                Months are counted from the amount paid — {peso(monthlyRate)} = 1 month,{" "}
                {peso(monthlyRate * 2)} = 2 months, {peso(monthlyRate * 3)} = 3 months. Anything
                left over that does not complete a month is recorded as unapplied, never absorbed.
              </p>
              {detailsMissing ? (
                <p className="flex items-start gap-2 rounded-lg bg-warning/15 px-3 py-2 text-xs text-warning-foreground">
                  <Info className="mt-0.5 size-3.5 shrink-0" />
                  The platform owner has not published collection details yet. Contact them before
                  sending any payment.
                </p>
              ) : null}
              {settings?.payment_instructions ? (
                <p className="flex items-start gap-2 rounded-lg bg-brand-soft px-3 py-2 text-xs text-accent-foreground">
                  <Info className="mt-0.5 size-3.5 shrink-0" />
                  {settings.payment_instructions}
                </p>
              ) : null}
            </CardContent>
          </Card>

          <Card className="shadow-[var(--shadow-card)]">
            <CardHeader>
              <CardTitle className="text-sm">Submit payment</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="ref">GCash reference number</Label>
                <Input
                  id="ref"
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  placeholder="e.g. GC-1234-5678"
                  disabled={Boolean(pending)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="paid">Amount paid</Label>
                <Input
                  id="paid"
                  type="number"
                  value={amountPaid}
                  onChange={(e) => setAmountPaid(e.target.value)}
                  disabled={Boolean(pending)}
                />
                {quote.ok ? (
                  <>
                    <p className="text-[11px] text-success">
                      {monthsLabel(quote.months)} × {peso(quote.rate)} = {peso(quote.applied)} —
                      active until {newExpiry ? shortDate(newExpiry.toISOString()) : "—"}
                      {sub.status === "active" ? " (extends your current period)" : ""}
                    </p>
                    {quote.remainder > 0 ? (
                      <p className="text-[11px] text-warning-foreground">
                        {peso(quote.remainder)} left over — not enough for another month. It is
                        recorded as unapplied on this payment, not lost.
                      </p>
                    ) : null}
                  </>
                ) : (
                  <p className="text-[11px] text-destructive">{quote.error}</p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="proof">Proof of payment (optional)</Label>
                <Input
                  id="proof"
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  disabled={Boolean(pending)}
                  onChange={(e) => {
                    const file = e.target.files?.[0] ?? null;
                    if (file) {
                      const problem = validateProof(file);
                      if (problem) {
                        toast.error(problem);
                        e.target.value = "";
                        return;
                      }
                    }
                    setProof(file);
                  }}
                />
                {proof ? (
                  <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <Upload className="size-3" /> {proof.name}
                  </p>
                ) : null}
              </div>
              <Button
                className="w-full"
                disabled={
                  !reference.trim() || !quote.ok || saving || !ecosystemDbId || Boolean(pending)
                }
                onClick={() => void submit()}
              >
                <CheckCircle2 className="size-4" />
                {pending ? "Awaiting approval" : "I have paid — submit for approval"}
              </Button>
              <p className="text-[11px] text-muted-foreground">
                Approval is manual — payments are never verified automatically. Your shop stays
                read-only until the platform marks the subscription active. No tenant data is deleted
                on expiry.
              </p>
              {facebookUrl ? (
                <div className="rounded-lg bg-brand-soft px-3 py-3 text-xs">
                  <p className="mb-2 text-accent-foreground">
                    Payment sent? Message us with your reference number so we can confirm it faster.
                  </p>
                  <Button asChild size="sm" variant="outline" className="w-full">
                    <a href={facebookUrl} target="_blank" rel="noreferrer noopener">
                      <Facebook className="size-4" /> Contact us on Facebook
                      {facebookName ? ` · ${facebookName}` : ""}
                    </a>
                  </Button>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </div>
      </PageSection>

      <PageSection title="Payment history" description="Every request keeps the price and period that applied when it was submitted.">
        {requests.length === 0 ? (
          <p className="text-sm text-muted-foreground">No payment requests submitted yet.</p>
        ) : (
          <div className="space-y-2">
            {requests.map((r) => (
              <HistoryRow key={r.id} request={r} />
            ))}
          </div>
        )}
      </PageSection>
    </>
  );
}

function HistoryRow({ request }: { request: SubscriptionRequest }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    void proofUrl(request.proof_path).then(setUrl);
  }, [request.proof_path]);

  return (
    <Card className="shadow-[var(--shadow-card)]">
      <CardContent className="flex flex-wrap items-start justify-between gap-3 py-4">
        <div className="space-y-1">
          <p className="text-sm font-medium">
            {request.plan_name} · {peso(Number(request.amount_due))} / {periodLabel(request.billing_period)}
          </p>
          <p className="text-xs text-muted-foreground">
            Ref {request.payment_reference} · submitted {shortDate(request.created_at)}
            {request.reviewed_at ? ` · reviewed ${shortDate(request.reviewed_at)}` : ""}
          </p>
          <p className="text-xs text-muted-foreground">
            {monthsLabel(requestMonths(request))}
            {request.monthly_rate ? ` × ${peso(Number(request.monthly_rate))}/month` : ""} ·{" "}
            {peso(Number(request.amount_paid ?? request.amount_due))} paid
            {Number(request.remainder_amount ?? 0) > 0
              ? ` · ${peso(Number(request.remainder_amount))} unapplied`
              : ""}
          </p>
          {request.period_end ? (
            <p className="text-xs text-success">Active until {shortDate(request.period_end)}</p>
          ) : null}
          {request.decision_reason ? (
            <p className="text-xs text-destructive">Reason: {request.decision_reason}</p>
          ) : null}
          {url ? (
            <a href={url} target="_blank" rel="noreferrer" className="text-xs text-primary underline">
              View receipt
            </a>
          ) : null}
        </div>
        <StatusBadge tone={requestTone(request.status)}>{request.status}</StatusBadge>
      </CardContent>
    </Card>
  );
}

function Row({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex items-center justify-between border-b border-border pb-2 last:border-0">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={highlight ? "font-semibold text-success" : "font-medium"}>{value}</span>
    </div>
  );
}

/** Plain-language guidance for every subscription state. Data is never deleted. */
function stateNotice(status: string): string | null {
  switch (status) {
    case "expired":
      return "Your paid period and grace window have ended. Your shop is read-only — all customers, wallets, points and voucher records are safely kept. Submit a renewal below to reactivate.";
    case "suspended":
      return "This shop was suspended by the platform. Contact the platform owner — your data remains intact.";
    case "rejected":
      return "Your last payment was rejected. Review the reason, then submit a new payment reference below.";
    case "awaiting_approval":
      return "Your payment is queued for manual review by the platform owner.";
    case "pending":
      return "This shop has not been activated yet. Send the first payment below to start your subscription.";
    default:
      return null;
  }
}
