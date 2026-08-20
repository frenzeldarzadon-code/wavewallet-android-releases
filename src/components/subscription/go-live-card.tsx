/**
 * GO LIVE — turns a free Demo (New Generation) shop into a live shop.
 *
 * The member picks one of the existing subscription plans, pays the platform
 * GCash number, then states the same two identifiers the Cash In listener
 * already needs: the GCash number they paid FROM and the reference number.
 * The platform listener does the recognising; this form only associates the
 * payment with the pending request. Demo Coins are never converted.
 */
import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Loader2, Rocket, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageSection, StatusBadge } from "@/components/ui-kit";
import { peso } from "@/lib/wavewallet";
import { fetchPlans, type SubscriptionPlan } from "@/lib/subscription-shops";
import {
  fetchGoLiveRequest,
  fetchPlatformGcash,
  goLiveStatusLine,
  submitGoLivePayment,
  validateGoLive,
  type SubscriptionRequest,
} from "@/lib/go-live";

type Gcash = Awaited<ReturnType<typeof fetchPlatformGcash>>;

export function GoLiveCard({
  ecosystemId,
  onLive,
}: {
  ecosystemId: string;
  onLive?: () => void;
}) {
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [gcash, setGcash] = useState<Gcash>(null);
  const [request, setRequest] = useState<SubscriptionRequest | null>(null);
  const [planId, setPlanId] = useState("");
  const [months, setMonths] = useState("1");
  const [payerNumber, setPayerNumber] = useState("");
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [p, g, r] = await Promise.all([
        fetchPlans(),
        fetchPlatformGcash(),
        fetchGoLiveRequest(ecosystemId),
      ]);
      setPlans(p);
      setGcash(g);
      setRequest(r);
      setPlanId((v) => v || p[0]?.id || "");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not load the Go Live details");
    } finally {
      setLoading(false);
    }
  }, [ecosystemId]);

  useEffect(() => {
    void load();
  }, [load]);

  const plan = plans.find((p) => p.id === planId) ?? null;
  const monthCount = Math.max(1, Math.min(24, Number(months) || 1));
  const due = plan ? Number(plan.monthly_price) * monthCount : 0;
  const problem = validateGoLive({ payerNumber, reference });
  const pending = request?.status === "pending";

  const submit = async () => {
    if (!plan) return;
    setBusy(true);
    try {
      const r = await submitGoLivePayment({
        ecosystemId,
        planId: plan.id,
        payerNumber,
        reference,
        months: monthCount,
        amountPaid: due,
      });
      setRequest(r);
      if (r.status === "approved") {
        toast.success("Payment verified — your shop is now live.");
        onLive?.();
      } else {
        toast.success("Payment submitted. It goes live the moment the GCash payment is recognised.");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not submit that payment");
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Loading Go Live details…
      </p>
    );
  }

  return (
    <PageSection
      title="Go Live"
      description="Pick one of the WaveWallet plans and pay it with GCash. Your shop keeps the same login, name and settings — only the Demo label goes away."
    >
      <Card className="shadow-[var(--shadow-card)]">
        <CardContent className="space-y-4 px-4">
          {request?.status === "approved" ? (
            <p className="flex items-center gap-2 text-sm font-medium text-success">
              <CheckCircle2 className="size-4" /> {goLiveStatusLine(request)}
            </p>
          ) : null}

          {pending ? (
            <div className="rounded-xl border border-warning/40 bg-warning/10 px-3 py-2.5 text-xs leading-relaxed">
              <StatusBadge tone="warning">Awaiting payment verification</StatusBadge>
              <p className="mt-1.5">
                {goLiveStatusLine(request)} Reference {request?.payment_reference} ·{" "}
                {peso(Number(request?.amount_due ?? 0))}. Your shop activates automatically once the
                platform GCash notification for this exact amount and sending number arrives.
              </p>
            </div>
          ) : (
            <>
              <div className="grid gap-2 sm:grid-cols-2">
                {plans.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setPlanId(p.id)}
                    className={`rounded-xl border px-3 py-2.5 text-left transition ${
                      p.id === planId ? "border-primary bg-primary/5" : "border-border"
                    }`}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold">{p.name}</span>
                      <span className="text-sm font-semibold text-primary">
                        {peso(Number(p.monthly_price))}/mo
                      </span>
                    </span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {Number(p.coin_allocation).toLocaleString()} Coins allocation
                      {p.tagline ? ` · ${p.tagline}` : ""}
                    </span>
                  </button>
                ))}
              </div>

              <div className="rounded-xl border bg-muted/40 px-3 py-2.5 text-xs leading-relaxed">
                <p className="flex items-center gap-1.5 font-medium">
                  <ShieldCheck className="size-3.5 text-primary" /> Send{" "}
                  <strong>{peso(due)}</strong> to the WaveWallet GCash number
                </p>
                <p className="mt-1">
                  {gcash?.gcash_number ?? "— not configured —"}
                  {gcash?.gcash_account_name ? ` · ${gcash.gcash_account_name}` : ""}
                </p>
                <p className="mt-1 text-muted-foreground">
                  Pay first, then enter the sending number and reference below exactly as they
                  appear on your GCash receipt. Each reference can only ever be used once, in any
                  shop.
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-1.5">
                  <Label htmlFor="gl-months">Months</Label>
                  <Input
                    id="gl-months"
                    inputMode="numeric"
                    value={months}
                    onChange={(e) => setMonths(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="gl-number">GCash number you paid from</Label>
                  <Input
                    id="gl-number"
                    inputMode="numeric"
                    placeholder="09XXXXXXXXX"
                    value={payerNumber}
                    onChange={(e) => setPayerNumber(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="gl-ref">GCash reference number</Label>
                  <Input
                    id="gl-ref"
                    inputMode="numeric"
                    placeholder="9044057598177"
                    value={reference}
                    onChange={(e) => setReference(e.target.value)}
                  />
                </div>
              </div>

              <p className="text-xs text-muted-foreground">
                Total to pay: <strong>{peso(due)}</strong> for {monthCount} month
                {monthCount === 1 ? "" : "s"} of {plan?.name ?? "the selected plan"}.
              </p>

              <Button className="w-full" disabled={busy || !plan || Boolean(problem)} onClick={submit}>
                {busy ? (
                  <Loader2 className="mr-1 size-4 animate-spin" />
                ) : (
                  <Rocket className="mr-1 size-4" />
                )}
                Submit payment and go live
              </Button>
              {problem ? <p className="text-xs text-destructive">{problem}</p> : null}
            </>
          )}
        </CardContent>
      </Card>
    </PageSection>
  );
}
