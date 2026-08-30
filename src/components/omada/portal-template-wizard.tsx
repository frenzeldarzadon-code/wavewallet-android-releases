/**
 * "Import Customized Page" wizard for ONE shop.
 *
 * The admin picks one of their OWN saved portals, uploads the template their
 * controller produced, sees exactly which Omada mechanics were detected and
 * kept, chooses which WaveWallet features to expose, previews the result on a
 * phone-sized frame and downloads the file to upload once into that portal.
 *
 * The controller is never written to: Omada 6.2.14.11 publishes no supported
 * route for importing a customized page, so the wizard says so plainly instead
 * of faking automation.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileCode2,
  Loader2,
  RefreshCw,
  Upload,
} from "lucide-react";
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
import {
  listPortalMappings,
  type PortalMappingView,
} from "@/lib/omada-portals.functions";
import {
  generatePortalTemplate,
  getPortalTemplate,
  savePortalTemplateFeatures,
  uploadPortalTemplate,
  type PortalTemplateView,
} from "@/lib/portal-template.functions";
import {
  TEMPLATE_FEATURE_LABELS,
  templateStage,
  type PortalTemplateFeatures,
} from "@/lib/portal-template";

const STEPS: Array<{ key: string; label: string }> = [
  { key: "portal", label: "Portal selected" },
  { key: "upload", label: "Template uploaded" },
  { key: "validate", label: "Template validated" },
  { key: "features", label: "Features chosen" },
  { key: "generate", label: "Portal page ready" },
  { key: "import", label: "Imported into Omada" },
];

export function PortalTemplateWizard({ ecosystemId }: { ecosystemId: string | null }) {
  const [mappings, setMappings] = useState<PortalMappingView[]>([]);
  const [mappingId, setMappingId] = useState("");
  const [template, setTemplate] = useState<PortalTemplateView | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [generated, setGenerated] = useState<{ fileName: string; html: string; steps: string[] } | null>(
    null,
  );
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!ecosystemId) return;
    setLoading(true);
    void listPortalMappings({ data: { ecosystemId } })
      .then((rows) => {
        setMappings(rows);
        setMappingId((current) => current || (rows[0]?.id ?? ""));
      })
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
      toast.error("Could not load this portal's template", { description: (e as Error).message });
    }
  }, [ecosystemId, mappingId]);

  useEffect(() => {
    void loadTemplate();
  }, [loadTemplate]);

  const mapping = mappings.find((m) => m.id === mappingId) ?? null;
  const analysis = template?.analysis ?? null;
  const features = template?.features ?? null;

  const progress = useMemo(
    () => ({
      controllerConnected: mappings.length > 0,
      portalSelected: Boolean(mappingId),
      templateUploaded: Boolean(template?.fileName),
      templateValidated: Boolean(analysis?.valid),
      generated: Boolean(template?.hasGenerated),
      importedVerified: template?.importStatus === "imported",
    }),
    [mappings.length, mappingId, template, analysis],
  );
  const stage = templateStage(progress);

  if (!ecosystemId) return null;

  const readFile = async (file: File) => {
    if (!ecosystemId || !mappingId) return;
    if (file.size > 2_000_000) {
      toast.error("That file is larger than 2 MB. Upload the portal page only.");
      return;
    }
    setBusy("upload");
    try {
      const html = await file.text();
      const saved = await uploadPortalTemplate({
        data: { ecosystemId, mappingId, fileName: file.name, html },
      });
      setTemplate(saved);
      setGenerated(null);
      toast.success("Template uploaded and checked.");
    } catch (e) {
      toast.error("Could not read that template", { description: (e as Error).message });
    } finally {
      setBusy("");
    }
  };

  const toggleFeature = async (key: keyof PortalTemplateFeatures, value: boolean) => {
    if (!features || !ecosystemId || !mappingId) return;
    const next = { ...features, [key]: value };
    setTemplate((t) => (t ? { ...t, features: next } : t));
    try {
      const saved = await savePortalTemplateFeatures({
        data: { ecosystemId, mappingId, features: next },
      });
      setTemplate(saved);
      setGenerated(null);
    } catch (e) {
      toast.error("Could not save that choice", { description: (e as Error).message });
      void loadTemplate();
    }
  };

  const generate = async () => {
    if (!ecosystemId || !mappingId) return;
    setBusy("generate");
    try {
      const file = await generatePortalTemplate({
        data: { ecosystemId, mappingId, origin: window.location.origin },
      });
      setGenerated({ fileName: file.fileName, html: file.html, steps: file.manualSteps });
      await loadTemplate();
      toast.success("Your portal page is ready to download.");
    } catch (e) {
      toast.error("Could not generate the portal page", { description: (e as Error).message });
    } finally {
      setBusy("");
    }
  };

  const download = () => {
    if (!generated) return;
    const blob = new Blob([generated.html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = generated.fileName;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Card className="shadow-[var(--shadow-card)]">
      <CardHeader>
        <CardTitle className="text-sm">Customized portal page</CardTitle>
        <CardDescription>
          For controllers that use Omada&apos;s <strong>Import Customized Page</strong>. Upload the
          template your own controller produced; WaveWallet keeps every Omada mechanic in it and adds
          your shop&apos;s features on top. Nothing on your controller is changed by this page.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Progress: every step is real state, never an assumption. */}
        <ol className="flex flex-wrap gap-1.5">
          {STEPS.map((s) => {
            const done =
              (s.key === "portal" && progress.portalSelected) ||
              (s.key === "upload" && progress.templateUploaded) ||
              (s.key === "validate" && progress.templateValidated) ||
              (s.key === "features" && Boolean(features)) ||
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
              {mapping ? (
                <p className="text-[11px] text-muted-foreground">
                  This page will be bound to this portal only.
                </p>
              ) : null}
            </div>

            {/* B — upload */}
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                const file = e.dataTransfer.files?.[0];
                if (file) void readFile(file);
              }}
              className={`rounded-xl border-2 border-dashed p-4 text-center transition-colors ${
                dragging ? "border-primary bg-primary/5" : "border-border"
              }`}
            >
              <FileCode2 className="mx-auto h-6 w-6 text-muted-foreground" />
              <p className="mt-2 text-sm font-medium">
                {template?.fileName ?? "Upload your Omada portal template"}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Download it from this portal in Omada (Portal Customization → export/download the
                customized page), then drop the .html file here.
              </p>
              <input
                ref={fileRef}
                type="file"
                accept=".html,.htm,text/html"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void readFile(file);
                  e.target.value = "";
                }}
              />
              <Button
                size="sm"
                variant="outline"
                className="mt-3"
                disabled={busy !== "" || !mappingId}
                onClick={() => fileRef.current?.click()}
              >
                {busy === "upload" ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Upload className="mr-2 h-4 w-4" />
                )}
                Choose file
              </Button>
            </div>

            {/* C — validation report */}
            {analysis ? (
              <div className="space-y-2 rounded-xl border p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium">What WaveWallet keeps</p>
                  <StatusBadge tone={analysis.valid ? "success" : "danger"}>
                    {analysis.valid ? "Validated" : "Not usable"}
                  </StatusBadge>
                </div>
                <ul className="space-y-1 text-xs text-muted-foreground">
                  {analysis.preserved.map((p) => (
                    <li key={p} className="flex gap-2">
                      <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
                      <span className="break-words">{p}</span>
                    </li>
                  ))}
                  {analysis.warnings.map((w) => (
                    <li key={w} className="flex gap-2">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
                      <span className="break-words">{w}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {/* D — features */}
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

            {/* E/F — preview + generate */}
            {analysis?.valid ? (
              <div className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" disabled={busy !== ""} onClick={() => void generate()}>
                    {busy === "generate" ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <RefreshCw className="mr-2 h-4 w-4" />
                    )}
                    Generate portal page
                  </Button>
                  <Button size="sm" variant="outline" disabled={!generated} onClick={download}>
                    <Download className="mr-2 h-4 w-4" />
                    Download
                  </Button>
                </div>

                {generated ? (
                  <div className="space-y-3">
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
                        This controller has no supported way to import a customized page
                        automatically, so this one upload is done by you. WaveWallet will not claim
                        it is imported until the page is actually serving.
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
            ) : null}

            <p className="text-[11px] text-muted-foreground">
              Current step: <strong>{stage}</strong>. Manual voucher entry from your controller is
              always kept and is never replaced.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
