import { Loader2, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
  disablePromotionTier,
  fetchPromotionTiers,
  savePromotionTier,
  tierDuration,
  type PromotionTier,
} from "@/lib/social";

type Draft = Omit<PromotionTier, "id" | "is_default"> & { id: string | null };

const blank = (order: number): Draft => ({
  id: null,
  name: "",
  description: "",
  price_social: 20,
  price_points: 20,
  currency: "both",
  duration_hours: 24,
  priority: 1,
  eligibility: "all",
  active: true,
  sort_order: order,
});

/**
 * Configurable promotion levels. `ecosystemId` null edits the platform defaults
 * (platform owner only); a shop id edits that shop's own tiers. The database
 * re-checks who the caller is on every save.
 */
export function PromotionTiersCard({
  ecosystemId,
  title = "Promotion types",
  description = "Price, duration, feed priority and eligibility for each paid promotion level.",
}: {
  ecosystemId: string | null;
  title?: string;
  description?: string;
}) {
  const [tiers, setTiers] = useState<PromotionTier[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      setTiers(await fetchPromotionTiers(ecosystemId));
    } catch (e) {
      toast.error("Could not load promotion types", { description: (e as Error).message });
    }
  }, [ecosystemId]);

  useEffect(() => {
    void load();
  }, [load]);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((d) => (d ? { ...d, [key]: value } : d));

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      await savePromotionTier({
        ...draft,
        id: draft.id,
        ecosystemId: ecosystemId ?? null,
      });
      toast.success("Promotion type saved");
      setDraft(null);
      await load();
    } catch (e) {
      toast.error("Could not save", { description: (e as Error).message });
    } finally {
      setSaving(false);
    }
  };

  const disable = async (tier: PromotionTier) => {
    try {
      await disablePromotionTier(tier.id);
      toast.success(`${tier.name} disabled`);
      await load();
    } catch (e) {
      toast.error("Could not disable", { description: (e as Error).message });
    }
  };

  const num = (key: keyof Draft, label: string) => (
    <div className="space-y-1.5">
      <Label htmlFor={`tier-${String(key)}`}>{label}</Label>
      <Input
        id={`tier-${String(key)}`}
        type="number"
        value={String(draft?.[key] ?? 0)}
        onChange={(e) => set(key, Number(e.target.value) as never)}
      />
    </div>
  );

  return (
    <PageSection devSlot="promotion-tiers-card.promotion-tiers" title={title} description={description}>
      <div className="space-y-2">
        {tiers.map((t) => (
          <Card key={t.id} className="shadow-[var(--shadow-card)]">
            <CardContent className="flex flex-wrap items-center gap-2 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold">{t.name}</span>
                  {!t.active ? <Badge variant="secondary">Disabled</Badge> : null}
                  {t.is_default ? <Badge variant="outline">Platform default</Badge> : null}
                  {t.eligibility === "reseller" ? <Badge variant="outline">Resellers</Badge> : null}
                </div>
                <p className="text-xs text-muted-foreground">
                  Free · {tierDuration(t.duration_hours)} · priority {t.priority}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="h-9"
                onClick={() => setDraft({ ...t, id: t.is_default && ecosystemId ? null : t.id })}
              >
                {t.is_default && ecosystemId ? "Customise" : "Edit"}
              </Button>
              {t.active && !(t.is_default && ecosystemId) ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-9 text-destructive"
                  onClick={() => void disable(t)}
                >
                  <Trash2 className="size-4" />
                </Button>
              ) : null}
            </CardContent>
          </Card>
        ))}
      </div>

      {draft ? (
        <Card className="shadow-[var(--shadow-card)]">
          <CardContent className="grid gap-3 py-4 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="tierName">Name</Label>
              <Input
                id="tierName"
                value={draft.name}
                onChange={(e) => set("name", e.target.value)}
                placeholder="Featured"
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="tierDesc">Description shown to members</Label>
              <Input
                id="tierDesc"
                value={draft.description}
                onChange={(e) => set("description", e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tierElig">Who can use it</Label>
              <Select
                value={draft.eligibility}
                onValueChange={(v) => set("eligibility", v as Draft["eligibility"])}
              >
                <SelectTrigger id="tierElig">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All members</SelectItem>
                  <SelectItem value="reseller">Resellers and above</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {num("duration_hours", "Duration (hours)")}
            {num("priority", "Feed priority (0–100)")}
            {num("sort_order", "Display order")}
            <div className="flex items-center justify-between gap-3 rounded-xl border border-border px-3 py-2">
              <Label htmlFor="tierActive">Available</Label>
              <Switch
                id="tierActive"
                checked={draft.active}
                onCheckedChange={(v) => set("active", v)}
              />
            </div>
            <div className="flex gap-2 sm:col-span-2">
              <Button disabled={saving} onClick={() => void save()}>
                {saving ? <Loader2 className="size-4 animate-spin" /> : null} Save promotion type
              </Button>
              <Button variant="ghost" onClick={() => setDraft(null)}>
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Button variant="outline" onClick={() => setDraft(blank(tiers.length + 1))}>
          <Plus className="size-4" /> Add promotion type
        </Button>
      )}
    </PageSection>
  );
}
