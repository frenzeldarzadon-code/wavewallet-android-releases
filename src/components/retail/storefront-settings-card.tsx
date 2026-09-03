/**
 * Storefront identity for one Retail shop's admin: logo, cover and whether
 * the shop is open for NEW orders. Shop name, description and contact
 * details stay in Shop settings (single source of truth) — this card links
 * there instead of duplicating the form. Presentation only: no prices, fees
 * or wallet logic live here.
 */
import { Link } from "@tanstack/react-router";
import { ExternalLink, Loader2, Store } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { PageSection, StatusBadge } from "@/components/ui-kit";
import { RetailImage } from "@/components/retail/retail-image";
import { useSession } from "@/lib/session";
import {
  DEFAULT_STORE_SETTINGS,
  STOREFRONT_NOTE_MAX,
  fetchStoreSettings,
  saveStorefrontSettings,
  storefrontProblem,
  type StoreSettings,
  type StorefrontSettings,
} from "@/lib/retail";

const pick = (s: StoreSettings): StorefrontSettings => ({
  logoPath: s.logoPath,
  coverPath: s.coverPath,
  acceptingOrders: s.acceptingOrders,
  pausedNote: s.pausedNote,
  theme: s.theme,
});

export function StorefrontSettingsCard({ ecosystemId }: { ecosystemId: string | null }) {
  const { ecosystem } = useSession("admin");
  const [saved, setSaved] = useState<StorefrontSettings>(pick(DEFAULT_STORE_SETTINGS));
  const [form, setForm] = useState<StorefrontSettings>(pick(DEFAULT_STORE_SETTINGS));
  const [publicStorefront, setPublicStorefront] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!ecosystemId) return;
    setLoading(true);
    try {
      const s = await fetchStoreSettings(ecosystemId);
      setSaved(pick(s));
      setForm(pick(s));
      setPublicStorefront(s.publicStorefront);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [ecosystemId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!ecosystemId) return null;

  const dirty = JSON.stringify(form) !== JSON.stringify(saved);
  const problem = storefrontProblem(form);

  const save = async () => {
    if (problem) {
      toast.error(problem);
      return;
    }
    setBusy(true);
    try {
      await saveStorefrontSettings(ecosystemId, form, saved);
      setSaved(form);
      toast.success(
        form.acceptingOrders ? "Storefront saved — open for orders." : "Storefront saved — paused.",
      );
    } catch (e) {
      toast.error("Could not save storefront", { description: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <PageSection
      devSlot="storefront-settings-card"
      title="Storefront"
      description="How customers see your shop. Name, description and contact details are edited in Shop settings."
    >
      <Card className="shadow-[var(--shadow-card)]">
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-muted/40 px-3 py-2">
            <p className="flex items-center gap-2 text-sm">
              <Store className="size-4 text-primary" aria-hidden />
              <span className="font-medium">Editing: {ecosystem?.name ?? "this shop"}</span>
            </p>
            <div className="flex items-center gap-2">
              <StatusBadge tone={saved.acceptingOrders ? "success" : "warning"}>
                {saved.acceptingOrders ? "Open" : "Paused"}
              </StatusBadge>
              {publicStorefront && ecosystem?.slug ? (
                <Button asChild size="sm" variant="ghost">
                  <Link to="/shop/$slug" params={{ slug: ecosystem.slug }}>
                    Preview <ExternalLink className="size-3.5" />
                  </Link>
                </Button>
              ) : null}
            </div>
          </div>

          {loading ? (
            <p className="text-xs text-muted-foreground">Loading storefront…</p>
          ) : (
            <>
              <div className="overflow-hidden rounded-2xl border border-border">
                <div className="relative">
                  <RetailImage path={form.coverPath} alt="Shop cover" className="aspect-[16/7]" />
                </div>
                <div className="flex items-center gap-3 px-3 py-3">
                  <div className="shrink-0">
                    <RetailImage
                      path={form.logoPath}
                      alt="Shop logo"
                      className="size-16 rounded-2xl aspect-square"
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{ecosystem?.name}</p>
                    <p className="line-clamp-2 text-[11px] text-muted-foreground">
                      {ecosystem?.description?.trim() ||
                        "Add a short description in Shop settings."}
                    </p>
                  </div>
                </div>
              </div>
              <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-muted/40 p-3">
                <p className="text-xs text-muted-foreground">Logo and cover are shared across your storefront and Universe discovery.</p>
                <Button asChild size="sm" variant="outline"><Link to="/admin/settings">Manage images</Link></Button>
              </div>

              <div className="space-y-2">
                <Label>Storefront design</Label>
                <div className="grid grid-cols-3 gap-2">
                  {(["clear", "fresh", "warm"] as const).map((theme) => (
                    <Button key={theme} type="button" variant={form.theme === theme ? "default" : "outline"} className="capitalize" onClick={() => setForm({ ...form, theme })}>{theme}</Button>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-between gap-3 rounded-xl border border-border px-3 py-2.5">
                <div className="min-w-0">
                  <Label htmlFor="storefront-open" className="text-sm">
                    Accepting new orders
                  </Label>
                  <p className="text-[11px] text-muted-foreground">
                    Turn off to pause. Customers can still browse; orders already placed continue as
                    normal.
                  </p>
                </div>
                <Switch
                  id="storefront-open"
                  checked={form.acceptingOrders}
                  onCheckedChange={(v) => setForm({ ...form, acceptingOrders: v })}
                />
              </div>
              {!form.acceptingOrders ? (
                <div className="space-y-1">
                  <Label htmlFor="storefront-note" className="text-sm">
                    Note shown to customers while paused (optional)
                  </Label>
                  <Textarea
                    id="storefront-note"
                    rows={2}
                    maxLength={STOREFRONT_NOTE_MAX}
                    placeholder="e.g. Closed for restocking — back on Monday."
                    value={form.pausedNote ?? ""}
                    onChange={(e) => setForm({ ...form, pausedNote: e.target.value })}
                  />
                  <p className="text-right text-[11px] text-muted-foreground">
                    {(form.pausedNote ?? "").length}/{STOREFRONT_NOTE_MAX}
                  </p>
                </div>
              ) : null}
              {problem ? <p className="text-xs text-destructive">{problem}</p> : null}

              <div className="flex flex-col gap-2 sm:flex-row">
                <Button
                  className="flex-1"
                  onClick={() => void save()}
                  disabled={busy || !dirty || !!problem}
                >
                  {busy ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Store className="size-4" />
                  )}
                  Save storefront
                </Button>
                <Button asChild variant="outline">
                  <Link to="/admin/settings">Edit name & contact</Link>
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </PageSection>
  );
}
