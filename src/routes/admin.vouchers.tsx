import { createFileRoute, Link } from "@tanstack/react-router";
import { AlertTriangle, CheckCircle2, FileUp, Info, Package, Trash2, Upload } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";

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
  deleteUnusedVoucherBatch,
  deleteVoucherBatch,
  deleteVoucherCode,
  fetchInventoryCounts,
  fetchProducts,
  fetchSales,
  importVoucherCodes,
  listPrice,

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
  canDeleteUnusedCodes,
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
  | { kind: "batch"; batch: VoucherBatch }
  | { kind: "unused"; batch: VoucherBatch };

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
  const [confirmOpen, setConfirmOpen] = useState(false);

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
  const selectableProducts = useMemo(() => products.filter((p) => !p.archived), [products]);
  const selectedProduct = selectableProducts.find((p) => p.id === productId) ?? null;
  const noProducts = products.length === 0;

  if (!ecosystemDbId) return null;

  const totals = Object.values(counts).reduce(
    (acc, c) => ({ total: acc.total + c.total, unused: acc.unused + c.unused, sold: acc.sold + c.sold }),
    { total: 0, unused: 0, sold: 0 },
  );

  const runImport = async () => {
    // Guarded twice on purpose: nothing is ever written without a confirmed product.
    if (!selectedProduct || pending.length === 0) return;
    setBusy(true);
    try {
      const res = await importVoucherCodes(selectedProduct.id, pending, fileCodes ? "file" : "paste");
      setResult({ ...res, productName: selectedProduct.name });
      setRaw("");
      setFileCodes(null);
      setFileName("");
      setConfirmOpen(false);
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
      <PageSection devSlot="vouchers.setup-guide">
        <Card
          className={cn(
            "shadow-[var(--shadow-card)]",
            noProducts ? "border-warning bg-warning/10" : "border-border",
          )}
        >
          <CardContent className="space-y-2">
            <p className="flex items-center gap-2 text-sm font-semibold">
              {noProducts ? (
                <AlertTriangle className="size-4 text-warning-foreground" />
              ) : (
                <Info className="size-4 text-primary" />
              )}
              {noProducts
                ? "Set up your voucher products first"
                : "How to upload voucher codes"}
            </p>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Voucher codes always belong to a voucher product. The order is:{" "}
              <strong>1. Set up your voucher products</strong> →{" "}
              <strong>2. Select the product here in Code inventory</strong> →{" "}
              <strong>3. Paste or upload the codes</strong> →{" "}
              <strong>4. Confirm the product</strong> → codes are imported.
            </p>
            {noProducts ? (
              <>
                <p className="text-xs font-medium text-warning-foreground">
                  You have no voucher products yet, so importing codes is disabled. Create at least one
                  product first — otherwise codes have nowhere to go.
                </p>
                <Button size="sm" asChild>
                  <Link to="/admin/products">
                    <Package className="size-4" /> Go to voucher products
                  </Link>
                </Button>
              </>
            ) : null}
          </CardContent>
        </Card>
      </PageSection>

      <PageSection devSlot="vouchers.code-inventory"
        title="Code inventory"
        description="Voucher codes are imported manually. They are never generated or synced from any external system."
        action={
          <Button size="sm" onClick={() => setOpen(true)} disabled={selectableProducts.length === 0}>
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


      <PageSection devSlot="vouchers.per-product" title="Per product">
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
          <TabsTrigger value="imports">Upload batches</TabsTrigger>
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
                      <TableHead>Batch</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Sold at</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {codes.map((c) => (
                      <TableRow key={c.id}>
                        <TableCell className="font-mono text-xs">{c.code}</TableCell>
                        <TableCell className="text-xs">
                          {products.find((p) => p.id === c.product_id)?.name ?? "—"}
                        </TableCell>
                        <TableCell className="font-mono text-[11px] text-muted-foreground">
                          {c.import_id ? c.import_id.slice(0, 8) : "—"}
                        </TableCell>
                        <TableCell>
                          <StatusBadge tone={c.status === "sold" ? "danger" : "success"}>
                            {c.status === "sold" ? "Sold" : "Available"}
                          </StatusBadge>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {c.sold_at ? shortDateTime(c.sold_at) : "—"}
                        </TableCell>
                        <TableCell className="text-right">
                          {canDeleteCode(c) ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-destructive"
                              onClick={() =>
                                setPendingDelete({
                                  kind: "code",
                                  code: c,
                                  batch: batches.find((b) => b.batch_id === c.import_id),
                                })
                              }
                            >
                              <Trash2 className="size-4" />
                            </Button>
                          ) : (
                            <span className="text-[11px] text-muted-foreground">Locked</span>
                          )}
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
          {batches.length === 0 ? (
            <EmptyState title="No uploads yet" />
          ) : (
            <Card className="shadow-[var(--shadow-card)]">
              <CardContent className="px-0 py-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Batch ID</TableHead>
                      <TableHead>Uploaded</TableHead>
                      <TableHead>Product</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead className="text-right">Unused</TableHead>
                      <TableHead className="text-right">Sold/used</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {batches.map((b) => {
                      const blocked = batchDeleteBlockReason(b);
                      return (
                        <TableRow key={b.batch_id}>
                          <TableCell className="font-mono text-[11px]">
                            {b.batch_id.slice(0, 8)}
                          </TableCell>
                          <TableCell className="text-xs">
                            {shortDateTime(b.created_at)}
                            <span className="ml-1 text-muted-foreground">· {b.actor_name}</span>
                          </TableCell>
                          <TableCell className="text-xs">{b.product_name || "—"}</TableCell>
                          <TableCell className="text-right text-xs">{b.total_codes}</TableCell>
                          <TableCell className="text-right text-xs text-success">
                            {b.unused_count}
                          </TableCell>
                          <TableCell className="text-right text-xs text-destructive">
                            {b.sold_count}
                          </TableCell>
                          <TableCell className="text-right">
                            {blocked ? (
                              <span
                                className="text-[11px] text-muted-foreground"
                                title={blocked}
                              >
                                {b.sold_count > 0 ? "Has sold codes" : "Nothing to delete"}
                              </span>
                            ) : (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="text-destructive"
                                onClick={() => setPendingDelete({ kind: "batch", batch: b })}
                              >
                                <Trash2 className="size-4" /> Delete batch
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

        </TabsContent>
      </Tabs>

      <Dialog open={open} onOpenChange={(o) => { if (!busy) setOpen(o); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Import voucher codes</DialogTitle>
            <DialogDescription>
              Step 1 — pick the voucher product these codes belong to. Step 2 — paste one code per line,
              or upload a .txt, .csv or .xlsx with one code per row. Duplicates are detected and skipped
              automatically.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Which product are these codes for?</Label>
              {selectableProducts.length === 0 ? (
                <EmptyState
                  title="No active voucher products"
                  description="Create or unarchive a voucher product before importing codes."
                />
              ) : (
                <div className="grid gap-2 sm:grid-cols-2">
                  {selectableProducts.map((p) => {
                    const c = counts[p.id];
                    const active = p.id === productId;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        aria-pressed={active}
                        onClick={() => setProductId(p.id)}
                        className={cn(
                          "rounded-xl border p-3 text-left transition-colors",
                          active
                            ? "border-primary bg-brand-soft ring-2 ring-primary"
                            : "border-border bg-card hover:border-primary/50",
                        )}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <p className="truncate text-sm font-semibold">{p.name}</p>
                          {active ? <CheckCircle2 className="size-4 shrink-0 text-primary" /> : null}
                        </div>
                        <p className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground">
                          {p.description || "No description"}
                        </p>
                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          <StatusBadge tone="brand">{peso(listPrice(p))}</StatusBadge>
                          <StatusBadge tone={c && c.unused > 0 ? "success" : "muted"}>
                            {(c?.unused ?? 0)} unused
                          </StatusBadge>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
              {selectedProduct ? (
                <p className="rounded-lg bg-brand-soft px-3 py-2 text-xs font-medium text-accent-foreground">
                  Selected product: {selectedProduct.name}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Click a product card above to choose where these codes go.
                </p>
              )}
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
            <Button
              onClick={() => setConfirmOpen(true)}
              disabled={busy || !selectedProduct || pending.length === 0}
            >
              <Upload className="size-4" /> Import codes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmOpen} onOpenChange={(o) => { if (!busy) setConfirmOpen(o); }}>
        <DialogContent className="max-w-[calc(100vw-2rem)] sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="break-words text-balance">
              Import codes under “{selectedProduct?.name ?? ""}”?
            </DialogTitle>
            <DialogDescription className="break-words">
              <strong>
                {pending.length} code{pending.length === 1 ? "" : "s"}
              </strong>{" "}
              will be added to <strong>{selectedProduct?.name ?? ""}</strong>. Choose No to go back
              and pick a different product — nothing is imported until you confirm.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-row justify-end gap-2">
            <Button
              variant="outline"
              className="min-w-20"
              disabled={busy}
              onClick={() => {
                setConfirmOpen(false);
                setProductId("");
                setOpen(true);
              }}
            >
              No
            </Button>
            <Button className="min-w-20" onClick={() => void runImport()} disabled={busy}>
              {busy ? "Importing…" : "Yes"}
            </Button>
          </DialogFooter>

        </DialogContent>
      </Dialog>


      <Dialog open={!!pendingDelete} onOpenChange={(o) => !o && setPendingDelete(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {pendingDelete?.kind === "batch" ? "Delete whole batch?" : "Delete voucher code?"}
            </DialogTitle>
            <DialogDescription>
              This permanently removes unused inventory. Sold codes, sales, balances, commissions,
              points and audit history are never touched.
            </DialogDescription>
          </DialogHeader>
          {pendingDelete ? (
            <dl className="space-y-1.5 rounded-xl bg-muted/50 px-3 py-3 text-xs">
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Codes to delete</dt>
                <dd className="font-medium">
                  {pendingDelete.kind === "batch" ? pendingDelete.batch.unused_count : 1}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Product</dt>
                <dd className="font-medium">
                  {pendingDelete.kind === "batch"
                    ? pendingDelete.batch.product_name || "—"
                    : products.find((p) => p.id === pendingDelete.code.product_id)?.name ?? "—"}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Batch ID</dt>
                <dd className="font-mono">
                  {pendingDelete.kind === "batch"
                    ? pendingDelete.batch.batch_id
                    : pendingDelete.code.import_id ?? "—"}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Uploaded</dt>
                <dd>
                  {pendingDelete.kind === "batch"
                    ? shortDateTime(pendingDelete.batch.created_at)
                    : pendingDelete.batch
                      ? shortDateTime(pendingDelete.batch.created_at)
                      : "—"}
                </dd>
              </div>
              {pendingDelete.kind === "code" ? (
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Code</dt>
                  <dd className="font-mono">{pendingDelete.code.code}</dd>
                </div>
              ) : null}
            </dl>
          ) : null}
          <p className="text-xs text-destructive">
            Deletion is permanent and cannot be undone.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingDelete(null)}>
              Cancel
            </Button>
            <Button variant="destructive" disabled={deleting} onClick={() => void runDelete()}>
              {deleting ? "Deleting…" : "Delete permanently"}
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
