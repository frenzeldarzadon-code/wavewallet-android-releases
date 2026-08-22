import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarClock, Coins, PlayCircle, RefreshCw, Store } from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { PageSection, StatCard, StatusBadge } from "@/components/ui-kit";
import { superadminSetShopPlan } from "@/lib/go-live";
import { SubscriptionPlansCard } from "@/components/super/subscription-plans-card";
import { GoLiveRequestsCard } from "@/components/super/go-live-requests-card";
import { peso, shortDate } from "@/lib/wavewallet";
import {
  activateSubscription,
  daysUntil,
  fetchPlans,
  fetchQuote,
  fetchLegacyShops,
  fetchSubscriptionShops,
  runSubscriptionExpiry,
  subscriptionStateLabel,
  subscriptionStateTone,
  type SubscriptionPlan,
  type SubscriptionQuote,
  type SubscriptionShop,
  type Ecosystem,
} from "@/lib/subscription-shops";

const TITLE = "Subscription Shops — WaveWallet Super Admin";
const DESCRIPTION =
  "Activate, renew and upgrade Subscription Shops, review Coin allocations and run the subscription lifecycle job.";

export const Route = createFileRoute("/super/shops")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SuperShops,
});

function SuperShops() {
  const [shops, setShops] = useState<SubscriptionShop[]>([]);
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [target, setTarget] = useState<SubscriptionShop | null>(null);
  const [override, setOverride] = useState<SubscriptionShop | null>(null);
  const [legacy, setLegacy] = useState<Ecosystem[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, p, l] = await Promise.all([
        fetchSubscriptionShops(),
        fetchPlans(),
        fetchLegacyShops(),
      ]);
      setShops(s);
      setPlans(p);
      setLegacy(l);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not load Subscription Shops");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const shopNames = useMemo(
    () => Object.fromEntries(shops.map((s) => [s.id, s.name] as const)),
    [shops],
  );

  const stats = useMemo(() => {
    const active = shops.filter((s) => s.subscription?.state === "active").length;
    const review = shops.filter((s) => s.is_review).length;
    const expiring = shops.filter((s) => s.subscription?.state === "expiring_soon").length;
    const allocation = shops.reduce(
      (sum, s) => sum + Number(s.subscription?.allocation_total ?? 0),
      0,
    );
    return { active, review, expiring, allocation };
  }, [shops]);

  const runJob = async (dry: boolean) => {
    try {
      const r = await runSubscriptionExpiry(dry);
      toast.success(
        `${dry ? "Dry run" : "Lifecycle run"}: ${r.warned} expiring soon, ${r.expired} expired, ${r.reviews_frozen} review shops frozen`,
      );
      if (!dry) void load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not run the job");
    }
  };

  return (
    <div>
      <PageSection devSlot="shops.subscription-shops"
        title="Subscription Shops"
        description="Plan-based shops with a revolving Coin allocation. Legacy shops keep their own area and are unaffected."
        action={
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => runJob(true)}>
              <PlayCircle className="mr-1 size-4" /> Dry run
            </Button>
            <Button size="sm" variant="outline" onClick={() => runJob(false)}>
              <RefreshCw className="mr-1 size-4" /> Run lifecycle
            </Button>
          </div>
        }
      >
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label="Active" value={String(stats.active)} icon={Store} tone="positive" />
          <StatCard label="Review shops" value={String(stats.review)} icon={CalendarClock} />
          <StatCard label="Expiring soon" value={String(stats.expiring)} tone="negative" />
          <StatCard
            label="Coins allocated"
            value={stats.allocation.toLocaleString()}
            icon={Coins}
            tone="brand"
          />
        </div>
      </PageSection>

      <Tabs defaultValue="new" className="mt-2">
        <TabsList>
          <TabsTrigger value="new">New Generation Shops</TabsTrigger>
          <TabsTrigger value="legacy">Legacy Shops</TabsTrigger>
        </TabsList>
        <TabsContent value="legacy">
          <PageSection devSlot="shops.legacy-shops"
            title="Legacy Shops"
            description="Existing shops on the original WaveWallet architecture. They keep their own rules — no new Legacy Shop can be created."
          >
            {legacy.length === 0 ? (
              <Card className="shadow-[var(--shadow-card)]">
                <CardContent className="px-4 text-sm text-muted-foreground">
                  No Legacy Shops.
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-2">
                {legacy.map((s) => (
                  <Card key={s.id} className="shadow-[var(--shadow-card)]">
                    <CardContent className="flex flex-wrap items-center justify-between gap-2 px-4">
                      <div>
                        <p className="text-sm font-semibold tracking-tight">{s.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {s.plan_name ?? "Legacy plan"} ·{" "}
                          {s.current_period_end
                            ? `Valid until ${shortDate(s.current_period_end)}`
                            : "No expiry recorded"}
                        </p>
                      </div>
                      <StatusBadge tone="muted">Legacy</StatusBadge>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </PageSection>
        </TabsContent>
        <TabsContent value="new">
      <PageSection devSlot="shops.shops" title="Shops">
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : shops.length === 0 ? (
          <Card className="shadow-[var(--shadow-card)]">
            <CardContent className="px-4 text-sm text-muted-foreground">
              No Subscription Shops yet. New shops created from the guide appear here.
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {shops.map((s) => {
              const sub = s.subscription;
              const left = daysUntil(sub?.period_end ?? s.review_ends_at);
              return (
                <Card key={s.id} className="shadow-[var(--shadow-card)]">
                  <CardContent className="px-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="text-sm font-semibold tracking-tight">{s.name}</h3>
                          {s.is_review ? <StatusBadge tone="warning">Review</StatusBadge> : null}
                          <StatusBadge tone={subscriptionStateTone(sub?.state)}>
                            {subscriptionStateLabel(sub?.state)}
                          </StatusBadge>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {s.plan_name ?? "No plan"} · {peso(Number(s.plan_price ?? 0))}/mo ·{" "}
                          {Number(sub?.allocation_total ?? 0).toLocaleString()} Coins allocated
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {sub?.period_end
                            ? `Renews ${shortDate(sub.period_end)}`
                            : s.review_ends_at
                              ? `Review ends ${shortDate(s.review_ends_at)}`
                              : "Not activated"}
                          {left !== null ? ` · ${left} day${left === 1 ? "" : "s"} left` : ""}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button size="sm" onClick={() => setTarget(s)}>
                          Activate / change plan
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => setOverride(s)}>
                          Override / discount
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </PageSection>

      <GoLiveRequestsCard shopNames={shopNames} onChanged={() => void load()} />

        </TabsContent>

      </Tabs>

      <SubscriptionPlansCard onSaved={() => void load()} />

      <OverrideDialog
        shop={override}
        plans={plans}
        onClose={() => setOverride(null)}
        onDone={() => {
          setOverride(null);
          void load();
        }}
      />

      <ActivateDialog
        shop={target}
        plans={plans}
        onClose={() => setTarget(null)}
        onDone={() => {
          setTarget(null);
          void load();
        }}
      />
    </div>
  );
}

function ActivateDialog({
  shop,
  plans,
  onClose,
  onDone,
}: {
  shop: SubscriptionShop | null;
  plans: SubscriptionPlan[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [planId, setPlanId] = useState<string>("");
  const [months, setMonths] = useState("1");
  const [reference, setReference] = useState("");
  const [quote, setQuote] = useState<SubscriptionQuote | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setPlanId("");
    setQuote(null);
    setReference("");
    setMonths("1");
  }, [shop?.id]);

  useEffect(() => {
    if (!shop || !planId) {
      setQuote(null);
      return;
    }
    let cancelled = false;
    void fetchQuote(shop.id, planId)
      .then((q) => {
        if (!cancelled) setQuote(q);
      })
      .catch((e: unknown) => {
        if (!cancelled) toast.error(e instanceof Error ? e.message : "Could not calculate the quote");
      });
    return () => {
      cancelled = true;
    };
  }, [shop, planId]);

  const confirm = async () => {
    if (!shop || !quote) return;
    setBusy(true);
    try {
      await activateSubscription({
        ecosystemId: shop.id,
        planId,
        amountPhp: quote.amount_due,
        reference: reference.trim() || null,
        months: Number(months) || 1,
      });
      toast.success("Subscription updated and allocation applied.");
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not update the subscription");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={Boolean(shop)} onOpenChange={(o) => (!o ? onClose() : undefined)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{shop?.name}</DialogTitle>
          <DialogDescription>
            Record a verified subscription payment. Allocation is granted once on activation, only
            the difference on upgrade, and nothing extra on renewal.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Plan</Label>
            <Select value={planId} onValueChange={setPlanId}>
              <SelectTrigger>
                <SelectValue placeholder="Choose a plan" />
              </SelectTrigger>
              <SelectContent>
                {plans.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name} — {peso(Number(p.monthly_price))}/mo ·{" "}
                    {Number(p.coin_allocation).toLocaleString()} Coins
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="months">Months paid</Label>
              <Input
                id="months"
                type="number"
                min={1}
                max={24}
                value={months}
                onChange={(e) => setMonths(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ref">GCash reference</Label>
              <Input
                id="ref"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder="0000 000 000000"
              />
            </div>
          </div>

          {quote ? (
            <Card className="bg-muted/40 shadow-none">
              <CardContent className="space-y-1 px-4 text-xs">
                <Row label="Current plan" value={quote.current_plan_name ?? "None"} />
                <Row label="Days remaining" value={String(quote.days_remaining)} />
                <Row
                  label="Unused value (price ÷ 30 × days)"
                  value={peso(Number(quote.unused_value))}
                />
                <Row label="New monthly price" value={peso(Number(quote.new_monthly_price))} />
                <Row label="Amount due now" value={peso(Number(quote.amount_due))} strong />
                <Row
                  label="Coins to mint"
                  value={Number(quote.additional_allocation).toLocaleString()}
                  strong
                />
              </CardContent>
            </Card>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={confirm} disabled={busy || !quote}>
            Confirm payment &amp; activate
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function OverrideDialog({
  shop,
  plans,
  onClose,
  onDone,
}: {
  shop: SubscriptionShop | null;
  plans: SubscriptionPlan[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [planId, setPlanId] = useState("");
  const [months, setMonths] = useState("1");
  const [discount, setDiscount] = useState("0");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setPlanId("");
    setMonths("1");
    setDiscount("0");
    setReason("");
  }, [shop?.id]);

  const plan = plans.find((p) => p.id === planId) ?? null;
  const pct = Math.max(0, Math.min(100, Number(discount) || 0));
  const monthCount = Math.max(1, Math.min(24, Number(months) || 1));
  const charged = plan
    ? Math.round(Number(plan.monthly_price) * monthCount * (100 - pct)) / 100
    : 0;

  const confirm = async () => {
    if (!shop || !plan) return;
    setBusy(true);
    try {
      await superadminSetShopPlan({
        ecosystemId: shop.id,
        planId: plan.id,
        months: monthCount,
        discountPercent: pct,
        reason,
      });
      toast.success("Plan applied and recorded in the audit trail.");
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not apply that plan");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={Boolean(shop)} onOpenChange={(o) => (!o ? onClose() : undefined)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Platform override — {shop?.name}</DialogTitle>
          <DialogDescription>
            Put this New Generation Shop on any plan, with a discount or completely free. The plan
            still controls the period, features and Coin allocation. Every override is audited.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Plan</Label>
            <Select value={planId} onValueChange={setPlanId}>
              <SelectTrigger>
                <SelectValue placeholder="Choose a plan" />
              </SelectTrigger>
              <SelectContent>
                {plans.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name} — {peso(Number(p.monthly_price))}/mo ·{" "}
                    {Number(p.coin_allocation).toLocaleString()} Coins
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="ov-months">Months</Label>
              <Input
                id="ov-months"
                type="number"
                min={1}
                max={24}
                value={months}
                onChange={(e) => setMonths(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ov-discount">Discount %</Label>
              <Input
                id="ov-discount"
                type="number"
                min={0}
                max={100}
                value={discount}
                onChange={(e) => setDiscount(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ov-reason">Reason (audited)</Label>
            <Textarea
              id="ov-reason"
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Partner shop — first 3 months free"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Charged: <strong>{peso(charged)}</strong>
            {pct === 100 ? " — free subscription on a full plan" : ""}
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={confirm} disabled={busy || !plan}>
            Apply plan
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className={strong ? "font-semibold" : ""}>{value}</span>
    </div>
  );
}
