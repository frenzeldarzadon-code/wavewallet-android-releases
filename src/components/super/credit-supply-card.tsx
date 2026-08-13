/**
 * Platform-owner credit supply console.
 *
 * Three responsibilities, all restricted to the platform owner in the database:
 *   1. configure credit packages (the only priced source of new credits),
 *   2. configure the admin credit allocation rate, admin voucher shop discount,
 *      GCash collection details and release mode,
 *   3. verify admin purchases — approve (releases credits once), reject
 *      (releases nothing) or freeze an approved purchase that is disputed.
 */
import { useCallback, useEffect, useState } from "react";
import { Loader2, Plus, Snowflake, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PageSection } from "@/components/ui-kit";
import { statusTone } from "@/components/credit-purchase-page";
import {
  STATUS_LABEL,
  deleteCreditPackage,
  fetchCreditPackages,
  fetchCreditPurchaseOrders,
  fetchCreditPurchaseSettings,
  formatPhp,
  freezeCreditPurchaseOrder,
  reviewCreditPurchaseOrder,
  saveCreditPackage,
  updateCreditPurchaseSettings,
  type CreditPackage,
  type CreditPurchaseOrder,
  type CreditPurchaseSettings,
  type OrderStatus,
} from "@/lib/credit-purchases";

export function CreditSupplyCard() {
  const [packages, setPackages] = useState<CreditPackage[]>([]);
  const [settings, setSettings] = useState<CreditPurchaseSettings | null>(null);
  const [orders, setOrders] = useState<CreditPurchaseOrder[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [draft, setDraft] = useState({ name: "", credits: "1000", price: "10" });

  const load = useCallback(async () => {
    try {
      const [pkgs, cfg, list] = await Promise.all([
        fetchCreditPackages(),
        fetchCreditPurchaseSettings(),
        fetchCreditPurchaseOrders({ limit: 50 }),
      ]);
      setPackages(pkgs);
      setSettings(cfg);
      setOrders(list);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const set = <K extends keyof CreditPurchaseSettings>(
    key: K,
    value: CreditPurchaseSettings[K],
  ) => setSettings((s) => (s ? { ...s, [key]: value } : s));

  const run = async (key: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(key);
    try {
      await fn();
      toast.success(ok);
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const currency = settings?.currency ?? "PHP";

  return (
    <>
      <PageSection
        title="Credit supply"
        description="Only you can create credits. Each package is a shop allocation: the base rate is its complete value."
      >
        <Card className="shadow-[var(--shadow-card)]">
          <CardHeader>
            <CardTitle className="text-sm">Credit packages</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {packages.map((p) => (
              <div
                key={p.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border p-3"
              >
                <div className="min-w-0 flex-1 space-y-1.5">
                  <p className="truncate text-sm font-medium">{p.name}</p>
                  <div className="flex flex-wrap items-end gap-3">
                    <div className="space-y-1">
                      <Label htmlFor={`credits-${p.id}`} className="text-xs">
                        Credits
                      </Label>
                      <Input
                        id={`credits-${p.id}`}
                        className="h-8 w-28"
                        type="number"
                        min={1}
                        defaultValue={String(Number(p.credits))}
                        onBlur={(e) => {
                          const credits = Number(e.target.value);
                          if (!credits || credits === Number(p.credits)) return;
                          void run(
                            p.id,
                            () =>
                              saveCreditPackage({
                                id: p.id,
                                name: p.name,
                                credits,
                                pricePhp: Number(p.price_php),
                                active: p.active,
                                sortOrder: p.sort_order,
                              }),
                            "Allocation size updated",
                          );
                        }}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor={`price-${p.id}`} className="text-xs">
                        Base rate ({currency})
                      </Label>
                      <Input
                        id={`price-${p.id}`}
                        className="h-8 w-28"
                        type="number"
                        min={0}
                        step="0.01"
                        defaultValue={String(Number(p.price_php))}
                        onBlur={(e) => {
                          const price = Number(e.target.value);
                          if (Number.isNaN(price) || price === Number(p.price_php)) return;
                          void run(
                            p.id,
                            () =>
                              saveCreditPackage({
                                id: p.id,
                                name: p.name,
                                credits: Number(p.credits),
                                pricePhp: price,
                                active: p.active,
                                sortOrder: p.sort_order,
                              }),
                            "Base rate updated",
                          );
                        }}
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {Number(p.credits).toLocaleString()} credits ={" "}
                      {formatPhp(Number(p.price_php), currency)}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={p.active}
                      disabled={busy === p.id}
                      onCheckedChange={(v) =>
                        void run(
                          p.id,
                          () =>
                            saveCreditPackage({
                              id: p.id,
                              name: p.name,
                              credits: Number(p.credits),
                              pricePhp: Number(p.price_php),
                              active: v,
                              sortOrder: p.sort_order,
                            }),
                          v ? "Package activated" : "Package deactivated",
                        )
                      }
                    />
                    <span className="text-xs text-muted-foreground">
                      {p.active ? "On sale" : "Hidden"}
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Remove package"
                    disabled={busy === p.id}
                    onClick={() =>
                      void run(p.id, () => deleteCreditPackage(p.id), "Package removed")
                    }
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </div>
            ))}

            <div className="grid gap-3 rounded-xl border border-dashed border-border p-3 sm:grid-cols-4">
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="pkgName">New package name</Label>
                <Input
                  id="pkgName"
                  value={draft.name}
                  placeholder="Starter — 1,000 credits"
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pkgCredits">Credits</Label>
                <Input
                  id="pkgCredits"
                  type="number"
                  value={draft.credits}
                  onChange={(e) => setDraft({ ...draft, credits: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pkgPrice">Base rate ({currency})</Label>
                <Input
                  id="pkgPrice"
                  type="number"
                  value={draft.price}
                  onChange={(e) => setDraft({ ...draft, price: e.target.value })}
                />
              </div>
              <div className="sm:col-span-4">
                <Button
                  variant="outline"
                  disabled={busy === "new" || !draft.name.trim()}
                  onClick={() =>
                    void run(
                      "new",
                      async () => {
                        await saveCreditPackage({
                          name: draft.name.trim(),
                          credits: Number(draft.credits),
                          pricePhp: Number(draft.price),
                          active: true,
                          sortOrder: packages.length,
                        });
                        setDraft({ name: "", credits: "1000", price: "10" });
                      },
                      "Package added",
                    )
                  }
                >
                  <Plus className="size-4" /> Add package
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </PageSection>

      {settings ? (
        <PageSection
          title="Admin pricing settings"
          description="Two separate settings: what an admin pays for a credit allocation, and the discount an admin gets when buying vouchers from their own uploaded inventory."
        >
          <Card className="shadow-[var(--shadow-card)]">
            <CardContent className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="adminDiscount">
                  Admin Credit Allocation Base Rate — discount (%)
                </Label>
                <Input
                  id="adminDiscount"
                  type="number"
                  min={0}
                  max={100}
                  value={String(settings.admin_credit_discount_percent)}
                  onChange={(e) =>
                    set("admin_credit_discount_percent", Number(e.target.value))
                  }
                />
                <p className="text-xs text-muted-foreground">
                  Base rates live on the packages above (default 1,000 credits = PHP 10.00).
                  100% means an admin pays nothing for their own allocation.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="adminVoucherDiscount">Admin Voucher Shop Discount (%)</Label>
                <Input
                  id="adminVoucherDiscount"
                  type="number"
                  min={0}
                  max={100}
                  value={String(settings.admin_voucher_discount_percent)}
                  onChange={(e) =>
                    set("admin_voucher_discount_percent", Number(e.target.value))
                  }
                />
                <p className="text-xs text-muted-foreground">
                  Applies only to vouchers an admin takes from their own uploaded inventory.
                  At 100% off a PHP 10 voucher costs the admin 0 credits and their shop wallet
                  is untouched. Separate from the allocation rate above.
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="releaseMode">Credit release</Label>
                <Select
                  value={settings.credit_release_mode}
                  onValueChange={(v) => set("credit_release_mode", v)}
                >
                  <SelectTrigger id="releaseMode">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="manual">
                      Manual — you approve every payment (safe default)
                    </SelectItem>
                    <SelectItem value="auto">
                      Auto — reserved for a future verified payment integration
                    </SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  No automatic GCash confirmation is connected, so verification stays manual.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cgName">GCash account name</Label>
                <Input
                  id="cgName"
                  value={settings.credit_gcash_account_name}
                  onChange={(e) => set("credit_gcash_account_name", e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cgNumber">GCash number</Label>
                <Input
                  id="cgNumber"
                  value={settings.credit_gcash_number}
                  onChange={(e) => set("credit_gcash_number", e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Shown to admins on their Shop credits screen. Leave blank to use the
                  platform Collection details account above.
                </p>
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="cgInstructions">Payment instructions</Label>
                <Textarea
                  id="cgInstructions"
                  rows={3}
                  value={settings.credit_payment_instructions}
                  onChange={(e) => set("credit_payment_instructions", e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="adminComm">Default shop commission on member purchases (%)</Label>
                <Input
                  id="adminComm"
                  type="number"
                  min={0}
                  max={100}
                  value={String(settings.default_admin_sale_commission_percent)}
                  onChange={(e) =>
                    set("default_admin_sale_commission_percent", Number(e.target.value))
                  }
                />
              </div>
              <div className="sm:col-span-2">
                <Button
                  disabled={busy === "settings"}
                  onClick={() =>
                    void run(
                      "settings",
                      () => updateCreditPurchaseSettings(settings),
                      "Credit purchase settings saved",
                    )
                  }
                >
                  {busy === "settings" ? <Loader2 className="size-4 animate-spin" /> : null} Save
                  settings
                </Button>
              </div>
            </CardContent>
          </Card>
        </PageSection>
      ) : null}

      <PageSection
        title="Credit purchase verification"
        description="Approving releases the credits exactly once. Rejecting releases nothing. Freezing pulls released credits back."
      >
        <Card className="shadow-[var(--shadow-card)]">
          <CardContent className="space-y-3">
            {orders.length === 0 ? (
              <p className="text-sm text-muted-foreground">No credit purchases submitted yet.</p>
            ) : (
              orders.map((o) => (
                <div key={o.id} className="rounded-xl border border-border p-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-medium">
                        {o.buyer_name} — {Number(o.credits).toLocaleString()} credits
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {o.package_name} ×{o.quantity} ·{" "}
                        {formatPhp(Number(o.amount_due), currency)} · Ref{" "}
                        <span className="font-mono">{o.payment_reference}</span>
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Submitted {new Date(o.created_at).toLocaleString()}
                      </p>
                    </div>
                    <Badge variant={statusTone(o.status)}>
                      {STATUS_LABEL[o.status as OrderStatus] ?? o.status}
                    </Badge>
                  </div>
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
                            "Credits released",
                          )
                        }
                      >
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        disabled={busy === o.id}
                        onClick={() => {
                          const reason = window.prompt("Reason for rejecting this payment?");
                          if (!reason?.trim()) return;
                          void run(
                            o.id,
                            () => reviewCreditPurchaseOrder(o.id, false, reason.trim()),
                            "Purchase rejected",
                          );
                        }}
                      >
                        Reject
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
                          const reason = window.prompt("Why are these credits being frozen?");
                          if (!reason?.trim()) return;
                          void run(
                            o.id,
                            () => freezeCreditPurchaseOrder(o.id, reason.trim()),
                            "Released credits frozen",
                          );
                        }}
                      >
                        <Snowflake className="size-4" /> Freeze released credits
                      </Button>
                    </div>
                  ) : null}
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </PageSection>
    </>
  );
}
