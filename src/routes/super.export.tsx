import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Download, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PageSection } from "@/components/ui-kit";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/lib/session";
import {
  EXPORT_DATASETS,
  PLATFORM_SCOPE,
  buildManifest,
  datasetGroups,
  downloadManifest,
  exportDataset,
  manifestFileName,
  type ExportResult,
  type ExportScope,
} from "@/lib/data-export";
import { toast } from "sonner";

export const Route = createFileRoute("/super/export")({
  head: () => ({
    meta: [
      { title: "Data Export & Backup — WaveWallet Super Admin" },
      {
        name: "description",
        content:
          "Download timestamped CSV backups of voucher inventory, credit and points ledgers, sales, earnings and member records for recovery and audit.",
      },
      { property: "og:title", content: "Data Export & Backup — WaveWallet Super Admin" },
      {
        property: "og:description",
        content:
          "Read-only, scope-labelled exports of operational records. No credentials are ever included.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SuperExport,
});

function SuperExport() {
  const { account } = useSession("super_admin");
  const [ecosystems, setEcosystems] = useState<{ id: string; name: string }[]>([]);
  const [scopeId, setScopeId] = useState<string>("all");
  const [selected, setSelected] = useState<string[]>(EXPORT_DATASETS.map((d) => d.id));
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<ExportResult[] | null>(null);

  useEffect(() => {
    void supabase
      .from("ecosystems")
      .select("id, name")
      .order("name")
      .then(({ data }) => setEcosystems(data ?? []));
  }, []);

  const scope: ExportScope = useMemo(() => {
    if (scopeId === "all") return PLATFORM_SCOPE;
    const eco = ecosystems.find((e) => e.id === scopeId);
    return { ecosystemId: scopeId, ecosystemLabel: eco?.name ?? "ecosystem" };
  }, [scopeId, ecosystems]);

  const groups = datasetGroups();
  const toggle = (id: string) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const runExport = async () => {
    const datasets = EXPORT_DATASETS.filter((d) => selected.includes(d.id));
    if (datasets.length === 0) {
      toast.error("Select at least one dataset to export.");
      return;
    }
    setBusy(true);
    const at = new Date();
    const results: ExportResult[] = [];
    try {
      for (const dataset of datasets) {
        results.push(await exportDataset(dataset, scope, at));
      }
      const manifest = buildManifest({
        results,
        scope,
        actorName: account?.name ?? "Super Admin",
        at,
      });
      downloadManifest(manifest, manifestFileName(scope, at));
      setLast(results);
      toast.success(`Exported ${results.length} datasets`, {
        description: `${results.reduce((s, r) => s + r.rowCount, 0)} rows plus a manifest file.`,
      });
    } catch (e) {
      toast.error("Export failed", { description: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <PageSection
      title="Data export & backup"
      description="Read-only CSV copies of operational records for recovery and audit. Nothing here changes or deletes production data."
      className="space-y-4"
    >



      <Card className="border-primary/30 bg-primary/5">
        <CardContent className="flex gap-3 p-4 text-sm">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" />
          <div className="space-y-1 text-muted-foreground">
            <p className="font-medium text-foreground">What is never exported</p>
            <p>
              Passwords, authentication tokens, sessions, ecosystem signup tokens and uploaded
              payment proof files are excluded by design. Every file is generated from an explicit
              column list and named with its scope and UTC timestamp.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-4 p-4">
          <div className="space-y-2">
            <Label htmlFor="scope">Scope</Label>
            <Select value={scopeId} onValueChange={setScopeId}>
              <SelectTrigger id="scope" className="max-w-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Entire platform (all ecosystems)</SelectItem>
                {ecosystems.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              A single-ecosystem export only contains that tenant&apos;s rows.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSelected(EXPORT_DATASETS.map((d) => d.id))}
            >
              Select all
            </Button>
            <Button variant="outline" size="sm" onClick={() => setSelected([])}>
              Clear
            </Button>
          </div>
        </CardContent>
      </Card>

      {groups.map((g) => (
        <Card key={g.group}>
          <CardContent className="space-y-3 p-4">
            <p className="text-sm font-semibold">{g.group}</p>
            <div className="grid gap-3 sm:grid-cols-2">
              {g.datasets.map((d) => (
                <label
                  key={d.id}
                  className="flex cursor-pointer items-start gap-3 rounded-lg border p-3"
                >
                  <Checkbox
                    checked={selected.includes(d.id)}
                    onCheckedChange={() => toggle(d.id)}
                    className="mt-0.5"
                  />
                  <span className="space-y-0.5">
                    <span className="block text-sm font-medium">{d.label}</span>
                    <span className="block text-xs text-muted-foreground">{d.description}</span>
                  </span>
                </label>
              ))}
            </div>
          </CardContent>
        </Card>
      ))}

      <div className="sticky bottom-20 z-10 md:bottom-4">
        <Button className="w-full" size="lg" disabled={busy} onClick={runExport}>
          <Download className="mr-2 size-4" />
          {busy
            ? "Preparing export…"
            : `Export ${selected.length} dataset${selected.length === 1 ? "" : "s"} + manifest`}
        </Button>
      </div>

      {last && (
        <Card>
          <CardContent className="space-y-2 p-4 text-sm">
            <p className="font-semibold">Last export</p>
            <ul className="space-y-1 text-muted-foreground">
              {last.map((r) => (
                <li key={r.datasetId} className="flex justify-between gap-4">
                  <span className="truncate">{r.fileName}</span>
                  <span className="shrink-0 tabular-nums">{r.rowCount} rows</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </>
  );
}
