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
import { useCallback, useEffect, useState } from "react";
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
import { getPortalArtifactDownload } from "@/lib/portal-artifact-download.functions";
import {
  DEFAULT_PORTAL_THEME_SLUG,
  PORTAL_THEMES,
  type PortalTheme,
} from "@/lib/portal-themes";
import { PortalThemeGallery } from "./portal-theme-gallery";
import { resolveGeneratedAfterRefresh } from "@/lib/portal-download";
import {
  TEMPLATE_FEATURE_LABELS,
  type PortalTemplateFeatures,
} from "@/lib/portal-template";

const STEPS: Array<{ key: string; label: string }> = [
  { key: "portal", label: "1. Select portal" },
  { key: "design", label: "2. Choose design" },
  { key: "features", label: "3. Choose features" },
  { key: "generate", label: "4. Generate & download" },
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
  const [downloadLink, setDownloadLink] = useState<{ url: string; fileName: string } | null>(null);
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

  const loadTemplate = useCallback(
    async (opts?: { keepGenerated?: boolean }) => {
      if (!ecosystemId || !mappingId) {
        setTemplate(null);
        return;
      }
      try {
        setTemplate(await getPortalTemplate({ data: { ecosystemId, mappingId } }));
        // Never drop a freshly generated artifact just because we refreshed
        // the saved status: that is what disabled the Download button.
        setGenerated((g) => resolveGeneratedAfterRefresh(g, opts));

      } catch (e) {
        toast.error("Could not load this portal's setup", { description: (e as Error).message });
      }
    },
    [ecosystemId, mappingId],
  );

  useEffect(() => {
    void loadTemplate();
  }, [loadTemplate]);


  const mapping = mappings.find((m) => m.id === mappingId) ?? null;
  const features = template?.features ?? null;

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
    setDownloadLink(null);
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
      setDownloadLink(await getPortalArtifactDownload({ data: { ecosystemId, mappingId } }));
      await loadTemplate({ keepGenerated: true });
      toast.success("Your portal page is ready to download.");
    } catch (e) {
      toast.error("Could not generate the portal page", { description: (e as Error).message });
    } finally {
      setBusy("");
    }
  };

  return (
    <Card className="shadow-[var(--shadow-card)]">
      <CardHeader>
        <CardTitle className="text-sm">Customized portal page</CardTitle>
        <CardDescription>
          For controllers that use Omada&apos;s <strong>Import Customized Page</strong>. WaveWallet
          builds the page from the canonical Omada template. Choose the portal, design and features,
          then generate, download and import the file into that portal in Omada.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Only verifiable local steps are shown; importing remains a manual Omada action. */}
        <ol className="flex flex-wrap gap-1.5">
          {STEPS.map((s) => {
            const done =
              (s.key === "portal" && Boolean(mappingId)) ||
              (s.key === "features" && Boolean(features)) ||
              (s.key === "design" && Boolean(template)) ||
              (s.key === "generate" && Boolean(template?.hasGenerated));
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
              <details className="rounded-md border p-3">
                <summary className="cursor-pointer text-sm font-medium">Advanced template details</summary>
                <div className="mt-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-medium">Canonical Omada mechanics preserved</p>
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
              </details>
            ) : null}

            {/* Design gallery — presentation only. */}
            {template ? (
              <PortalThemeGallery
                themes={themes}
                value={template.themeSlug ?? DEFAULT_PORTAL_THEME_SLUG}
                shopName={mapping?.portalName ?? "Your shop"}
                features={features ?? undefined}
                busy={themeBusy}
                onSelect={(slug) => void chooseTheme(slug)}
              />
            ) : null}

            {/* Features */}
            {features ? (
              <div className="space-y-2 rounded-md border p-3">
                <div>
                  <p className="text-sm font-medium">Features on this portal</p>
                  <p className="text-[11px] text-muted-foreground">
                    Manual voucher entry is always included and cannot be switched off.
                  </p>
                </div>
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
                {generated && downloadLink ? (
                  <Button asChild size="sm" variant="outline">
                    <a href={downloadLink.url} download={downloadLink.fileName}>
                      <Download className="mr-2 h-4 w-4" />
                      Download ({readableSize(generated.bytes)})
                    </a>
                  </Button>
                ) : (
                  <Button size="sm" variant="outline" disabled>
                    <Download className="mr-2 h-4 w-4" />
                    Download (generate first)
                  </Button>
                )}
              </div>

              {downloadLink ? (
                <p className="text-xs text-muted-foreground">
                  If the download does not start, {" "}
                  <a className="font-medium text-primary underline" href={downloadLink.url}>
                    open/download the file
                  </a>
                  .
                </p>
              ) : null}

              {generated ? (
                <div className="space-y-3">
                  <div className="rounded-md border p-3">
                    <p className="flex items-center gap-2 text-sm font-medium">
                      <ShieldCheck className="h-4 w-4 text-success" /> Portal page ready
                    </p>
                    <p className="mt-1 break-words text-xs text-muted-foreground">
                      {generated.fileName} · {readableSize(generated.bytes)} · {generated.themeName}
                    </p>
                    <details className="mt-3 border-t pt-3">
                      <summary className="cursor-pointer text-xs font-medium">Advanced details</summary>
                      <p className="mt-2 break-words text-[11px] text-muted-foreground">
                        Checksum {generated.checksum} · master v{generated.masterVersion} · master
                        checksum {generated.masterChecksum}
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
                    </details>
                  </div>
                  <div className="mx-auto w-full max-w-[390px] overflow-hidden rounded-2xl border bg-background">
                    <iframe
                      title="Portal preview"
                      srcDoc={generated.html}
                      sandbox=""
                      className="h-[560px] w-full"
                    />
                  </div>
                  <p className="mx-auto max-w-[390px] text-[11px] text-muted-foreground">
                    This is the exact page you are about to download and import — the same file,
                    rendered offline. Shop products, coins and points are fetched by the live portal
                    only, so they are not shown here.
                  </p>
                   <div className="rounded-md border p-3">
                     <p className="text-sm font-medium">Import the downloaded page into Omada</p>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                       Import is a manual Omada step. WaveWallet does not mark it complete because it
                       cannot verify the import from here.
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

          </>
        )}
      </CardContent>
    </Card>
  );
}
