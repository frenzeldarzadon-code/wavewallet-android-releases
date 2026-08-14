import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { PageSection } from "@/components/ui-kit";
import {
  fetchEcosystemSocialOverride,
  fetchSocialState,
  saveEcosystemSocialSettings,
  type EcosystemSocialSettings,
  type SocialState,
} from "@/lib/social";

type Field = keyof Omit<EcosystemSocialSettings, "social_enabled" | "promotion_enabled">;

const FIELDS: { key: Field; label: string; hint: string }[] = [
  { key: "daily_allowance", label: "Free social credits per day", hint: "Given once per day" },
  { key: "post_cost", label: "Cost to post", hint: "Social credits per post" },
  {
    key: "credit_exchange_rate",
    label: "Credits per social credit",
    hint: "Wallet credits charged for 1 social credit",
  },
  {
    key: "points_exchange_rate",
    label: "Points per social credit",
    hint: "Points charged for 1 social credit",
  },
];

/**
 * Per-shop community settings. Blank fields inherit the platform default, so an
 * admin only overrides what they care about.
 */
export function EcosystemSocialCard({ ecosystemId }: { ecosystemId: string }) {
  const [effective, setEffective] = useState<SocialState | null>(null);
  const [draft, setDraft] = useState<EcosystemSocialSettings | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const [state, override] = await Promise.all([
        fetchSocialState(),
        fetchEcosystemSocialOverride(ecosystemId),
      ]);
      setEffective(state);
      setDraft(
        override ?? {
          social_enabled: state.social_enabled,
          daily_allowance: null,
          post_cost: null,
          comment_cost: null,
          credit_exchange_rate: null,
          points_exchange_rate: null,
          promotion_enabled: null,
        },
      );
    } catch (e) {
      toast.error("Could not load community settings", { description: (e as Error).message });
    }
  }, [ecosystemId]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      await saveEcosystemSocialSettings({ ...draft, ecosystemId });
      toast.success("Community settings saved");
      await load();
    } catch (e) {
      toast.error("Could not save", { description: (e as Error).message });
    } finally {
      setSaving(false);
    }
  };

  if (!draft) return null;

  const platform = (key: Field) => (effective ? String(effective[key as keyof SocialState]) : "—");

  return (
    <PageSection
      title="Community settings"
      description="These apply to your shop only. Leave a field empty to follow the platform default."
    >
      <Card className="shadow-[var(--shadow-card)]">
        <CardContent className="grid gap-3 py-4 sm:grid-cols-2">
          <div className="flex items-center justify-between gap-3 rounded-xl border border-border px-3 py-2 sm:col-span-2">
            <div>
              <Label htmlFor="ecoSocialOn">Community enabled for my shop</Label>
              <p className="text-xs text-muted-foreground">
                Turning this off hides the Community tab for your members.
              </p>
            </div>
            <Switch
              id="ecoSocialOn"
              checked={draft.social_enabled}
              onCheckedChange={(v) => setDraft({ ...draft, social_enabled: v })}
            />
          </div>

          {FIELDS.map((f) => (
            <div key={f.key} className="space-y-1.5">
              <Label htmlFor={`eco-${f.key}`}>{f.label}</Label>
              <Input
                id={`eco-${f.key}`}
                type="number"
                min={0}
                value={draft[f.key] === null ? "" : String(draft[f.key])}
                placeholder={`Platform default: ${platform(f.key)}`}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    [f.key]: e.target.value === "" ? null : Number(e.target.value),
                  })
                }
              />
              <p className="text-xs text-muted-foreground">{f.hint}</p>
            </div>
          ))}

          <div className="flex items-center justify-between gap-3 rounded-xl border border-border px-3 py-2 sm:col-span-2">
            <div>
              <Label htmlFor="ecoPromoOn">Paid promotions available</Label>
              <p className="text-xs text-muted-foreground">
                Members can pay to highlight a post. Promoted posts are always labelled.
              </p>
            </div>
            <Switch
              id="ecoPromoOn"
              checked={draft.promotion_enabled ?? effective?.promotion_enabled ?? true}
              onCheckedChange={(v) => setDraft({ ...draft, promotion_enabled: v })}
            />
          </div>

          <div className="sm:col-span-2">
            <Button disabled={saving} onClick={() => void save()}>
              {saving ? <Loader2 className="size-4 animate-spin" /> : null} Save community settings
            </Button>
          </div>
        </CardContent>
      </Card>
    </PageSection>
  );
}
