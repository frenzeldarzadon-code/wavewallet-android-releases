/**
 * Retail catalog management for one shop's admin.
 *
 * Every shop starts from the shared Philippine sari-sari starter catalog, but
 * those rows are only templates copied into this shop: nothing reaches a
 * customer until the admin sets their own prices and stock and publishes it.
 * Hiding or archiving never deletes anything, so past orders, ratings and
 * history keep pointing at the same row.
 */
import { Archive, ImageUp, Loader2, Pencil, Plus, Search, Sparkles } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState, PageSection, StatusBadge } from "@/components/ui-kit";
import { RetailImage } from "@/components/retail/retail-image";
import {
  EMPTY_CATALOG_FILTER,
  customerToSeller,
  fetchAllRetailProducts,
  fetchRetailFeePercent,
  filterProducts,
  isProductReady,
  loadStarterCatalog,
  productCategories,
  saveRetailProduct,
  sellerToCustomer,
  setRetailProductArchived,
  setRetailProductPublished,
  uploadRetailImage,
  type CatalogFilter,
  type RetailCashbackMode,
  type RetailProductRow,
} from "@/lib/retail";

interface Draft {
  id?: string;
  name: string;
  description: string;
  category: string;
  brand: string;
  variant: string;
  size_label: string;
  unit: string;
  sku: string;
  barcode: string;
  price: string;
  wholesale_price: string;
  wholesale_min_qty: string;
  cashback_mode: RetailCashbackMode;
  cashback_value: string;
  stock: string;
  image_path: string | null;
  public_visible: boolean;
  active: boolean;
  published: boolean;
}

const empty: Draft = {
  name: "",
  description: "",
  category: "",
  brand: "",
  variant: "",
  size_label: "",
  unit: "piece",
  sku: "",
  barcode: "",
  price: "",
  wholesale_price: "",
  wholesale_min_qty: "0",
  cashback_mode: "disabled",
  cashback_value: "0",
  stock: "0",
  image_path: null,
  public_visible: true,
  active: true,
  published: false,
};

const toDraft = (p: RetailProductRow): Draft => ({
  id: p.id,
  name: p.name,
  description: p.description ?? "",
  category: p.category ?? "",
  brand: p.brand ?? "",
  variant: p.variant ?? "",
  size_label: p.size_label ?? "",
  unit: p.unit || "piece",
  sku: p.sku ?? "",
  barcode: p.barcode ?? "",
  price: String(p.price),
  wholesale_price: String(p.wholesale_price),
  wholesale_min_qty: String(p.wholesale_min_qty ?? 0),
  cashback_mode: p.cashback_mode ?? "disabled",
  cashback_value: String(p.cashback_value ?? 0),
  stock: String(p.stock),
  image_path: p.image_path,
  public_visible: p.public_visible,
  active: p.active,
  published: p.published,
});

const subtitle = (p: RetailProductRow) =>
  [p.brand, p.variant, p.size_label].filter(Boolean).join(" · ");

