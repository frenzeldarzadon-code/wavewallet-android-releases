/**
 * Retail catalog management for one shop's admin (the Retail seller).
 *
 * Every shop starts from the shared Philippine sari-sari starter catalog, but
 * those rows are only templates copied into this shop: nothing reaches a
 * customer until the admin sets their own prices and stock and publishes it.
 * Hiding or archiving never deletes anything, so past orders, ratings and
 * history keep pointing at the same row.
 *
 * Pricing is the locked Retail model: the seller types either the Seller's
 * Cut (fee excluded) or the Retail Price (fee embedded once) and the other
 * follows via the existing helpers; the database RPCs remain authoritative.
 */
import {
  Archive,
  Copy,
  Eye,
  ImageUp,
  Loader2,
  Pencil,
  Plus,
  Search,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState, PageSection, StatusBadge } from "@/components/ui-kit";
import { ProductDetailSheet } from "@/components/retail/marketplace";
import { RetailImage } from "@/components/retail/retail-image";
import {
  DEFAULT_STORE_SETTINGS,
  EMPTY_CATALOG_FILTER,
  fetchAllRetailProducts,
  fetchRetailFeePercent,
  fetchStoreSettings,
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
  type RetailProduct,
  type RetailProductRow,
  type StoreSettings,
} from "@/lib/retail";
import {
  EMPTY_PRODUCT_DRAFT,
  duplicateDraft,
  normalizeStock,
  retailPriceOf,
  sellerCutOf,
  validateProductDraft,
  type ProductDraft,
} from "@/lib/retail-product-form";
import { useSession } from "@/lib/session";
import { cn } from "@/lib/utils";
import { peso } from "@/lib/wavewallet";

const toDraft = (p: RetailProductRow): ProductDraft => ({
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
  price: p.price > 0 ? String(p.price) : "",
  wholesale_price: p.wholesale_price > 0 ? String(p.wholesale_price) : "",
  wholesale_min_qty: (p.wholesale_min_qty ?? 0) > 0 ? String(p.wholesale_min_qty) : "",
  cashback_mode: p.cashback_mode ?? "disabled",
  cashback_value: String(p.cashback_value ?? 0),
  stock: String(p.stock),
  image_path: p.image_path,
  public_visible: p.public_visible,
  active: p.active,
  published: p.published,
});

/** What the customer marketplace would render for this draft. */
const previewProduct = (d: ProductDraft, sold = 0): RetailProduct => ({
  id: d.id ?? "preview",
  name: d.name.trim() || "Untitled product",
  description: d.description.trim() || null,
  image_path: d.image_path,
  price: Number(d.price) || 0,
  stock: normalizeStock(d.stock),
  sold_count: sold,
  public_visible: d.public_visible,
  rating_avg: 0,
  rating_count: 0,
  brand: d.brand || null,
  variant: d.variant || null,
  size_label: d.size_label || null,
  unit: d.unit || null,
  category: d.category || null,
  wholesale_price: Number(d.wholesale_price) || 0,
  wholesale_min_qty: Number(d.wholesale_min_qty) || 0,
});

const subtitle = (p: RetailProductRow) =>
  [p.brand, p.variant, p.size_label].filter(Boolean).join(" · ");

const statusOf = (p: RetailProductRow) =>
  p.archived
    ? { tone: "muted" as const, label: "Archived" }
    : p.published && p.active
      ? { tone: "success" as const, label: "Live" }
      : p.published
        ? { tone: "warning" as const, label: "Paused" }
        : { tone: "warning" as const, label: "Draft" };

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3 rounded-2xl border border-border bg-card p-4 shadow-[var(--shadow-card)]">
      <div>
        <h3 className="text-sm font-semibold">{title}</h3>
        {hint ? <p className="text-[11px] text-muted-foreground">{hint}</p> : null}
      </div>
      {children}
    </section>
  );
}

