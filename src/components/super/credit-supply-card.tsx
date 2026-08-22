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
import { Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PageSection } from "@/components/ui-kit";
import {
  deleteCreditPackage,
  fetchCreditPackages,
  fetchCreditPurchaseSettings,
  formatPhp,
  saveCreditPackage,
  updateCreditPurchaseSettings,
  type CreditPackage,
  type CreditPurchaseSettings,
} from "@/lib/credit-purchases";

export function CreditSupplyCard() {
  const [packages, setPackages] = useState<CreditPackage[]>([]);
  const [settings, setSettings] = useState<CreditPurchaseSettings | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [draft, setDraft] = useState({ name: "", credits: "1000", price: "10" });

  const load = useCallback(async () => {
    try {
      const [pkgs, cfg] = await Promise.all([
        fetchCreditPackages(),
        fetchCreditPurchaseSettings(),
      ]);
      setPackages(pkgs);
      setSettings(cfg);
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
      <PageSection devSlot="credit-supply-card.coin-supply"
        title="Coin supply"
        description="Only you can create coins. Each package is a shop allocation: the base rate is its complete value."
      >
        <Card className="shadow-[var(--shadow-card)]">
          <CardHeader>
            <CardTitle className="text-sm">Coin packages</CardTitle>
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
                        Coins
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
                  placeholder="Starter — 1,000 coins"
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pkgCredits">Coins</Label>
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
        <PageSection devSlot="credit-supply-card.admin-pricing-settings"
          title="Admin pricing settings"
          description="Two separate settings: what an admin pays for a coin allocation, and the discount an admin gets when buying vouchers from their own uploaded inventory."
        >
          <Card className="shadow-[var(--shadow-card)]">
            <CardContent className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="adminDiscount">
                  Admin Coin Allocation Base Rate — discount (%)
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
                  Base rates live on the packages above (default 1,000 coins = PHP 10.00).
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
                  At 100% off a PHP 10 voucher costs the admin 0 coins and their shop wallet
                  is untouched. Separate from the allocation rate above.
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="releaseMode">Coin release</Label>
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
              <div className="sm:col-span-2">
                <Button
                  disabled={busy === "settings"}
                  onClick={() =>
                    void run(
                      "settings",
                      () => updateCreditPurchaseSettings(settings),
                      "Coin purchase settings saved",
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

    </>

  );
}
