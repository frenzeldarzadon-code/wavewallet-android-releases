import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { fetchUniverseLoanSettings, saveUniverseLoanSettings, type UniverseLoanSettings } from "@/lib/universe-loans";

export function UniverseLoanSettingsCard() {
  const [form, setForm] = useState<UniverseLoanSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => fetchUniverseLoanSettings().then(setForm).catch((error) => toast.error("Could not load Universe Loan settings", { description: (error as Error).message })), []);
  useEffect(() => { void load(); }, [load]);
  if (!form) return null;

  const set = <K extends keyof UniverseLoanSettings>(key: K, value: UniverseLoanSettings[K]) => setForm((current) => current ? { ...current, [key]: value } : current);
  const save = async () => {
    if (form.interestPercent < 0 || form.interestPercent > 20) {
      toast.error("Monthly interest must be between 0% and 20%.");
      return;
    }
    if (form.platformFeePercent < 0 || form.platformFeePercent > 50) {
      toast.error("Platform fee must be between 0% and 50%.");
      return;
    }
    if (Math.round((form.ownerSharePercent + form.contributorSharePercent) * 100) / 100 !== 100) {
      toast.error("Owner and contributor shares must total 100%.");
      return;
    }
    setBusy(true);
    try { await saveUniverseLoanSettings(form); toast.success("Universe Loan settings saved. Active loans keep their snapshots."); await load(); }
    catch (error) { toast.error((error as Error).message); }
    finally { setBusy(false); }
  };

  return <Card className="mb-6 shadow-[var(--shadow-card)]"><CardHeader><CardTitle className="text-sm">Universe Loan Pool settings</CardTitle></CardHeader><CardContent className="space-y-4">
    <div className="flex items-center justify-between rounded-lg border px-3 py-2"><div><p className="text-sm font-medium">Universe Loans available</p><p className="text-xs text-muted-foreground">Members apply with an ID; contributors fund the loan.</p></div><Switch checked={form.enabled} onCheckedChange={(value) => set("enabled", value)} /></div>
    <div className="grid gap-3 sm:grid-cols-2">
      <Field id="universe-interest" label="Monthly interest (%)" value={form.interestPercent} onChange={(value) => set("interestPercent", value)} />
      <Field id="universe-fee" label="Platform fee (%)" value={form.platformFeePercent} onChange={(value) => set("platformFeePercent", value)} />
      <Field id="universe-owner-share" label="Platform owner interest share (%)" value={form.ownerSharePercent} onChange={(value) => set("ownerSharePercent", value)} />
      <Field id="universe-contributor-share" label="Contributors' interest share (%)" value={form.contributorSharePercent} onChange={(value) => set("contributorSharePercent", value)} />
    </div>
    <p className="text-xs text-muted-foreground">Terms are 3, 6 and 12 months. Interest uses a reducing balance; early principal payments automatically reduce future interest.</p>
    <Button disabled={busy} onClick={() => void save()}>Save Universe Loan settings</Button>
  </CardContent></Card>;
}

function Field({ id, label, value, onChange }: { id: string; label: string; value: number; onChange: (value: number) => void }) {
  return <div className="space-y-1.5"><Label htmlFor={id}>{label}</Label><Input id={id} inputMode="decimal" value={value} onChange={(event) => onChange(Number(event.target.value))} /></div>;
}