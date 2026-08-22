/**
 * Subscription Shop plans / rates — the one admin-managed source of truth.
 *
 * Rows come from `public.subscription_plans`; the same rows drive the public
 * guide, the activation dialog and the proration quote. Nothing is duplicated
 * or hard-coded here, and RLS restricts writes to the platform owner.
 */
import { useCallback, useEffect, useState } from "react";
import { Pencil, Tags } from "lucide-react";
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
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { PageSection, StatusBadge } from "@/components/ui-kit";
import { useOnline } from "@/lib/pwa";
import { peso } from "@/lib/wavewallet";
import { fetchAllPlans, updatePlan, type SubscriptionPlan } from "@/lib/subscription-shops";

export function SubscriptionPlansCard({ onSaved }: { onSaved?: () => void }) {
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<SubscriptionPlan | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setPlans(await fetchAllPlans());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not load subscription plans");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <PageSection devSlot="subscription-plans-card.subscription-plans-rates"
      title="Subscription plans & rates"
      description="Subscription Shops only. These monthly rates and Coin allocations are used by the public guide, activation, renewal and upgrade proration. Legacy Shops are not affected."
    >
      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : plans.length === 0 ? (
        <Card className="shadow-[var(--shadow-card)]">
          <CardContent className="px-4 text-sm text-muted-foreground">
            No subscription plans defined yet.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {plans.map((p) => (
            <Card key={p.id} className="shadow-[var(--shadow-card)]">
              <CardContent className="px-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Tags className="size-4 text-muted-foreground" />
                      <h3 className="text-sm font-semibold tracking-tight">{p.name}</h3>
                      <StatusBadge tone={p.active ? "success" : "muted"}>
                        {p.active ? "Active" : "Hidden"}
                      </StatusBadge>
                      {p.recommended ? <StatusBadge tone="brand">Recommended</StatusBadge> : null}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {peso(Number(p.monthly_price))}/month ·{" "}
                      {Number(p.coin_allocation).toLocaleString()} Coins one-time allocation
                    </p>
                    {p.tagline ? (
                      <p className="text-xs text-muted-foreground">{p.tagline}</p>
                    ) : null}
                  </div>
                  <Button size="sm" variant="outline" onClick={() => setEditing(p)}>
                    <Pencil className="mr-1 size-4" /> Edit rate
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <EditPlanDialog
        plan={editing}
        onClose={() => setEditing(null)}
        onDone={() => {
          setEditing(null);
          void load();
          onSaved?.();
        }}
      />
    </PageSection>
  );
}

function EditPlanDialog({
  plan,
  onClose,
  onDone,
}: {
  plan: SubscriptionPlan | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const online = useOnline();
  const [name, setName] = useState("");
  const [tagline, setTagline] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("0");
  const [allocation, setAllocation] = useState("0");
  const [order, setOrder] = useState("0");
  const [active, setActive] = useState(true);
  const [recommended, setRecommended] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!plan) return;
    setName(plan.name);
    setTagline(plan.tagline ?? "");
    setDescription(plan.description ?? "");
    setPrice(String(Number(plan.monthly_price)));
    setAllocation(String(Number(plan.coin_allocation)));
    setOrder(String(Number(plan.display_order)));
    setActive(plan.active);
    setRecommended(plan.recommended);
  }, [plan]);

  const save = async () => {
    if (!plan) return;
    const monthly = Number(price);
    const coins = Number(allocation);
    if (!name.trim()) {
      toast.error("Give the plan a name.");
      return;
    }
    if (!Number.isFinite(monthly) || monthly < 0) {
      toast.error("Enter a valid monthly rate.");
      return;
    }
    if (!Number.isFinite(coins) || coins < 0) {
      toast.error("Enter a valid Coin allocation.");
      return;
    }
    setBusy(true);
    try {
      await updatePlan(plan.id, {
        name: name.trim(),
        tagline: tagline.trim() || null,
        description: description.trim(),
        monthly_price: monthly,
        coin_allocation: Math.round(coins),
        display_order: Number(order) || 0,
        active,
        recommended,
      });
      toast.success("Plan updated. New shops and quotes use this rate immediately.");
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not update the plan");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={Boolean(plan)} onOpenChange={(o) => (!o ? onClose() : undefined)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Subscription Shop plan</DialogTitle>
          <DialogDescription>
            Changing the rate affects future activations, renewals and upgrade quotes only. Shops
            already paid keep the price and allocation recorded at the time of payment.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="plan-name">Plan name</Label>
            <Input id="plan-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="plan-price">Monthly rate (₱)</Label>
              <Input
                id="plan-price"
                type="number"
                min={0}
                step="1"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="plan-coins">Coin allocation</Label>
              <Input
                id="plan-coins"
                type="number"
                min={0}
                step="1"
                value={allocation}
                onChange={(e) => setAllocation(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="plan-tagline">Tagline</Label>
            <Input id="plan-tagline" value={tagline} onChange={(e) => setTagline(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="plan-desc">Description</Label>
            <Textarea
              id="plan-desc"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="plan-order">Display order</Label>
              <Input
                id="plan-order"
                type="number"
                value={order}
                onChange={(e) => setOrder(e.target.value)}
              />
            </div>
            <div className="space-y-3 pt-6">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="plan-active" className="text-xs">
                  Shown publicly
                </Label>
                <Switch id="plan-active" checked={active} onCheckedChange={setActive} />
              </div>
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="plan-rec" className="text-xs">
                  Recommended
                </Label>
                <Switch id="plan-rec" checked={recommended} onCheckedChange={setRecommended} />
              </div>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={busy || !online}>
            {online ? "Save plan" : "Internet connection required"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
