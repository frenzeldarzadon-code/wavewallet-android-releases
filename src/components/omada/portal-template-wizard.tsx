/**
 * "Import Customized Page" builder for ONE shop.
 *
 * Admins never upload a template. WaveWallet derives the page from the
 * canonical Omada master the platform owner published, so the admin only has to
 * pick the exact portal, choose which WaveWallet features to expose, preview
 * the page and download it.
 *
 * The controller is never written to: Omada 6.2.14.11 publishes no supported
 * route for importing a customized page, so the builder says so plainly instead
 * of faking automation.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, Download, Loader2, RefreshCw, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState, StatusBadge } from "@/components/ui-kit";
import { listPortalMappings, type PortalMappingView } from "@/lib/omada-portals.functions";
import {
  generatePortalTemplate,
  getPortalTemplate,
  listPortalThemes,
  savePortalTemplateFeatures,
  savePortalTemplateTheme,
  type PortalTemplateView,
} from "@/lib/portal-template.functions";
import {
  DEFAULT_PORTAL_THEME_SLUG,
  PORTAL_THEMES,
  type PortalTheme,
} from "@/lib/portal-themes";
import { PortalThemeGallery } from "./portal-theme-gallery";
import { downloadTextFile } from "@/lib/download-file";
import {
  TEMPLATE_FEATURE_LABELS,
  templateStage,
  type PortalTemplateFeatures,
} from "@/lib/portal-template";

const STEPS: Array<{ key: string; label: string }> = [
  { key: "portal", label: "Portal selected" },
  { key: "design", label: "Design chosen" },
  { key: "features", label: "Features chosen" },
  { key: "generate", label: "Portal page ready" },
  { key: "import", label: "Imported into Omada" },
];

interface GeneratedState {
  fileName: string;
  html: string;
  bytes: number;
  checksum: string;
  masterVersion: number;
  masterChecksum: string;
  themeName: string;
  summary: string[];
  warnings: string[];
  steps: string[];
}

function readableSize(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
}

export function PortalTemplateWizard({ ecosystemId }: { ecosystemId: string | null }) {
  const [mappings, setMappings] = useState<PortalMappingView[]>([]);
  // No default portal: the admin must choose the exact one.
  const [mappingId, setMappingId] = useState("");
  const [template, setTemplate] = useState<PortalTemplateView | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [generated, setGenerated] = useState<GeneratedState | null>(null);
  /** Direct link shown only when the browser blocked the programmatic download. */
  const [fallback, setFallback] = useState<{ url: string; fileName: string } | null>(null);
  const [themes, setThemes] = useState<PortalTheme[]>(PORTAL_THEMES);
  const [themeBusy, setThemeBusy] = useState(false);

  useEffect(() => {
    // The gallery is database-backed; the built-in list is only a fallback.
    void listPortalThemes()
      .then((rows) => {
        if (rows.length) setThemes(rows);
      })
      .catch(() => setThemes(PORTAL_THEMES));
  }, []);

  useEffect(() => {
    if (!ecosystemId) return;
    setLoading(true);
    void listPortalMappings({ data: { ecosystemId } })
      .then(setMappings)
      .catch((e: Error) => toast.error("Could not load your portals", { description: e.message }))
      .finally(() => setLoading(false));
  }, [ecosystemId]);

  const loadTemplate = useCallback(async () => {
    if (!ecosystemId || !mappingId) {
      setTemplate(null);
      return;
    }
    try {
      setTemplate(await getPortalTemplate({ data: { ecosystemId, mappingId } }));
      setGenerated(null);
    } catch (e) {
      toast.error("Could not load this portal's setup", { description: (e as Error).message });
    }
  }, [ecosystemId, mappingId]);

  useEffect(() => {
    void loadTemplate();
  }, [loadTemplate]);

  const mapping = mappings.find((m) => m.id === mappingId) ?? null;
  const features = template?.features ?? null;

  const progress = useMemo(
    () => ({
      controllerConnected: mappings.length > 0,
      portalSelected: Boolean(mappingId),
      featuresChosen: Boolean(features),
      generated: Boolean(template?.hasGenerated),
      importedVerified: template?.importStatus === "imported",
    }),
    [mappings.length, mappingId, template, features],
  );
  const stage = templateStage(progress);

  if (!ecosystemId) return null;

  const toggleFeature = async (key: keyof PortalTemplateFeatures, value: boolean) => {
    if (!features || !ecosystemId || !mappingId) return;
    const next = { ...features, [key]: value } as PortalTemplateFeatures;
    setTemplate((t) => (t ? { ...t, features: next } : t));
    setGenerated(null);
    try {
      setTemplate(await savePortalTemplateFeatures({ data: { ecosystemId, mappingId, features: next } }));
    } catch (e) {
      toast.error("Could not save that choice", { description: (e as Error).message });
      void loadTemplate();
    }
  };

  const chooseTheme = async (themeSlug: string) => {
    if (!ecosystemId || !mappingId || themeSlug === template?.themeSlug) return;
    setThemeBusy(true);
    setTemplate((t) => (t ? { ...t, themeSlug } : t));
    setGenerated(null);
    try {
      setTemplate(await savePortalTemplateTheme({ data: { ecosystemId, mappingId, themeSlug } }));
      toast.success("Design saved. Generate the page to apply it.");
    } catch (e) {
      toast.error("Could not save that design", { description: (e as Error).message });
      void loadTemplate();
    } finally {
      setThemeBusy(false);
    }
  };

  const generate = async () => {
    if (!ecosystemId || !mappingId) return;
    setBusy("generate");
    setFallback(null);
    try {
      const file = await generatePortalTemplate({
        data: { ecosystemId, mappingId, origin: window.location.origin },
      });
      setGenerated({
        fileName: file.fileName,
        html: file.html,
        bytes: file.bytes,
        checksum: file.checksum,
        masterVersion: file.masterVersion,
        masterChecksum: file.masterChecksum,
        themeName: file.themeName,
        summary: file.summary,
        warnings: file.warnings,
        steps: file.manualSteps,
      });
      await loadTemplate();
      toast.success("Your portal page is ready to download.");
    } catch (e) {
      toast.error("Could not generate the portal page", { description: (e as Error).message });
    } finally {
      setBusy("");
    }
  };

  /** Downloads the exact generated bytes. Never regenerates or alters them. */
  const download = () => {
    if (!generated) return;
    setFallback(null);
    const res = downloadTextFile(generated.html, generated.fileName);
    if (res.ok) {
      toast.success(`Downloading ${res.fileName}`);
      return;
    }
    setFallback(res.url ? { url: res.url, fileName: res.fileName } : null);
    toast.error("Your browser blocked the download", {
      description: res.error ?? "Use the direct link below to save the page.",
    });
  };


  return (
    <Card className="shadow-[var(--shadow-card)]">
      <CardHeader>
        <CardTitle className="text-sm">Customized portal page</CardTitle>
        <CardDescription>
          For controllers that use Omada&apos;s <strong>Import Customized Page</strong>. WaveWallet
          builds the page from the original Omada template published by the platform owner — there
          is nothing for you to upload here. Nothing on your controller is changed by this page.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Progress: every step is real state, never an assumption. */}
        <ol className="flex flex-wrap gap-1.5">
          {STEPS.map((s) => {
            const done =
              (s.key === "portal" && progress.portalSelected) ||
              (s.key === "features" && progress.featuresChosen) ||
                      (s.key === "design" && Boolean(template)) ||
              (s.key === "generate" && progress.generated) ||
              (s.key === "import" && progress.importedVerified);
            return (
              <li key={s.key}>
                <StatusBadge tone={done ? "success" : "muted"}>{s.label}</StatusBadge>
              </li>
            );
          })}
        </ol>

        {loading ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading your portals…
          </p>
        ) : mappings.length === 0 ? (
          <EmptyState
            title="Connect a portal first"
            description="Add the Omada site and portal above, then come back to build its customized page."
          />
        ) : (
          <>
            <div className="space-y-1.5">
              <Label>Portal</Label>
              <Select value={mappingId} onValueChange={setMappingId}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose the exact portal" />
                </SelectTrigger>
                <SelectContent>
                  {mappings.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.portalName ?? m.portalId} — {m.siteName ?? m.siteId}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">
                {mapping
                  ? "This page will be bound to this portal only."
                  : "Choose a portal to continue. Nothing is generated until you pick one."}
              </p>
            </div>

            {/* The canonical master this page is derived from. */}
            {template && template.masterVersion === null ? (
              <div className="rounded-xl border border-warning/40 bg-warning/5 p-3">
                <p className="flex items-center gap-2 text-sm font-medium">
                  <AlertTriangle className="h-4 w-4 text-warning" /> No Omada template published yet
                </p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  The platform owner has not published the original Omada portal template yet, so no
                  page can be generated. Everything else here is already saved.
                </p>
              </div>
            ) : template ? (
              <div className="space-y-2 rounded-xl border p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium">Omada mechanics kept</p>
                  <StatusBadge tone="success">Master v{template.masterVersion}</StatusBadge>
                </div>
                <p className="text-[11px] text-muted-foreground break-words">
                  Derived from the original Omada template{" "}
                  {template.masterFileName ? <strong>{template.masterFileName}</strong> : null} ·{" "}
                  {template.masterChecksum}
                </p>
                <ul className="space-y-1 text-xs text-muted-foreground">
                  {(template.masterAnalysis?.preserved ?? []).map((line) => (
                    <li key={line} className="flex gap-2">
                      <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
                      <span className="break-words">{line}</span>
                    </li>
                  ))}
                  {template.masterWarnings.map((w) => (
                    <li key={w} className="flex gap-2 text-warning">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span className="break-words">{w}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {/* Design gallery — presentation only. */}
            {template ? (
              <PortalThemeGallery
                themes={themes}
                value={template.themeSlug ?? DEFAULT_PORTAL_THEME_SLUG}
                shopName={mapping?.portalName ?? "Your shop"}
                busy={themeBusy}
                onSelect={(slug) => void chooseTheme(slug)}
              />
            ) : null}

            {/* Features */}
            {features ? (
              <div className="space-y-2 rounded-xl border p-3">
                <p className="text-sm font-medium">Features on this portal</p>
                {TEMPLATE_FEATURE_LABELS.map((f) => (
                  <div key={f.key} className="flex items-start justify-between gap-3 py-1">
                    <div className="min-w-0">
                      <p className="text-sm">{f.label}</p>
                      <p className="text-[11px] text-muted-foreground">{f.hint}</p>
                    </div>
                    <Switch
                      checked={Boolean(features[f.key])}
                      disabled={f.locked}
                      onCheckedChange={(v) => void toggleFeature(f.key, v)}
                    />
                  </div>
                ))}
              </div>
            ) : null}

            {/* Generate + preview */}
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <Button size="sm" disabled={busy !== "" || !mappingId} onClick={() => void generate()}>
                  {busy === "generate" ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="mr-2 h-4 w-4" />
                  )}
                  Generate portal page
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!generated || busy === "generate"}
                  onClick={download}
                >
                  <Download className="mr-2 h-4 w-4" />
                  {generated
                    ? `Download (${readableSize(generated.bytes)})`
                    : "Download (generate first)"}
                </Button>
              </div>

              {fallback ? (
                <p className="rounded-xl border border-warning/40 bg-warning/5 p-3 text-xs">
                  Your browser blocked the automatic download.{" "}
                  <a
                    className="font-medium underline"
                    href={fallback.url}
                    download={fallback.fileName}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Tap here to save {fallback.fileName}
                  </a>
                  .
                </p>
              ) : null}

              {generated ? (
                <div className="space-y-3">
                  <div className="rounded-xl border p-3">
                    <p className="flex items-center gap-2 text-sm font-medium">
                      <ShieldCheck className="h-4 w-4 text-success" /> {generated.fileName} ·{" "}
                      {readableSize(generated.bytes)} · checksum {generated.checksum} · master v
                      {generated.masterVersion} · {generated.themeName}
                    </p>
                    <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                      {generated.summary.map((s) => (
                        <li key={s} className="break-words">
                          {s}
                        </li>
                      ))}
                      {generated.warnings.map((w) => (
                        <li key={w} className="flex gap-2 text-warning">
                          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                          <span className="break-words">{w}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div className="mx-auto w-full max-w-[390px] overflow-hidden rounded-2xl border bg-background">
                    <iframe
                      title="Portal preview"
                      srcDoc={generated.html}
                      sandbox=""
                      className="h-[560px] w-full"
                    />
                  </div>
                  <div className="rounded-xl border p-3">
                    <p className="text-sm font-medium">Download &amp; upload to Omada</p>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      This controller has no supported way to import a customized page automatically,
                      so this one upload is done by you. WaveWallet will not claim it is imported
                      until the page is actually serving.
                    </p>
                    <ol className="mt-2 list-decimal space-y-1 pl-4 text-xs text-muted-foreground">
                      {generated.steps.map((s) => (
                        <li key={s}>{s}</li>
                      ))}
                    </ol>
                  </div>
                </div>
              ) : null}
            </div>

            <p className="text-[11px] text-muted-foreground">
              Current step: <strong>{stage}</strong>. Manual voucher entry is always part of the
              generated page and can never be turned off.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