function Field({
  id,
  label,
  error,
  hint,
  children,
}: {
  id: string;
  label: string;
  error?: string | undefined;
  hint?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error ? (
        <p className="text-[11px] text-destructive" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="text-[11px] text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

export function RetailProductsCard({ ecosystemId }: { ecosystemId: string | null }) {
  const { ecosystem } = useSession();
  const [rows, setRows] = useState<RetailProductRow[]>([]);
  const [draft, setDraft] = useState<ProductDraft | null>(null);
  const [preview, setPreview] = useState<RetailProduct | null>(null);
  const [attempted, setAttempted] = useState(false);
  const [filter, setFilter] = useState<CatalogFilter>(EMPTY_CATALOG_FILTER);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [feePercent, setFeePercent] = useState(0);
  const [settings, setSettings] = useState<StoreSettings | null>(null);
  const [priceMode, setPriceMode] = useState<"cut" | "retail">("cut");
  /** Retail Price as typed; kept separate so the seller's keystrokes are not re-rounded. */
  const [retailText, setRetailText] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchRetailFeePercent()
      .then(setFeePercent)
      .catch(() => setFeePercent(0));
  }, []);

  useEffect(() => {
    if (!ecosystemId) return;
    fetchStoreSettings(ecosystemId)
      .then(setSettings)
      .catch(() => setSettings(null));
  }, [ecosystemId]);

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
  const liveCount = rows.filter((r) => r.published && r.active && !r.archived).length;
  const lowStock = rows.filter(
    (r) => r.published && !r.archived && r.stock > 0 && r.stock <= 3,
  ).length;
  const outOfStock = rows.filter((r) => r.published && !r.archived && r.stock === 0).length;

  const problems = useMemo(() => (draft ? validateProductDraft(draft) : []), [draft]);
  const errorFor = (field: keyof ProductDraft) =>
    attempted ? problems.find((p) => p.field === field)?.message : undefined;

  if (!ecosystemId) return null;

  const openDraft = (d: ProductDraft) => {
    setAttempted(false);
    setPriceMode("cut");
    setDraft(d);
  };

  const upload = async (file: File) => {
    if (!draft) return;
    setUploading(true);
    try {
      const path = await uploadRetailImage(ecosystemId, file);
      setDraft((d) => (d ? { ...d, image_path: path } : d));
      toast.success("Photo ready — it is compressed and cropped for the marketplace");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setUploading(false);
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

  const persist = async (d: ProductDraft, successMessage: string) => {
    setBusy(true);
    try {
      await saveRetailProduct(ecosystemId, {
        ...(d.id ? { id: d.id } : {}),
        name: d.name,
        description: d.description,
        category: d.category,
        brand: d.brand,
        variant: d.variant,
        size_label: d.size_label,
        unit: d.unit,
        sku: d.sku,
        barcode: d.barcode,
        cashback_mode: d.cashback_mode,
        cashback_value: Number(d.cashback_value) || 0,
        price: Number(d.price) || 0,
        wholesale_price: Number(d.wholesale_price) || 0,
        wholesale_min_qty: Number(d.wholesale_min_qty) || 0,
        stock: normalizeStock(d.stock),
        image_path: d.image_path,
        public_visible: d.public_visible,
        active: d.active,
        published: d.published,
      });
      toast.success(successMessage);
      await load();
      return true;
    } catch (e) {
      toast.error((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!draft) return;
    setAttempted(true);
    if (problems.length > 0) {
      toast.error(problems[0]!.message);
      return;
    }
    const ok = await persist(
      draft,
      draft.id ? "Product updated" : draft.published ? "Product is live" : "Product saved as draft",
    );
    if (ok) setDraft(null);
  };

  const duplicate = async (p: RetailProductRow) => {
    if (busy) return;
    await persist(duplicateDraft(toDraft(p)), `Copied "${p.name}" as a draft`);
  };

  const togglePublish = async (p: RetailProductRow) => {
    if (!p.published && !isProductReady(p)) {
      toast.error("Add your price and stock first");
      openDraft({ ...toDraft(p), published: true });
      return;
    }
    try {
      await setRetailProductPublished(p.id, !p.published);
      toast.success(p.published ? "Hidden from customers" : "Live for customers");
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const toggleArchive = async (p: RetailProductRow) => {
    try {
      await setRetailProductArchived(p.id, !p.archived);
      toast.success(p.archived ? "Product restored as a draft" : "Product archived");
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const retailPrice = draft ? retailPriceOf(draft.price, feePercent) : 0;
  const sellerCut = draft ? Number(draft.price) || 0 : 0;
  const bulkRetail = draft ? retailPriceOf(draft.wholesale_price, feePercent) : 0;
  const shopName = ecosystem?.name ?? "This shop";
  const previewSettings: StoreSettings = settings ?? DEFAULT_STORE_SETTINGS;

  return (
    <>
      <PageSection
        devSlot="retail-products-card.retail-products"
        title="Retail products"
        description="Your shop's own listing. Customers only ever see the Retail Price — your Seller's Cut and the platform fee stay private."
        action={
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void seed()}>
              <Sparkles className="size-4" /> Starter catalog
            </Button>
            <Button size="sm" onClick={() => openDraft({ ...EMPTY_PRODUCT_DRAFT })}>
              <Plus className="size-4" /> Add product
            </Button>
          </div>
        }
      >
        <div className="mb-3 grid grid-cols-3 gap-2">
          {[
            { label: "Live", value: liveCount, tone: "text-success" },
            { label: "Low stock", value: lowStock, tone: "text-warning" },
            { label: "Sold out", value: outOfStock, tone: "text-destructive" },
          ].map((s) => (
            <div key={s.label} className="rounded-xl border border-border bg-card px-3 py-2">
              <p className="text-[11px] text-muted-foreground">{s.label}</p>
              <p className={cn("text-lg font-bold leading-tight", s.value > 0 ? s.tone : "")}>
                {s.value}
              </p>
            </div>
          ))}
        </div>

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
              onValueChange={(v) => setFilter({ ...filter, status: v as CatalogFilter["status"] })}
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
              onValueChange={(v) => setFilter({ ...filter, source: v as CatalogFilter["source"] })}
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
            {rows.length} products in this shop · {liveCount} live for customers
          </p>
        </div>

        {loading ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-28 animate-pulse rounded-2xl bg-muted" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            title="No retail products yet"
            description="Load the Philippine sari-sari starter catalog or add your own product."
          />
        ) : visible.length === 0 ? (
          <EmptyState
            title="Nothing matches those filters"
            description="Try another category, status or search term."
          />
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {visible.map((p) => {
              const status = statusOf(p);
              return (
                <li
                  key={p.id}
                  className={cn(
                    "overflow-hidden rounded-2xl border border-border bg-card shadow-[var(--shadow-card)]",
                    p.archived && "opacity-70",
                  )}
                >
                  <div className="flex gap-3 p-3">
                    <RetailImage
                      path={p.image_path}
                      alt={p.name}
                      className="size-24 shrink-0 rounded-xl"
                    />
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold">{p.name}</p>
                          <p className="truncate text-[11px] text-muted-foreground">
                            {[p.category ?? "Uncategorised", subtitle(p)]
                              .filter(Boolean)
                              .join(" · ")}
                          </p>
                        </div>
                        <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
                      </div>
                      <div className="flex flex-wrap items-baseline gap-x-2">
                        <span className="text-base font-bold text-primary">
                          {p.price > 0 ? peso(sellerToCustomer(p.price, feePercent)) : "No price"}
                        </span>
                        {p.price > 0 ? (
                          <span className="text-[11px] text-muted-foreground">
                            you keep {peso(p.price)}
                          </span>
                        ) : null}
                      </div>
                      <p className="text-[11px] text-muted-foreground">
                        <span
                          className={cn(
                            p.stock === 0
                              ? "font-medium text-destructive"
                              : p.stock <= 3
                                ? "font-medium text-warning"
                                : "",
                          )}
                        >
                          {p.stock} {p.unit} in stock
                        </span>
                        {" · "}
                        {p.sold_count} sold
                        {p.wholesale_price > 0 && (p.wholesale_min_qty ?? 0) > 0
                          ? ` · bulk ${peso(sellerToCustomer(p.wholesale_price, feePercent))} from ${p.wholesale_min_qty}`
                          : ""}
                        {!p.public_visible ? " · members only" : ""}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5 border-t border-border bg-muted/40 px-3 py-2">
                    <Button size="sm" variant="outline" onClick={() => openDraft(toDraft(p))}>
                      <Pencil className="size-3.5" /> Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setPreview(previewProduct(toDraft(p), p.sold_count))}
                    >
                      <Eye className="size-3.5" /> Preview
                    </Button>
                    {!p.archived ? (
                      <Button
                        size="sm"
                        variant={p.published ? "ghost" : "default"}
                        onClick={() => void togglePublish(p)}
                      >
                        {p.published ? "Unpublish" : "Go live"}
                      </Button>
                    ) : null}
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => void duplicate(p)}
                    >
                      <Copy className="size-3.5" /> Duplicate
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="ml-auto"
                      onClick={() => void toggleArchive(p)}
                    >
                      <Archive className="size-3.5" /> {p.archived ? "Restore" : "Archive"}
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </PageSection>

      {/* ---------------- Editor ---------------- */}
      <Sheet open={!!draft} onOpenChange={(o) => !o && !busy && setDraft(null)}>
        <SheetContent
          side="bottom"
          className="mx-auto flex h-[96dvh] w-full flex-col gap-0 rounded-t-3xl p-0 sm:max-w-2xl"
        >
          {draft ? (
            <>
              <SheetHeader className="border-b border-border px-4 py-3 text-left">
                <SheetTitle>{draft.id ? "Edit product" : "New product"}</SheetTitle>
                <SheetDescription className="text-xs">
                  Belongs to {shopName} only. Customers see the Retail Price; your Seller's Cut
                  stays private.
                </SheetDescription>
              </SheetHeader>

              <div className="flex-1 space-y-3 overflow-y-auto bg-muted/30 p-4">
                <Section
                  title="Photo"
                  hint="One square photo, compressed on your phone before upload (JPEG, PNG or WebP)."
                >
                  <div className="flex items-center gap-3">
                    <RetailImage
                      path={draft.image_path}
                      alt="Product photo"
                      className="size-28 shrink-0 rounded-xl"
                    />
                    <div className="flex flex-1 flex-col gap-2">
                      <input
                        ref={fileRef}
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
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
                        disabled={uploading}
                        onClick={() => fileRef.current?.click()}
                      >
                        {uploading ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <ImageUp className="size-4" />
                        )}
                        {draft.image_path ? "Replace photo" : "Upload photo"}
                      </Button>
                      {draft.image_path ? (
                        <Button
                          type="button"
                          variant="ghost"
                          className="text-destructive"
                          disabled={uploading}
                          onClick={() => setDraft({ ...draft, image_path: null })}
                        >
                          <Trash2 className="size-4" /> Remove photo
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </Section>

                <Section title="Basics">
                  <Field id="rp-name" label="Product name" error={errorFor("name")}>
                    <Input
                      id="rp-name"
                      autoFocus={!draft.id}
                      placeholder="e.g. Jasmine rice"
                      value={draft.name}
                      onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                    />
                  </Field>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field
                      id="rp-category"
                      label="Category"
                      hint="Pick an existing category or type a new one."
                    >
                      <Input
                        id="rp-category"
                        list="rp-categories"
                        placeholder="e.g. Rice & grains"
                        value={draft.category}
                        onChange={(e) => setDraft({ ...draft, category: e.target.value })}
                      />
                      <datalist id="rp-categories">
                        {categories
                          .filter((c) => c !== "Uncategorised")
                          .map((c) => (
                            <option key={c} value={c} />
                          ))}
                      </datalist>
                    </Field>
                    <Field id="rp-brand" label="Brand">
                      <Input
                        id="rp-brand"
                        value={draft.brand}
                        onChange={(e) => setDraft({ ...draft, brand: e.target.value })}
                      />
                    </Field>
                    <Field id="rp-variant" label="Variant / flavour">
                      <Input
                        id="rp-variant"
                        value={draft.variant}
                        onChange={(e) => setDraft({ ...draft, variant: e.target.value })}
                      />
                    </Field>
                    <Field id="rp-size" label="Size / packaging">
                      <Input
                        id="rp-size"
                        placeholder="e.g. 1 kg"
                        value={draft.size_label}
                        onChange={(e) => setDraft({ ...draft, size_label: e.target.value })}
                      />
                    </Field>
                  </div>
                  <Field id="rp-desc" label="Short description">
                    <Textarea
                      id="rp-desc"
                      rows={2}
                      placeholder="What customers should know at a glance."
                      value={draft.description}
                      onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                    />
                  </Field>
                </Section>

                <Section
                  title="Pricing"
                  hint={`Type either amount; the other follows. The ${feePercent}% platform fee is inside the Retail Price only — never on delivery.`}
                >
                  <div className="grid grid-cols-2 gap-1 rounded-xl bg-muted p-1">
                    {(
                      [
                        ["cut", "Set Seller's Cut"],
                        ["retail", "Set Retail Price"],
                      ] as const
                    ).map(([mode, label]) => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => {
                          if (mode === "retail") {
                            const r = retailPriceOf(draft.price, feePercent);
                            setRetailText(r > 0 ? String(r) : "");
                          }
                          setPriceMode(mode);
                        }}
                        className={cn(
                          "rounded-lg px-2 py-1.5 text-xs font-medium transition",
                          priceMode === mode
                            ? "bg-card text-foreground shadow-sm"
                            : "text-muted-foreground",
                        )}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  {priceMode === "cut" ? (
                    <Field
                      key="cut"
                      id="rp-price"
                      label="Seller's Cut per unit (₱)"
                      error={errorFor("price")}
                      hint="What your shop keeps per unit before cashback. Fee excluded."
                    >
                      <Input
                        id="rp-price"
                        type="number"
                        inputMode="decimal"
                        min={0}
                        step="0.01"
                        placeholder="100"
                        value={draft.price}
                        onChange={(e) => setDraft({ ...draft, price: e.target.value })}
                      />
                    </Field>
                  ) : (
                    <Field
                      key="retail"
                      id="rp-customer-price"
                      label="Retail Price per unit (₱)"
                      error={errorFor("price")}
                      hint="What the customer pays. The platform fee is already inside."
                    >
                      <Input
                        id="rp-customer-price"
                        type="number"
                        inputMode="decimal"
                        min={0}
                        step="0.01"
                        placeholder="101"
                        value={retailText}
                        onChange={(e) => {
                          setRetailText(e.target.value);
                          setDraft({ ...draft, price: sellerCutOf(e.target.value, feePercent) });
                        }}
                      />
                    </Field>
                  )}
                  <div className="grid grid-cols-3 gap-2 rounded-xl border border-border bg-muted/40 p-3 text-center">
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                        Seller's Cut
                      </p>
                      <p className="text-sm font-semibold">{peso(sellerCut)}</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                        Platform fee
                      </p>
                      <p className="text-sm font-semibold">
                        {peso(Math.round((retailPrice - sellerCut) * 100) / 100)}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                        Customer pays
                      </p>
                      <p className="text-sm font-bold text-primary">{peso(retailPrice)}</p>
                    </div>
                  </div>

                  <div className="space-y-3 rounded-xl border border-dashed border-border p-3">
                    <div>
                      <p className="text-sm font-medium">Bulk price (optional)</p>
                      <p className="text-[11px] text-muted-foreground">
                        A lower Seller's Cut per unit when a customer orders at least the minimum
                        quantity. The same fee rule applies to whichever price is charged.
                      </p>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <Field
                        id="rp-wholesale"
                        label="Bulk Seller's Cut (₱)"
                        error={errorFor("wholesale_price")}
                        hint={bulkRetail > 0 ? `Customer pays ${peso(bulkRetail)} each` : undefined}
                      >
                        <Input
                          id="rp-wholesale"
                          type="number"
                          inputMode="decimal"
                          min={0}
                          step="0.01"
                          value={draft.wholesale_price}
                          onChange={(e) => setDraft({ ...draft, wholesale_price: e.target.value })}
                        />
                      </Field>
                      <Field
                        id="rp-wholesale-min"
                        label="From quantity"
                        error={errorFor("wholesale_min_qty")}
                      >
                        <Input
                          id="rp-wholesale-min"
                          type="number"
                          inputMode="numeric"
                          min={2}
                          placeholder="e.g. 12"
                          value={draft.wholesale_min_qty}
                          onChange={(e) =>
                            setDraft({ ...draft, wholesale_min_qty: e.target.value })
                          }
                        />
                      </Field>
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field
                      id="rp-cashback-mode"
                      label="Reseller cashback"
                      hint="Paid to the storefront Reseller out of your Seller's Cut. Retail has no Subreseller level."
                    >
                      <Select
                        value={draft.cashback_mode}
                        onValueChange={(v) =>
                          setDraft({ ...draft, cashback_mode: v as RetailCashbackMode })
                        }
                      >
                        <SelectTrigger id="rp-cashback-mode">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="disabled">None</SelectItem>
                          <SelectItem value="percent">Percent of amount paid</SelectItem>
                          <SelectItem value="fixed">Fixed ₱ per unit</SelectItem>
                        </SelectContent>
                      </Select>
                    </Field>
                    {draft.cashback_mode !== "disabled" ? (
                      <Field
                        id="rp-cashback-value"
                        label={
                          draft.cashback_mode === "percent" ? "Cashback %" : "Cashback ₱ per unit"
                        }
                        error={errorFor("cashback_value")}
                      >
                        <Input
                          id="rp-cashback-value"
                          type="number"
                          inputMode="decimal"
                          min={0}
                          max={draft.cashback_mode === "percent" ? 100 : undefined}
                          value={draft.cashback_value}
                          onChange={(e) => setDraft({ ...draft, cashback_value: e.target.value })}
                        />
                      </Field>
                    ) : null}
                  </div>
                </Section>

                <Section title="Stock & availability">
                  <div className="grid grid-cols-2 gap-3">
                    <Field
                      id="rp-stock"
                      label="Units in stock"
                      error={errorFor("stock")}
                      hint="Whole units; the shop never sells below zero."
                    >
                      <Input
                        id="rp-stock"
                        type="number"
                        inputMode="numeric"
                        min={0}
                        step={1}
                        value={draft.stock}
                        onChange={(e) => setDraft({ ...draft, stock: e.target.value })}
                      />
                    </Field>
                    <Field id="rp-unit" label="Unit of measure">
                      <Input
                        id="rp-unit"
                        placeholder="piece, pack, kg…"
                        value={draft.unit}
                        onChange={(e) => setDraft({ ...draft, unit: e.target.value })}
                      />
                    </Field>
                    <Field id="rp-sku" label="SKU (optional)">
                      <Input
                        id="rp-sku"
                        value={draft.sku}
                        onChange={(e) => setDraft({ ...draft, sku: e.target.value })}
                      />
                    </Field>
                    <Field id="rp-barcode" label="Barcode (optional)">
                      <Input
                        id="rp-barcode"
                        value={draft.barcode}
                        onChange={(e) => setDraft({ ...draft, barcode: e.target.value })}
                      />
                    </Field>
                  </div>
                  <div className="flex items-center justify-between rounded-xl border border-border px-3 py-2">
                    <div>
                      <Label htmlFor="rp-live">Available to buy</Label>
                      <p className="text-[11px] text-muted-foreground">
                        Turn off to pause sales without unpublishing.
                      </p>
                    </div>
                    <Switch
                      id="rp-live"
                      checked={draft.active}
                      onCheckedChange={(v) => setDraft({ ...draft, active: v })}
                    />
                  </div>
                </Section>

                <Section title="Visibility">
                  <div className="flex items-center justify-between rounded-xl border border-border px-3 py-2">
                    <div>
                      <Label htmlFor="rp-public">Show on the public storefront</Label>
                      <p className="text-[11px] text-muted-foreground">Off means members only.</p>
                    </div>
                    <Switch
                      id="rp-public"
                      checked={draft.public_visible}
                      onCheckedChange={(v) => setDraft({ ...draft, public_visible: v })}
                    />
                  </div>
                  <div className="flex items-center justify-between rounded-xl border border-border px-3 py-2">
                    <div className="min-w-0">
                      <Label htmlFor="rp-published">Published</Label>
                      <p className="text-[11px] text-muted-foreground">
                        Customers only see it once published with a price and stock.
                      </p>
                    </div>
                    <Switch
                      id="rp-published"
                      checked={draft.published}
                      onCheckedChange={(v) => setDraft({ ...draft, published: v })}
                    />
                  </div>
                </Section>
              </div>

              <div className="flex items-center gap-2 border-t border-border bg-card p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
                <Button
                  variant="outline"
                  size="icon"
                  aria-label="Preview as customer"
                  onClick={() => setPreview(previewProduct(draft))}
                >
                  <Eye className="size-4" />
                </Button>
                <Button variant="ghost" onClick={() => setDraft(null)} disabled={busy}>
                  Cancel
                </Button>
                <Button className="flex-1" onClick={() => void save()} disabled={busy || uploading}>
                  {busy ? <Loader2 className="size-4 animate-spin" /> : null}
                  {draft.published ? "Save & keep live" : "Save product"}
                </Button>
              </div>
            </>
          ) : null}
        </SheetContent>
      </Sheet>

      {/* ---------------- Customer preview (same component customers use) ---------------- */}
      <ProductDetailSheet
        product={preview}
        feePercent={feePercent}
        settings={previewSettings}
        quantity={0}
        onChange={() => undefined}
        onClose={() => setPreview(null)}
        onBuyNow={() => undefined}
        shopName={shopName}
        footer={
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              Customer preview — this is exactly what shoppers see.
            </p>
            <Button variant="outline" onClick={() => setPreview(null)}>
              Close preview
            </Button>
          </div>
        }
      />
    </>
  );
}