export function RetailProductsCard({ ecosystemId }: { ecosystemId: string | null }) {
  const [rows, setRows] = useState<RetailProductRow[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [filter, setFilter] = useState<CatalogFilter>(EMPTY_CATALOG_FILTER);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [feePercent, setFeePercent] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchRetailFeePercent().then(setFeePercent).catch(() => setFeePercent(0));
  }, []);

  /** Customer-facing price for a seller amount typed as text. */
  const customerOf = (seller: string) => {
    const n = Number(seller);
    return n > 0 ? sellerToCustomer(n, feePercent) : 0;
  };
  /** Inverse: a customer price typed by the seller becomes the seller amount. */
  const sellerOf = (customer: string) => {
    const n = Number(customer);
    return n > 0 ? String(customerToSeller(n, feePercent)) : "";
  };

  const load = useCallback(async () => {
    if (!ecosystemId) return;
    setLoading(true);
    try {
      setRows(await fetchAllRetailProducts(ecosystemId));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [ecosystemId]);

  useEffect(() => {
    void load();
  }, [load]);

  const categories = useMemo(() => productCategories(rows), [rows]);
  const visible = useMemo(() => filterProducts(rows, filter), [rows, filter]);
  const publishedCount = rows.filter((r) => r.published && !r.archived).length;

  if (!ecosystemId) return null;

  const upload = async (file: File) => {
    if (!draft) return;
    setBusy(true);
    try {
      const path = await uploadRetailImage(ecosystemId, file);
      setDraft({ ...draft, image_path: path });
      toast.success("Photo ready");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const seed = async () => {
    setBusy(true);
    try {
      const added = await loadStarterCatalog(ecosystemId);
      toast.success(
        added === 0
          ? "Starter catalog is already loaded"
          : `${added} starter products added as drafts`,
      );
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!draft) return;
    if (!draft.name.trim()) {
      toast.error("A product needs a name");
      return;
    }
    const price = Number(draft.price) || 0;
    const stock = Number(draft.stock) || 0;
    if (draft.published && (price <= 0 || stock <= 0)) {
      toast.error("Set your retail price and stock before going live");
      return;
    }
    setBusy(true);
    try {
      await saveRetailProduct(ecosystemId, {
        ...(draft.id ? { id: draft.id } : {}),
        name: draft.name,
        description: draft.description,
        category: draft.category,
        brand: draft.brand,
        variant: draft.variant,
        size_label: draft.size_label,
        unit: draft.unit,
        sku: draft.sku,
        barcode: draft.barcode,
        cashback_mode: draft.cashback_mode,
        cashback_value: Number(draft.cashback_value) || 0,
        price,
        wholesale_price: Number(draft.wholesale_price) || 0,
        wholesale_min_qty: Number(draft.wholesale_min_qty) || 0,
        stock,
        image_path: draft.image_path,
        public_visible: draft.public_visible,
        active: draft.active,
        published: draft.published,
      });
      toast.success(draft.id ? "Product updated" : "Product created");
      setDraft(null);
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const togglePublish = async (p: RetailProductRow) => {
    if (!p.published && !isProductReady(p)) {
      toast.error("Add your retail price and stock first");
      setDraft({ ...toDraft(p), published: true });
      return;
    }
    try {
      await setRetailProductPublished(p.id, !p.published);
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <>
      <PageSection devSlot="retail-products-card.retail-products"
        title="Retail products"
        description="Your shop's own listing. Starter products arrive as drafts — set your prices and stock, then go live. Archiving keeps every past order intact."
        action={
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void seed()}>
              <Sparkles className="size-4" /> Load starter catalog
            </Button>
            <Button size="sm" onClick={() => setDraft({ ...empty })}>
              <Plus className="size-4" /> Add product
            </Button>
          </div>
        }
      >
        <div className="mb-3 space-y-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Search name, brand, size, SKU…"
              value={filter.search}
              onChange={(e) => setFilter({ ...filter, search: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <Select
              value={filter.category}
              onValueChange={(v) => setFilter({ ...filter, category: v })}
            >
              <SelectTrigger aria-label="Category">
                <SelectValue placeholder="Category" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All categories</SelectItem>
                {categories.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={filter.status}
              onValueChange={(v) =>
                setFilter({ ...filter, status: v as CatalogFilter["status"] })
              }
            >
              <SelectTrigger aria-label="Status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="published">Live</SelectItem>
                <SelectItem value="draft">Draft</SelectItem>
                <SelectItem value="archived">Archived</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={filter.source}
              onValueChange={(v) =>
                setFilter({ ...filter, source: v as CatalogFilter["source"] })
              }
            >
              <SelectTrigger aria-label="Source">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All products</SelectItem>
                <SelectItem value="catalog">From starter catalog</SelectItem>
                <SelectItem value="manual">Added by me</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <p className="text-[11px] text-muted-foreground">
            {rows.length} products in this shop · {publishedCount} live for customers
          </p>
        </div>

        {loading ? (
          <p className="text-xs text-muted-foreground">Loading products…</p>
        ) : rows.length === 0 ? (
          <EmptyState
            title="No retail products yet"
            description="Load the Philippine sari-sari starter catalog or add your own local product."
          />
        ) : visible.length === 0 ? (
          <EmptyState
            title="Nothing matches those filters"
            description="Try another category, status or search term."
          />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {visible.map((p) => (
              <Card key={p.id} className="overflow-hidden shadow-[var(--shadow-card)]">
                <RetailImage path={p.image_path} alt={p.name} />
                <CardContent className="space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold">{p.name}</p>
                      {subtitle(p) ? (
                        <p className="text-[11px] text-muted-foreground">{subtitle(p)}</p>
                      ) : null}
                    </div>
                    <StatusBadge
                      tone={p.archived ? "muted" : p.published && p.active ? "success" : "warning"}
                    >
                      {p.archived ? "archived" : p.published && p.active ? "live" : "draft"}
                    </StatusBadge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {p.category ?? "Uncategorised"} ·{" "}
                    {p.price > 0
                      ? `${p.price.toLocaleString()} yours · ${sellerToCustomer(p.price, feePercent).toLocaleString()} customer`
                      : "no retail price"}
                    {p.wholesale_price > 0
                      ? ` · ${p.wholesale_price.toLocaleString()} wholesale (${sellerToCustomer(p.wholesale_price, feePercent).toLocaleString()} customer)${
                          (p.wholesale_min_qty ?? 0) > 0 ? ` from ${p.wholesale_min_qty}` : ""
                        }`
                      : ""}{" "}
                    · {p.stock} {p.unit} in stock · {p.sold_count} sold
                    {p.cashback_mode === "percent"
                      ? ` · ${p.cashback_value}% seller cashback`
                      : p.cashback_mode === "fixed"
                        ? ` · ${p.cashback_value.toLocaleString()} coins/unit seller cashback`
                        : ""}
                    {p.public_visible ? " · visible to visitors" : " · members only"}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={() => setDraft(toDraft(p))}>
                      <Pencil className="size-4" /> Edit
                    </Button>
                    {!p.archived ? (
                      <Button
                        size="sm"
                        variant={p.published ? "outline" : "default"}
                        onClick={() => void togglePublish(p)}
                      >
                        {p.published ? "Unpublish" : "Go live"}
                      </Button>
                    ) : null}
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={async () => {
                        try {
                          await setRetailProductArchived(p.id, !p.archived);
                          await load();
                        } catch (e) {
                          toast.error((e as Error).message);
                        }
                      }}
                    >
                      <Archive className="size-4" /> {p.archived ? "Restore" : "Archive"}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </PageSection>

      <Dialog open={!!draft} onOpenChange={(o) => !o && setDraft(null)}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{draft?.id ? "Edit product" : "New product"}</DialogTitle>
            <DialogDescription>
              Products, stock and prices belong to this shop only.
            </DialogDescription>
          </DialogHeader>
          {draft ? (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="rp-name">Name</Label>
                <Input
                  id="rp-name"
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="rp-category">Category</Label>
                  <Input
                    id="rp-category"
                    list="rp-categories"
                    value={draft.category}
                    onChange={(e) => setDraft({ ...draft, category: e.target.value })}
                  />
                  <datalist id="rp-categories">
                    {categories.map((c) => (
                      <option key={c} value={c} />
                    ))}
                  </datalist>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="rp-brand">Brand</Label>
                  <Input
                    id="rp-brand"
                    value={draft.brand}
                    onChange={(e) => setDraft({ ...draft, brand: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="rp-variant">Variant / flavour</Label>
                  <Input
                    id="rp-variant"
                    value={draft.variant}
                    onChange={(e) => setDraft({ ...draft, variant: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="rp-size">Size / packaging</Label>
                  <Input
                    id="rp-size"
                    placeholder="e.g. 155 g"
                    value={draft.size_label}
                    onChange={(e) => setDraft({ ...draft, size_label: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="rp-unit">Unit of measure</Label>
                  <Input
                    id="rp-unit"
                    placeholder="piece, pack, kilogram…"
                    value={draft.unit}
                    onChange={(e) => setDraft({ ...draft, unit: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="rp-sku">SKU</Label>
                  <Input
                    id="rp-sku"
                    value={draft.sku}
                    onChange={(e) => setDraft({ ...draft, sku: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="rp-barcode">Barcode</Label>
                  <Input
                    id="rp-barcode"
                    value={draft.barcode}
                    onChange={(e) => setDraft({ ...draft, barcode: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="rp-stock">Stock</Label>
                  <Input
                    id="rp-stock"
                    type="number"
                    inputMode="numeric"
                    value={draft.stock}
                    onChange={(e) => setDraft({ ...draft, stock: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="rp-wholesale">Wholesale — your amount (coins)</Label>
                  <Input
                    id="rp-wholesale"
                    type="number"
                    inputMode="decimal"
                    value={draft.wholesale_price}
                    onChange={(e) => setDraft({ ...draft, wholesale_price: e.target.value })}
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Customer pays {customerOf(draft.wholesale_price).toLocaleString()} each
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="rp-wholesale-min">Wholesale minimum quantity</Label>
                  <Input
                    id="rp-wholesale-min"
                    type="number"
                    inputMode="numeric"
                    placeholder="e.g. 12"
                    value={draft.wholesale_min_qty}
                    onChange={(e) => setDraft({ ...draft, wholesale_min_qty: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="rp-price">Retail — your amount (coins)</Label>
                  <Input
                    id="rp-price"
                    type="number"
                    inputMode="decimal"
                    value={draft.price}
                    onChange={(e) => setDraft({ ...draft, price: e.target.value })}
                  />
                  <p className="text-[11px] text-muted-foreground">
                    What you receive per unit. The {feePercent}% platform fee is added on top.
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="rp-customer-price">Retail — customer pays (coins)</Label>
                  <Input
                    id="rp-customer-price"
                    type="number"
                    inputMode="decimal"
                    value={draft.price ? customerOf(draft.price) : ""}
                    onChange={(e) => setDraft({ ...draft, price: sellerOf(e.target.value) })}
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Type either field; the other follows. The fee applies to the price actually
                    charged (wholesale when the minimum quantity is reached).
                  </p>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rp-desc">Short description</Label>
                <Textarea
                  id="rp-desc"
                  rows={2}
                  value={draft.description}
                  onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                />
              </div>
              <RetailImage path={draft.image_path} alt="Product photo" className="rounded-xl" />
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void upload(f);
                  e.target.value = "";
                }}
              />
              <Button
                type="button"
                variant="outline"
                className="w-full"
                disabled={busy}
                onClick={() => fileRef.current?.click()}
              >
                <ImageUp className="size-4" /> Upload photo
              </Button>
              <div className="flex items-center justify-between rounded-xl border border-border px-3 py-2">
                <Label htmlFor="rp-live">Available to buy</Label>
                <Switch
                  id="rp-live"
                  checked={draft.active}
                  onCheckedChange={(v) => setDraft({ ...draft, active: v })}
                />
              </div>
              <div className="flex items-center justify-between rounded-xl border border-border px-3 py-2">
                <Label htmlFor="rp-public">Show on the public storefront</Label>
                <Switch
                  id="rp-public"
                  checked={draft.public_visible}
                  onCheckedChange={(v) => setDraft({ ...draft, public_visible: v })}
                />
              </div>
              <div className="flex items-center justify-between rounded-xl border border-border px-3 py-2">
                <div className="min-w-0">
                  <Label htmlFor="rp-published">Ready to go live</Label>
                  <p className="text-[11px] text-muted-foreground">
                    Customers only see this once it is published with a price and stock.
                  </p>
                </div>
                <Switch
                  id="rp-published"
                  checked={draft.published}
                  onCheckedChange={(v) => setDraft({ ...draft, published: v })}
                />
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDraft(null)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={() => void save()} disabled={busy}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : null} Save product
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
