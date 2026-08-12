import { createFileRoute } from "@tanstack/react-router";
import { FileUp, Trash2, Upload } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState, PageSection, StatCard, StatusBadge } from "@/components/ui-kit";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/lib/session";
import { peso, shortDateTime } from "@/lib/wavewallet";
import {
  deleteVoucherBatch,
  deleteVoucherCode,
  fetchInventoryCounts,
  fetchProducts,
  fetchSales,
  importVoucherCodes,
  parseCodeFile,
  parsePastedCodes,
  fetchVoucherBatches,
  type ImportResult,
  type InventoryCount,
  type SaleRow,
  type VoucherProductRow,
} from "@/lib/wallet";
import { toast } from "sonner";
import {
  batchDeleteBlockReason,
  canDeleteCode,
  type VoucherBatch,
} from "@/lib/voucher-inventory";

export const Route = createFileRoute("/admin/vouchers")({
  head: () => ({
    meta: [
      { title: "Voucher Code Inventory — WaveWallet Admin" },
      {
        name: "description",
        content:
          "Manually import voucher codes by paste or file, detect duplicates and track unused versus sold stock and sales history.",
      },
      { property: "og:title", content: "Voucher Code Inventory — WaveWallet Admin" },
      {
        property: "og:description",
        content: "Manual voucher code imports with duplicate detection and full sold-code history.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AdminVouchers,
});

interface CodeRow {
  id: string;
  code: string;
  status: string;
  product_id: string;
  import_id: string | null;
  sale_id: string | null;
  sold_at: string | null;
  sold_to: string | null;
}

type PendingDelete =
  | { kind: "code"; code: CodeRow; batch: VoucherBatch | undefined }
  | { kind: "batch"; batch: VoucherBatch };

function AdminVouchers() {
  const { ecosystemDbId } = useSession("admin");
  const [products, setProducts] = useState<VoucherProductRow[]>([]);
  const [counts, setCounts] = useState<Record<string, InventoryCount>>({});
  const [batches, setBatches] = useState<VoucherBatch[]>([]);
  const [sales, setSales] = useState<SaleRow[]>([]);
  const [codes, setCodes] = useState<CodeRow[]>([]);
  const [buyers, setBuyers] = useState<Record<string, string>>({});
  const [productId, setProductId] = useState("");
  const [raw, setRaw] = useState("");
  const [fileCodes, setFileCodes] = useState<string[] | null>(null);
  const [fileName, setFileName] = useState("");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<(ImportResult & { productName: string }) | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    if (!ecosystemDbId) return;
    try {
      const [p, c, i, s, cd] = await Promise.all([
        fetchProducts(ecosystemDbId),
        fetchInventoryCounts(ecosystemDbId),
        fetchVoucherBatches(ecosystemDbId),
        fetchSales(ecosystemDbId),
        supabase
          .from("voucher_codes")
          .select("id, code, status, product_id, import_id, sale_id, sold_at, sold_to")
          .eq("ecosystem_id", ecosystemDbId)
          .order("created_at", { ascending: false })
          .limit(200),
      ]);
      setProducts(p);
      setCounts(c);
      setBatches(i);
      setSales(s);
      setCodes((cd.data ?? []) as CodeRow[]);
      const ids = [...new Set(s.map((x) => x.buyer_id))];
      if (ids.length) {
        const { data } = await supabase.from("profiles").select("id, full_name, email").in("id", ids);
        setBuyers(
          Object.fromEntries((data ?? []).map((d) => [d.id, `${d.full_name} — ${d.email}`])),
        );
      }
    } catch (e) {
      toast.error((e as Error).message);
    }
  }, [ecosystemDbId]);

  useEffect(() => {
    void load();
  }, [load]);

  const pasted = useMemo(() => parsePastedCodes(raw), [raw]);
  const pending = fileCodes ?? pasted;

  if (!ecosystemDbId) return null;

  const totals = Object.values(counts).reduce(
    (acc, c) => ({ total: acc.total + c.total, unused: acc.unused + c.unused, sold: acc.sold + c.sold }),
    { total: 0, unused: 0, sold: 0 },
  );

  const runImport = async () => {
    if (!productId || pending.length === 0) return;
    setBusy(true);
    try {
      const res = await importVoucherCodes(productId, pending, fileCodes ? "file" : "paste");
      setResult({ ...res, productName: products.find((p) => p.id === productId)?.name ?? "" });
      setRaw("");
      setFileCodes(null);
      setFileName("");
      setOpen(false);
      await load();
    } catch (e) {
      toast.error("Import failed", { description: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const runDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      if (pendingDelete.kind === "code") {
        await deleteVoucherCode(pendingDelete.code.id);
        toast.success("Voucher code deleted");
      } else {
        const n = await deleteVoucherBatch(pendingDelete.batch.batch_id);
        toast.success(`Batch deleted — ${n} unused code${n === 1 ? "" : "s"} removed`);
      }
      setPendingDelete(null);
      await load();
    } catch (e) {
      toast.error("Deletion blocked", { description: (e as Error).message });
    } finally {
      setDeleting(false);
    }
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const parsed = await parseCodeFile(file);
      setFileCodes(parsed);
      setFileName(file.name);
    } catch {
      toast.error("Could not read that file. Use a .txt, .csv or .xlsx with one code per row.");
    }
  };

  return (
    <>
      <PageSection
        title="Code inventory"
        description="Voucher codes are imported manually. They are never generated or synced from any external system."
        action={
          <Button size="sm" onClick={() => setOpen(true)} disabled={products.length === 0}>
            <Upload className="size-4" /> Import codes
          </Button>
        }
      >
        <div className="grid gap-3 sm:grid-cols-3">
          <StatCard label="Total codes" value={String(totals.total)} />
          <StatCard label="Unused" value={String(totals.unused)} tone="positive" />
          <StatCard label="Sold" value={String(totals.sold)} tone="negative" />
        </div>
      </PageSection>

      <PageSection title="Per product">
        {products.length === 0 ? (
          <EmptyState title="No products yet" description="Create a voucher product first." />
        ) : (
          <Card className="shadow-[var(--shadow-card)]">
            <CardContent className="px-0 py-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Product</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="text-right">Unused</TableHead>
                    <TableHead className="text-right">Sold</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {products.map((p) => {
                    const c = counts[p.id];
                    return (
                      <TableRow key={p.id}>
                        <TableCell className="font-medium">{p.name}</TableCell>
                        <TableCell className="text-right">{c?.total ?? 0}</TableCell>
                        <TableCell className="text-right text-success">{c?.unused ?? 0}</TableCell>
                        <TableCell className="text-right text-destructive">{c?.sold ?? 0}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </PageSection>

      <Tabs defaultValue="codes">
        <TabsList className="mb-3 flex w-full flex-wrap justify-start">
          <TabsTrigger value="codes">Codes</TabsTrigger>
          <TabsTrigger value="sold">Sold history</TabsTrigger>
          <TabsTrigger value="imports">Import history</TabsTrigger>
        </TabsList>

        <TabsContent value="codes">
          {codes.length === 0 ? (
            <EmptyState title="No codes imported yet" />
          ) : (
            <Card className="shadow-[var(--shadow-card)]">
              <CardContent className="px-0 py-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Code</TableHead>
                      <TableHead>Product</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Sold at</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {codes.map((c) => (
                      <TableRow key={c.id}>
                        <TableCell className="font-mono text-xs">{c.code}</TableCell>
                        <TableCell className="text-xs">
                          {products.find((p) => p.id === c.product_id)?.name ?? "—"}
                        </TableCell>
                        <TableCell>
                          <StatusBadge tone={c.status === "sold" ? "danger" : "success"}>
                            {c.status === "sold" ? "Sold" : "Available"}
                          </StatusBadge>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {c.sold_at ? shortDateTime(c.sold_at) : "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="sold">
          {sales.length === 0 ? (
            <EmptyState title="No vouchers sold yet" />
          ) : (
            <Card className="shadow-[var(--shadow-card)]">
              <CardContent className="px-0 py-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Buyer</TableHead>
                      <TableHead>Product</TableHead>
                      <TableHead className="text-right">Sale price</TableHead>
                      <TableHead>Payment</TableHead>
                      <TableHead>Transaction</TableHead>
                      <TableHead>When</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sales.map((s) => (
                      <TableRow key={s.id}>
                        <TableCell className="text-xs">
                          {buyers[s.buyer_id] ?? s.buyer_id.slice(0, 8)}
                          <span className="ml-1 text-muted-foreground">({s.buyer_role})</span>
                        </TableCell>
                        <TableCell className="text-xs">{s.product_name}</TableCell>
                        <TableCell className="text-right text-xs">
                          {peso(s.sale_price)}
                          {s.discount_percent > 0 ? (
                            <span className="ml-1 text-muted-foreground">−{s.discount_percent}%</span>
                          ) : null}
                        </TableCell>
                        <TableCell className="text-xs">{s.payment_method}</TableCell>
                        <TableCell className="font-mono text-[11px]">{s.tx_id}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {shortDateTime(s.created_at)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="imports">
          {imports.length === 0 ? (
            <EmptyState title="No imports yet" />
          ) : (
            <Card className="shadow-[var(--shadow-card)]">
              <CardContent className="px-0 py-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>When</TableHead>
                      <TableHead>Product</TableHead>
                      <TableHead>By</TableHead>
                      <TableHead className="text-right">Imported</TableHead>
                      <TableHead className="text-right">Duplicates</TableHead>
                      <TableHead className="text-right">Invalid</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {imports.map((i) => (
                      <TableRow key={i.id}>
                        <TableCell className="text-xs">{shortDateTime(i.created_at)}</TableCell>
                        <TableCell className="text-xs">
                          {products.find((p) => p.id === i.product_id)?.name ?? "—"}
                        </TableCell>
                        <TableCell className="text-xs">
                          {i.actor_name} · {i.source}
                        </TableCell>
                        <TableCell className="text-right text-xs text-success">{i.imported_count}</TableCell>
                        <TableCell className="text-right text-xs text-warning-foreground">
                          {i.duplicate_count}
                        </TableCell>
                        <TableCell className="text-right text-xs text-destructive">
                          {i.invalid_count}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Import voucher codes</DialogTitle>
            <DialogDescription>
              Paste one code per line, or upload a .txt, .csv or .xlsx with one code per row. Duplicates
              are detected and skipped automatically.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Product</Label>
              <Select value={productId} onValueChange={setProductId}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose a voucher product" />
                </SelectTrigger>
                <SelectContent>
                  {products
                    .filter((p) => !p.archived)
                    .map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>

            <Tabs defaultValue="paste">
              <TabsList className="w-full">
                <TabsTrigger value="paste" onClick={() => setFileCodes(null)}>
                  Paste codes
                </TabsTrigger>
                <TabsTrigger value="file">Upload file</TabsTrigger>
              </TabsList>
              <TabsContent value="paste" className="pt-3">
                <Textarea
                  rows={7}
                  value={raw}
                  onChange={(e) => setRaw(e.target.value)}
                  placeholder={"CODE-0001\nCODE-0002\nCODE-0003"}
                  className="font-mono text-xs"
                />
              </TabsContent>
              <TabsContent value="file" className="space-y-2 pt-3">
                <Input
                  type="file"
                  accept=".txt,.csv,.xlsx,.xls"
                  onChange={(e) => void onFile(e.target.files?.[0])}
                />
                {fileCodes ? (
                  <p className="flex items-center gap-2 rounded-lg bg-brand-soft px-3 py-2 text-xs text-accent-foreground">
                    <FileUp className="size-3.5" /> {fileName} · {fileCodes.length} rows detected
                  </p>
                ) : null}
              </TabsContent>
            </Tabs>

            <p className="text-xs text-muted-foreground">
              {pending.length} code{pending.length === 1 ? "" : "s"} ready to import.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void runImport()} disabled={busy || !productId || pending.length === 0}>
              {busy ? "Importing…" : "Import codes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!result} onOpenChange={(o) => !o && setResult(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Import complete</DialogTitle>
            <DialogDescription>{result?.productName}</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-xl bg-success-soft px-2 py-3">
              <p className="text-lg font-semibold text-success">{result?.imported_count}</p>
              <p className="text-[11px] text-muted-foreground">Imported</p>
            </div>
            <div className="rounded-xl bg-warning/15 px-2 py-3">
              <p className="text-lg font-semibold text-warning-foreground">{result?.duplicate_count}</p>
              <p className="text-[11px] text-muted-foreground">Duplicates</p>
            </div>
            <div className="rounded-xl bg-danger-soft px-2 py-3">
              <p className="text-lg font-semibold text-destructive">{result?.invalid_count}</p>
              <p className="text-[11px] text-muted-foreground">Invalid rows</p>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => setResult(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
