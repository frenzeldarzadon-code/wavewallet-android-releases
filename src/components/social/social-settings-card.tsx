import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { PageSection } from "@/components/ui-kit";
import { supabase } from "@/integrations/supabase/client";

interface SocialSettings {
  /** Retired daily free-credit allowance. Kept at 0; free posts replaced it. */
  daily_allowance: number;
  /** Free ORDINARY POSTS per member per day. Not a credit balance. */
  free_posts_per_day: number;
  post_cost: number;
  comment_cost: number;
  credit_exchange_rate: number;
  points_exchange_rate: number;
  promotion_enabled: boolean;
  promotion_currency: string;
  promotion_cost_social: number;
  promotion_cost_points: number;
  ads_enabled: boolean;
  ad_reward_amount: number;
  ad_daily_limit: number;
}

/**
 * Platform-wide community economics. Only the platform owner can change these;
 * the database re-checks the caller on every save.
 */
export function SocialSettingsCard() {
  const [form, setForm] = useState<SocialSettings | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void supabase
      .from("social_settings")
      .select("*")
      .eq("id", 1)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error) toast.error("Could not load community settings", { description: error.message });
        if (data) setForm(data as unknown as SocialSettings);
      });
  }, []);

  if (!form) return null;

  const set = <K extends keyof SocialSettings>(key: K, value: SocialSettings[K]) =>
    setForm((f) => (f ? { ...f, [key]: value } : f));

  const num = (key: keyof SocialSettings, label: string) => (
    <div className="space-y-1.5">
      <Label htmlFor={String(key)}>{label}</Label>
      <Input
        id={String(key)}
        type="number"
        value={String(form[key])}
        onChange={(e) => set(key, Number(e.target.value) as never)}
      />
    </div>
  );

  const save = async () => {
    setSaving(true);
    const { data, error } = await supabase.rpc("update_social_settings", {
      _daily_allowance: 0,
      _free_posts_per_day: Number(form.free_posts_per_day),
      // Retired: Universe social activity is free; the database ignores these.
      _post_cost: 0,
      _comment_cost: 0,
      _credit_exchange_rate: 0,
      _points_exchange_rate: 0,
      _promotion_enabled: form.promotion_enabled,
      _promotion_currency: form.promotion_currency,
      _promotion_cost_social: 0,
      _promotion_cost_points: 0,
      _ads_enabled: form.ads_enabled,
      _ad_reward_amount: Number(form.ad_reward_amount),
      _ad_daily_limit: Number(form.ad_daily_limit),
    });
    setSaving(false);
    if (error) {
      toast.error("Could not save community settings", { description: error.message });
      return;
    }
    if (data) setForm(data as unknown as SocialSettings);
    toast.success("Community settings saved");
  };

  return (
    <PageSection
      devSlot="social-settings-card.community-social-credits"
      title="Community settings"
      description="Community switches and rewarded-ad limits for every shop. Social activity itself is free."
    >
      <Card className="shadow-[var(--shadow-card)]">
        <CardHeader>
          <CardTitle className="text-sm">Community switches</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-success/40 bg-success/5 px-3 py-2 text-xs text-muted-foreground sm:col-span-2">
            <p className="font-semibold text-foreground">Universe social activity is free</p>
            <p>
              Posting, promoting, replies, likes and messages never deduct coins, social credits or
              points. Post costs, promotion prices and coin/point exchange rates are retired and
              ignored by the database — only the switches below still apply.
            </p>
          </div>

          <div className="flex items-center justify-between gap-3 rounded-xl border border-border px-3 py-2 sm:col-span-2">
            <Label htmlFor="promoEnabled">Allow promoted posts</Label>
            <Switch
              id="promoEnabled"
              checked={form.promotion_enabled}
              onCheckedChange={(v) => set("promotion_enabled", v)}
            />
          </div>

          <div className="flex items-center justify-between gap-3 rounded-xl border border-border px-3 py-2 sm:col-span-2">
            <div>
              <Label htmlFor="adsEnabled">Rewarded ads</Label>
              <p className="text-xs text-muted-foreground">
                Only enable once a verified rewarded-ad provider is connected — credits are granted
                from verified completion events, never from a button click.
              </p>
            </div>
            <Switch
              id="adsEnabled"
              checked={form.ads_enabled}
              onCheckedChange={(v) => set("ads_enabled", v)}
            />
          </div>
          {num("ad_reward_amount", "Social credits per completed ad")}
          {num("ad_daily_limit", "Max ad rewards per member per day")}
        </CardContent>
      </Card>
      <Button disabled={saving} onClick={() => void save()}>
        {saving ? "Saving…" : "Save community settings"}
      </Button>
    </PageSection>
  );
}
