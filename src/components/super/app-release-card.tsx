/**
 * Super Admin only — the single place the official Android APK release is
 * configured. Nothing published here changes until the platform owner saves it,
 * so the currently distributed APK is never replaced automatically.
 */
import { useEffect, useState } from "react";
import { Smartphone } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { PageSection } from "@/components/ui-kit";
import {
  fetchAppRelease,
  formatFileSize,
  updateAppRelease,
  type AppReleaseInput,
} from "@/lib/app-release";

const EMPTY: AppReleaseInput = {
  enabled: false,
  downloadUrl: "",
  version: "",
  releaseDate: "",
  sizeBytes: 0,
  minOs: "Android 7.0+",
  sha256: "",
  notes: "",
};

export function AppReleaseCard() {
  const [form, setForm] = useState<AppReleaseInput | null>(null);
  const [downloads, setDownloads] = useState(0);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void fetchAppRelease().then((r) => {
      if (!r) return setForm(EMPTY);
      setDownloads(Number(r.android_download_count ?? 0));
      setForm({
        enabled: r.android_enabled,
        downloadUrl: r.android_download_url,
        version: r.android_version,
        releaseDate: r.android_release_date ?? "",
        sizeBytes: Number(r.android_size_bytes ?? 0),
        minOs: r.android_min_os || "Android 7.0+",
        sha256: r.android_sha256,
        notes: r.android_release_notes,
      });
    });
  }, []);

  if (!form) return null;
  const set = <K extends keyof AppReleaseInput>(key: K, value: AppReleaseInput[K]) =>
    setForm((f) => (f ? { ...f, [key]: value } : f));

  const save = async () => {
    setSaving(true);
    try {
      const row = await updateAppRelease(form);
      setDownloads(Number(row.android_download_count ?? 0));
      toast.success("Official app release saved", {
        description: row.android_enabled
          ? "The public download page now offers this build."
          : "The download page shows the web app only until you publish.",
      });
    } catch (e) {
      toast.error("Could not save the release", { description: (e as Error).message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <PageSection
      title="Official Android app release"
      description="Paste the permanent public link to the signed APK. Only you can change this; the public download page reads it live."
    >
      <Card className="shadow-[var(--shadow-card)]">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <Smartphone className="size-4 text-primary" /> WaveWallet Android
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="apkUrl">APK download URL (https)</Label>
            <Input
              id="apkUrl"
              placeholder="https://github.com/…/releases/download/v1.0.0/app-release.apk"
              value={form.downloadUrl}
              onChange={(e) => set("downloadUrl", e.target.value)}
            />
            <p className="text-[11px] text-muted-foreground">
              Use a permanent hosting location such as a GitHub Release asset. Do not use a
              workflow artifact link — those expire.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="apkVersion">Version</Label>
            <Input
              id="apkVersion"
              placeholder="1.0.0"
              value={form.version}
              onChange={(e) => set("version", e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="apkDate">Release date</Label>
            <Input
              id="apkDate"
              type="date"
              value={form.releaseDate}
              onChange={(e) => set("releaseDate", e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="apkSize">File size (bytes)</Label>
            <Input
              id="apkSize"
              inputMode="numeric"
              value={form.sizeBytes ? String(form.sizeBytes) : ""}
              onChange={(e) => set("sizeBytes", Number(e.target.value.replace(/\D/g, "")) || 0)}
            />
            <p className="text-[11px] text-muted-foreground">
              {formatFileSize(form.sizeBytes) || "Shown on the download page when set."}
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="apkMin">Minimum Android version</Label>
            <Input
              id="apkMin"
              value={form.minOs}
              onChange={(e) => set("minOs", e.target.value)}
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="apkSha">SHA-256 checksum (optional)</Label>
            <Input
              id="apkSha"
              className="font-mono text-xs"
              value={form.sha256}
              onChange={(e) => set("sha256", e.target.value)}
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="apkNotes">What&apos;s new (optional)</Label>
            <Textarea
              id="apkNotes"
              rows={2}
              value={form.notes}
              onChange={(e) => set("notes", e.target.value)}
            />
          </div>
          <div className="flex items-center justify-between gap-4 rounded-lg border px-3 py-2 sm:col-span-2">
            <div>
              <Label htmlFor="apkEnabled" className="text-sm font-medium">
                Publish this download
              </Label>
              <p className="text-xs text-muted-foreground">
                When off, the public page offers only the web app. Downloads so far:{" "}
                {downloads.toLocaleString()}.
              </p>
            </div>
            <Switch
              id="apkEnabled"
              checked={form.enabled}
              onCheckedChange={(v) => set("enabled", v)}
            />
          </div>
          <div className="sm:col-span-2">
            <Button disabled={saving} onClick={() => void save()}>
              {saving ? "Saving…" : "Save app release"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </PageSection>
  );
}
