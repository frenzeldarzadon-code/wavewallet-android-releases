import { createFileRoute } from "@tanstack/react-router";
import { Upload } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageSection, StatCard, StatusBadge } from "@/components/ui-kit";
import { useSession } from "@/lib/session";
import { shortDate, voucherCodesIn, voucherProductsIn } from "@/lib/wavewallet";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/vouchers")({
  head: () => ({
    meta: [
      { title: "Voucher Code Inventory — WaveWallet Admin" },
      { name: "description", content: "Import voucher codes manually, detect duplicates and track unused versus sold stock." },
      { property: "og:title", content: "Voucher Code Inventory — WaveWallet Admin" },
      { property: "og:description", content: "Import voucher codes manually, detect duplicates and track unused versus sold stock." },
    ],
  }),
  component: AdminVouchers,
});

function AdminVouchers() {
  const { ecosystem } = useSession("admin");
  const [productId, setProductId] = useState("");
  const [raw, setRaw] = useState("");

  const codes = ecosystem ? voucherCodesIn(ecosystem.id) : [];
  const products = ecosystem ? voucherProductsIn(ecosystem.id) : [];

  const parsed = useMemo(() => {
    const lines = raw
      .split(/[\r\n,;\t]+/)
      .map((l) => l.trim())
      .filter(Boolean);
    const seen = new Set<string>();
    const existing = new Set(codes.map((c) => c.code.toUpperCase()));
    const unique: string[] = [];
    const duplicates: string[] = [];
    for (const line of lines) {
      const key = line.toUpperCase();
      if (seen.has(key) || existing.has(key)) duplicates.push(line);
      else {
        seen.add(key);
        unique.push(line);
      }
    }
    return { unique, duplicates, total: lines.length };
  }, [raw, codes]);

  if (!ecosystem) return null;

  return (
    <>
      <PageSection>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Total codes" value={String(codes.length)} />
          <StatCard label="Unused" value={String(codes.filter((c) => c.state === "unused").length)} tone="positive" />
          <StatCard label="Reserved" value={String(codes.filter((c) => c.state === "reserved").length)} hint="Held mid-transaction" />
          <StatCard label="Sold" value={String(codes.filter((c) => c.state === "sold").length)} tone="negative" />
        </div>
      </PageSection>

      <PageSection title="Import codes" description="No Omada API in this version — codes are pasted or uploaded, one per row.">
        <Card className="shadow-[var(--shadow-card)]">
          <CardHeader>
            <CardTitle className="text-sm">Manual import</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Voucher product</Label>
                <Select value={productId} onValueChange={setProductId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select product" />
                  </SelectTrigger>
                  <SelectContent>
                    {products.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="file">Upload file (one code per row)</Label>
                <Input
                  id="file"
                  type="file"
                  accept=".txt,.csv"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (file) setRaw(await file.text());
                  }}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="codes">Paste codes</Label>
              <Textarea
                id="codes"
                rows={5}
                value={raw}
                onChange={(e) => setRaw(e.target.value)}
                placeholder={"SW1H-0001-AAAA\nSW1H-0002-BBBB"}
                className="font-mono text-xs"
              />
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <StatusBadge tone="muted">{parsed.total} rows read</StatusBadge>
              <StatusBadge tone="success">{parsed.unique.length} importable</StatusBadge>
              <StatusBadge tone="danger">{parsed.duplicates.length} duplicates rejected</StatusBadge>
            </div>
            {parsed.duplicates.length ? (
              <p className="rounded-lg bg-danger-soft px-3 py-2 font-mono text-[11px] text-destructive">
                {parsed.duplicates.slice(0, 8).join(", ")}
                {parsed.duplicates.length > 8 ? "…" : ""}
              </p>
            ) : null}
            <Button
              disabled={!productId || parsed.unique.length === 0}
              onClick={() => {
                toast.success(`${parsed.unique.length} codes queued for import`, {
                  description: `${parsed.duplicates.length} duplicates rejected. Persisting connects with the database.`,
                });
                setRaw("");
              }}
            >
              <Upload className="size-4" /> Import codes
            </Button>
          </CardContent>
        </Card>
      </PageSection>

      <PageSection title="Code inventory" description="A code is atomically assigned and marked sold at purchase — never dispensed twice.">
        <Card className="overflow-hidden py-0 shadow-[var(--shadow-card)]">
          <CardContent className="px-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Code</TableHead>
                    <TableHead>Product</TableHead>
                    <TableHead className="hidden sm:table-cell">Imported</TableHead>
                    <TableHead>State</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {codes.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="font-mono text-xs">{c.code}</TableCell>
                      <TableCell className="text-sm">
                        {products.find((p) => p.id === c.productId)?.name ?? "—"}
                      </TableCell>
                      <TableCell className="hidden sm:table-cell text-xs text-muted-foreground">
                        {shortDate(c.importedAt)}
                      </TableCell>
                      <TableCell>
                        <StatusBadge
                          tone={c.state === "unused" ? "success" : c.state === "reserved" ? "warning" : "danger"}
                        >
                          {c.state}
                        </StatusBadge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </PageSection>
    </>
  );
}
