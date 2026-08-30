/**
 * Canonical Omada portal template library — platform owner only.
 *
 * The original Omada template is uploaded here once and stored exactly as it
 * arrived. Every shop's generated captive-portal page is derived from the
 * ACTIVE version below; older versions are kept and can be re-activated, but
 * nothing is ever rewritten in place.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, FileUp, Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EmptyState, PageSection, StatusBadge } from "@/components/ui-kit";
import {
  activatePortalMaster,
  listPortalMasters,
  uploadPortalMaster,
  type PortalMasterView,
} from "@/lib/portal-master.functions";

export const Route = createFileRoute("/super/portal-template")({
  head: () => ({
    meta: [
      { title: "Omada Portal Template — WaveWallet Platform" },
      {
        name: "description",
        content:
          "Publish the original Omada captive-portal template once. Every shop's portal page is generated from it.",
      },
      { property: "og:title", content: "Omada Portal Template — WaveWallet Platform" },
      {
        property: "og:description",
        content: "Publish the original Omada captive-portal template used to generate every shop's portal page.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SuperPortalTemplate,
});

function readableSize(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
}

function bytesToBase64(buffer: ArrayBuffer): string {
  const view = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < view.length; i += 0x8000) {
    binary += String.fromCharCode(...view.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function SuperPortalTemplate() {
  const [versions, setVersions] = useState<PortalMasterView[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [notes, setNotes] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setVersions(await listPortalMasters({ data: {} }));
    } catch (e) {
      toast.error("Could not load the template library", { description: (e as Error).message });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onFile = async (file: File) => {
    setBusy("upload");
    try {
      const isZip = /\.zip$/i.test(file.name);
      const content = isZip ? bytesToBase64(await file.arrayBuffer()) : await file.text();
      const saved = await uploadPortalMaster({
        data: { fileName: file.name, kind: isZip ? "zip" : "html", content, notes: notes.trim() },
      });
      toast.success(`Version ${saved.version} published`, {
        description: "Every shop now generates its portal page from this template.",
      });
      setNotes("");
      if (fileRef.current) fileRef.current.value = "";
      await load();
    } catch (e) {
      toast.error("That template was not stored", { description: (e as Error).message });
    } finally {
      setBusy("");
    }
  };

  const activate = async (id: string) => {
    setBusy(id);
    try {
      setVersions(await activatePortalMaster({ data: { id } }));
      toast.success("Active version changed.");
    } catch (e) {
      toast.error("Could not change the active version", { description: (e as Error).message });
    } finally {
      setBusy("");
    }
  };

  const active = versions.find((v) => v.isActive) ?? null;

  return (
    <PageSection
      title="Omada Portal Template"
      description="Upload the original Omada portal template once. It is stored untouched and every shop's captive-portal page is generated from the active version."
    >
      <div className="space-y-4">
        <Card className="shadow-[var(--shadow-card)]">
          <CardHeader>
            <CardTitle className="text-sm">Publish the original template</CardTitle>
            <CardDescription>
              Use the .zip Omada produces when you download a customized page, or its index.html. The
              file is stored exactly as uploaded and never modified.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="master-notes">Note (optional)</Label>
              <Input
                id="master-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="e.g. Controller 6.2.14.11 default voucher page"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="master-file">Original Omada template</Label>
              <Input
                id="master-file"
                ref={fileRef}
                type="file"
                accept=".zip,.html,.htm,text/html,application/zip"
                disabled={busy !== ""}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void onFile(file);
                }}
              />
            </div>
            {busy === "upload" ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Reading and validating the template…
              </p>
            ) : (
              <p className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <FileUp className="h-3.5 w-3.5" /> A new upload becomes the active version; older
                versions stay in the list below.
              </p>
            )}
          </CardContent>
        </Card>

        {active ? (
          <Card className="shadow-[var(--shadow-card)]">
            <CardHeader>
              <CardTitle className="text-sm">What the active master preserves</CardTitle>
              <CardDescription>
                Read directly from version {active.version}; nothing here is assumed.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="space-y-1 text-xs text-muted-foreground">
                {(active.analysis?.preserved ?? []).map((line) => (
                  <li key={line} className="flex gap-2">
                    <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
                    <span className="break-words">{line}</span>
                  </li>
                ))}
                {active.warnings.map((w) => (
                  <li key={w} className="flex gap-2 text-warning">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span className="break-words">{w}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ) : null}

        <Card className="shadow-[var(--shadow-card)]">
          <CardHeader>
            <CardTitle className="text-sm">Stored versions</CardTitle>
            <CardDescription>Every upload is kept. Only one version is active at a time.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {loading ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading…
              </p>
            ) : versions.length === 0 ? (
              <EmptyState
                title="No template published yet"
                description="Until the original Omada template is uploaded here, shops cannot generate a customized portal page."
              />
            ) : (
              versions.map((v) => (
                <div key={v.id} className="rounded-xl border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="flex items-center gap-2 text-sm font-medium">
                      <ShieldCheck className="h-4 w-4 text-success" /> Version {v.version} · {v.fileName}
                    </p>
                    {v.isActive ? (
                      <StatusBadge tone="success">Active</StatusBadge>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy !== ""}
                        onClick={() => void activate(v.id)}
                      >
                        {busy === v.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                        Make active
                      </Button>
                    )}
                  </div>
                  <p className="mt-1 break-words text-[11px] text-muted-foreground">
                    Original {readableSize(v.originalBytes)} ({v.sourceKind}) · fingerprint{" "}
                    {v.originalChecksum} · page {readableSize(v.bytes)} · uploaded{" "}
                    {v.uploadedAt ? new Date(v.uploadedAt).toLocaleString() : "—"}
                  </p>
                  {v.archiveFiles.length ? (
                    <p className="mt-1 break-words text-[11px] text-muted-foreground">
                      Files kept: {v.archiveFiles.join(", ")}
                    </p>
                  ) : null}
                  {v.notes ? <p className="mt-1 text-xs">{v.notes}</p> : null}
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </PageSection>
  );
}
