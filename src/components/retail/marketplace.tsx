/**
 * Customer-facing Retail marketplace building blocks.
 *
 * Presentation only. Every peso shown here is the existing customer Retail
 * Price (`sellerToCustomer`, fee already inside) or a server-provided COD
 * quote; nothing is recomputed differently and the internal Seller's Cut /
 * platform-fee split never reaches this layer's copy.
 */
import {
  ChevronRight,
  Minus,
  PackageOpen,
  Plus,
  Search,
  ShoppingBag,
  ShoppingCart,
  SlidersHorizontal,
  Store,
  Trash2,
  Truck,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { RatingStars } from "@/components/rating-stars";
import { RetailImage } from "@/components/retail/retail-image";
import { StatusBadge } from "@/components/ui-kit";
import {
  CATALOG_SORT_LABELS,
  availabilityLabel,
  productSubtitle,
  type CatalogCategory,
  type CatalogQuery,
  type CatalogSort,
} from "@/lib/retail-catalog";
import {
  sellerToCustomer,
  type CartLine,
  type CartQuote,
  type RetailProduct,
  type StoreSettings,
} from "@/lib/retail";
import { cn } from "@/lib/utils";
import { peso } from "@/lib/wavewallet";

/* ------------------------------------------------------------------ */
/* Header / search                                                     */
/* ------------------------------------------------------------------ */

export function MarketplaceHeader({
  shopName,
  description,
  productCount,
  search,
  onSearch,
  cartCount,
  onOpenCart,
  aside,
  logoPath,
  coverPath,
  acceptingOrders = true,
  pausedNote,
  backLink,
}: {
  shopName: string;
  description?: string | null | undefined;
  productCount: number;
  search?: string;
  onSearch?: (v: string) => void;
  cartCount?: number;
  onOpenCart?: () => void;
  aside?: React.ReactNode;
  /** Seller-set storefront identity (shown as-is; never edited here). */
  logoPath?: string | null;
  coverPath?: string | null;
  acceptingOrders?: boolean;
  pausedNote?: string | null;
  /** "Back to marketplace" style navigation rendered above the title. */
  backLink?: React.ReactNode;
}) {
  return (
    <section className="shop-hero relative overflow-hidden rounded-3xl px-4 pb-4 pt-5 text-primary-foreground shadow-[var(--shadow-float)] sm:px-6">
      {coverPath ? (
        <RetailImage
          path={coverPath}
          alt=""
          className="pointer-events-none absolute inset-0 aspect-auto h-full opacity-35 [&_img]:object-cover"
        />
      ) : null}
      <div className="shop-grid pointer-events-none absolute inset-0 opacity-60" aria-hidden />
      <div
        className="pointer-events-none absolute -right-16 -top-20 size-56 rounded-full bg-[oklch(0.72_0.14_205_/_0.28)] blur-2xl"
        aria-hidden
      />
      <div className="relative space-y-4">
        {backLink ? <div className="text-xs opacity-90">{backLink}</div> : null}
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
          <div className="flex min-w-0 items-start gap-3">
            {logoPath ? (
              <RetailImage
                path={logoPath}
                alt={`${shopName} logo`}
                className="size-14 shrink-0 rounded-2xl border-2 border-background/60 shadow-[var(--shadow-card)] sm:size-16 aspect-square"
              />
            ) : (
              <div
                className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-background/20 sm:size-16"
                aria-hidden
              >
                <Store className="size-7" />
              </div>
            )}
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.22em] opacity-80">
                Retail shop
              </p>
              <h1 className="truncate text-2xl font-bold leading-tight sm:text-3xl">{shopName}</h1>
              <p className="mt-1 line-clamp-2 text-xs opacity-80">
                {description?.trim() ||
                  `${productCount} product${productCount === 1 ? "" : "s"} · pickup or delivery`}
              </p>
              <p className="mt-1 text-[11px] font-medium opacity-80">
                {productCount} product{productCount === 1 ? "" : "s"}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {aside}
            {onOpenCart ? (
              <Button
                type="button"
                size="icon"
                variant="secondary"
                className="relative size-10 rounded-full"
                aria-label={`Open cart, ${cartCount ?? 0} item${cartCount === 1 ? "" : "s"}`}
                onClick={onOpenCart}
              >
                <ShoppingCart className="size-5" />
                {(cartCount ?? 0) > 0 ? (
                  <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
                    {(cartCount ?? 0) > 99 ? "99+" : cartCount}
                  </span>
                ) : null}
              </Button>
            ) : null}
          </div>
        </div>
        {!acceptingOrders ? (
          <div
            role="status"
            className="rounded-2xl border border-warning/50 bg-warning/20 px-3 py-2 text-xs"
          >
            <p className="font-semibold">Temporarily closed for new orders</p>
            <p className="opacity-90">
              {pausedNote?.trim() || "You can still browse. Orders you already placed continue as normal."}
            </p>
          </div>
        ) : null}
        {onSearch ? (
        <label className="relative block">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            type="search"
            inputMode="search"
            enterKeyHint="search"
            value={search ?? ""}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Search products, brands…"
            aria-label="Search products"
            className="h-11 rounded-2xl border-0 bg-background pl-9 pr-9 text-foreground shadow-[var(--shadow-card)]"
          />
          {search ? (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => onSearch("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-muted-foreground hover:bg-muted"
            >
              <X className="size-4" />
            </button>
          ) : null}
        </label>
        ) : null}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Categories + toolbar                                                */
/* ------------------------------------------------------------------ */

const TILE_TONES = [
  "from-primary/20 to-primary/5",
  "from-success/25 to-success/5",
  "from-[oklch(0.72_0.14_205_/_0.3)] to-transparent",
  "from-warning/25 to-warning/5",
  "from-[oklch(0.5_0.19_285_/_0.25)] to-transparent",
];

export function CategoryTiles({
  categories,
  active,
  total,
  onSelect,
}: {
  categories: CatalogCategory[];
  active: string | null;
  total: number;
  onSelect: (c: string | null) => void;
}) {
  if (categories.length === 0) return null;
  const tile = (label: string, count: number, value: string | null, i: number) => {
    const selected = active === value;
    return (
      <button
        key={value ?? "__all"}
        type="button"
        aria-pressed={selected}
        onClick={() => onSelect(value)}
        className={cn(
          "flex min-w-[112px] snap-start flex-col items-start gap-2 rounded-2xl border bg-gradient-to-br p-3 text-left transition-shadow",
          TILE_TONES[i % TILE_TONES.length],
          selected
            ? "border-primary shadow-[var(--shadow-card)] ring-2 ring-primary/30"
            : "border-border hover:shadow-[var(--shadow-card)]",
        )}
      >
        <span className="grid size-8 place-items-center rounded-xl bg-background/80 text-sm font-bold text-primary">
          {label.slice(0, 1).toUpperCase()}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-xs font-semibold">{label}</span>
          <span className="block text-[11px] text-muted-foreground">{count} items</span>
        </span>
      </button>
    );
  };
  return (
    <div
      className="-mx-4 flex snap-x gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:px-0"
      role="group"
      aria-label="Categories"
    >
      {tile("All", total, null, 0)}
      {categories.map((c, i) => tile(c.name, c.count, c.name, i + 1))}
    </div>
  );
}

export function CatalogToolbar({
  query,
  count,
  onChange,
  onReset,
  active,
}: {
  query: CatalogQuery;
  count: number;
  onChange: (q: CatalogQuery) => void;
  onReset: () => void;
  active: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <p className="mr-auto text-xs text-muted-foreground">
        {count} product{count === 1 ? "" : "s"}
        {query.category ? ` in ${query.category}` : ""}
      </p>
      <Button
        type="button"
        size="sm"
        variant={query.inStockOnly ? "default" : "outline"}
        aria-pressed={query.inStockOnly}
        onClick={() => onChange({ ...query, inStockOnly: !query.inStockOnly })}
      >
        In stock
      </Button>
      <Select
        value={query.sort}
        onValueChange={(v) => onChange({ ...query, sort: v as CatalogSort })}
      >
        <SelectTrigger className="h-8 w-[168px] text-xs" aria-label="Sort products">
          <SlidersHorizontal className="size-3.5" />
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {(Object.keys(CATALOG_SORT_LABELS) as CatalogSort[]).map((k) => (
            <SelectItem key={k} value={k}>
              {CATALOG_SORT_LABELS[k]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {active ? (
        <Button type="button" size="sm" variant="ghost" onClick={onReset}>
          <X className="size-3.5" /> Clear
        </Button>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Product cards / grid                                                */
/* ------------------------------------------------------------------ */

export function ProductCard({
  product,
  feePercent,
  quantity,
  onOpen,
  onAdd,
  onRemove,
}: {
  product: RetailProduct;
  feePercent: number;
  quantity: number;
  onOpen: () => void;
  onAdd?: () => void;
  onRemove?: () => void;
}) {
  const retail = sellerToCustomer(product.price, feePercent);
  const subtitle = productSubtitle(product);
  const avail = availabilityLabel(product.stock);
  const wholesale =
    (product.wholesale_price ?? 0) > 0 && (product.wholesale_min_qty ?? 0) > 0
      ? sellerToCustomer(product.wholesale_price ?? 0, feePercent)
      : null;
  return (
    <article className="group flex flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-[var(--shadow-card)]">
      <button
        type="button"
        onClick={onOpen}
        className="relative block text-left"
        aria-label={`View ${product.name}`}
      >
        <RetailImage path={product.image_path} alt={product.name} className="aspect-square" />
        {product.stock <= 5 ? (
          <span className="absolute left-2 top-2">
            <StatusBadge tone={avail.tone}>{avail.label}</StatusBadge>
          </span>
        ) : null}
        {wholesale !== null ? (
          <span className="absolute right-2 top-2 rounded-full bg-success px-2 py-0.5 text-[10px] font-semibold text-success-foreground">
            Bulk price
          </span>
        ) : null}
      </button>
      <div className="flex flex-1 flex-col gap-1 p-2.5 sm:p-3">
        <button type="button" onClick={onOpen} className="min-w-0 text-left">
          <p className="line-clamp-2 text-[13px] font-medium leading-snug">{product.name}</p>
          {subtitle ? (
            <p className="truncate text-[11px] text-muted-foreground">{subtitle}</p>
          ) : null}
        </button>
        <div className="mt-auto space-y-1 pt-1">
          <p className="text-base font-bold leading-none text-primary price-glow">{peso(retail)}</p>
          {wholesale !== null ? (
            <p className="text-[11px] text-success">
              {peso(wholesale)} each from {product.wholesale_min_qty}
            </p>
          ) : null}
          <div className="flex items-center justify-between gap-1 text-[11px] text-muted-foreground">
            {product.rating_count > 0 ? (
              <RatingStars avg={product.rating_avg} count={product.rating_count} />
            ) : (
              <span>{product.sold_count > 0 ? `${product.sold_count} sold` : ""}</span>
            )}
            {product.rating_count > 0 && product.sold_count > 0 ? (
              <span>{product.sold_count} sold</span>
            ) : null}
          </div>
        </div>
        {onAdd && onRemove ? (
          quantity > 0 ? (
            <div className="mt-1 flex items-center justify-between rounded-xl border border-primary/40 bg-brand-soft/40">
              <Button
                size="icon"
                variant="ghost"
                className="size-9"
                aria-label={`Remove one ${product.name}`}
                onClick={onRemove}
              >
                <Minus className="size-4" />
              </Button>
              <span className="text-sm font-semibold">{quantity}</span>
              <Button
                size="icon"
                variant="ghost"
                className="size-9"
                aria-label={`Add one ${product.name}`}
                disabled={quantity >= product.stock}
                onClick={onAdd}
              >
                <Plus className="size-4" />
              </Button>
            </div>
          ) : (
            <Button
              size="sm"
              className="mt-1 w-full"
              disabled={product.stock <= 0}
              onClick={onAdd}
              aria-label={`Add ${product.name} to cart`}
            >
              <Plus className="size-4" /> {product.stock <= 0 ? "Sold out" : "Add"}
            </Button>
          )
        ) : null}
      </div>
    </article>
  );
}

export const productGridClass =
  "grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-3 lg:grid-cols-4 xl:grid-cols-5";

export function ProductGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className={productGridClass} aria-busy aria-label="Loading products">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="overflow-hidden rounded-2xl border border-border bg-card">
          <div className="aspect-square animate-pulse bg-muted" />
          <div className="space-y-2 p-3">
            <div className="h-3 w-4/5 animate-pulse rounded bg-muted" />
            <div className="h-3 w-1/2 animate-pulse rounded bg-muted" />
            <div className="h-4 w-1/3 animate-pulse rounded bg-muted" />
            <div className="h-8 animate-pulse rounded-lg bg-muted" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function MarketplaceEmpty({
  filtered,
  onClear,
  hint,
}: {
  filtered: boolean;
  onClear?: () => void;
  hint?: string;
}) {
  return (
    <div className="rounded-3xl border border-dashed border-border bg-card/60 px-6 py-12 text-center">
      <div className="mx-auto grid size-14 place-items-center rounded-2xl bg-brand-soft text-primary">
        {filtered ? <Search className="size-6" /> : <PackageOpen className="size-6" />}
      </div>
      <p className="mt-4 text-base font-semibold">
        {filtered ? "No products match" : "The shelves are being stocked"}
      </p>
      <p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">
        {filtered
          ? "Try a different word, another category, or clear the filters."
          : (hint ??
            "This shop has not published any retail products yet. Products appear here the moment the shop admin publishes them from Admin → Retail products.")}
      </p>
      {filtered && onClear ? (
        <Button className="mt-4" variant="outline" size="sm" onClick={onClear}>
          <X className="size-4" /> Clear filters
        </Button>
      ) : null}
    </div>
  );
}

export function MarketplaceError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="rounded-3xl border border-destructive/30 bg-destructive/5 px-6 py-10 text-center">
      <p className="text-sm font-semibold">Couldn't load the shop</p>
      <p className="mt-1 text-xs text-muted-foreground">{message}</p>
      <Button className="mt-4" size="sm" variant="outline" onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Product detail                                                      */
/* ------------------------------------------------------------------ */

export function ProductDetailSheet({
  product,
  feePercent,
  settings,
  quantity,
  onChange,
  onClose,
  onBuyNow,
  shopName,
  footer,
}: {
  product: RetailProduct | null;
  feePercent: number;
  settings: StoreSettings;
  quantity: number;
  onChange: (delta: number) => void;
  onClose: () => void;
  onBuyNow: () => void;
  shopName: string;
  /** Replaces the quantity/add bar (public storefront visitors cannot order). */
  footer?: React.ReactNode;
}) {
  const [draftQty, setDraftQty] = useState(1);
  useEffect(() => {
    setDraftQty(1);
  }, [product?.id]);
  if (!product) return null;
  const retail = sellerToCustomer(product.price, feePercent);
  const avail = availabilityLabel(product.stock);
  const subtitle = productSubtitle(product);
  const wholesaleMin = product.wholesale_min_qty ?? 0;
  const wholesaleRetail =
    (product.wholesale_price ?? 0) > 0 && wholesaleMin > 0
      ? sellerToCustomer(product.wholesale_price ?? 0, feePercent)
      : null;
  const codDelivery = settings.codEnabled && settings.deliveryEnabled ? settings.deliveryFee : null;
  const inCart = quantity > 0;
  const pending = inCart ? quantity : Math.min(draftQty, Math.max(product.stock, 1));
  const unit = wholesaleRetail !== null && pending >= wholesaleMin ? wholesaleRetail : retail;

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side="bottom"
        className="mx-auto max-h-[92dvh] w-full overflow-y-auto rounded-t-3xl p-0 sm:max-w-lg"
      >
        <div className="relative">
          <RetailImage
            path={product.image_path}
            alt={product.name}
            className="aspect-square sm:aspect-[4/3]"
          />
          <span className="absolute left-3 top-3">
            <StatusBadge tone={avail.tone}>{avail.label}</StatusBadge>
          </span>
        </div>
        <div className="space-y-4 p-4 pb-28">
          <SheetHeader className="space-y-1 text-left">
            <SheetTitle className="text-lg leading-tight">{product.name}</SheetTitle>
            <SheetDescription className="flex flex-wrap items-center gap-x-2 text-xs">
              {subtitle ? <span>{subtitle}</span> : null}
              <span className="flex items-center gap-1">
                <Store className="size-3" /> {shopName}
              </span>
            </SheetDescription>
          </SheetHeader>

          <div className="flex items-end justify-between gap-3">
            <div>
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
                Retail price
              </p>
              <p className="text-3xl font-bold leading-none text-primary price-glow">
                {peso(retail)}
              </p>
              {product.unit ? (
                <p className="text-[11px] text-muted-foreground">per {product.unit}</p>
              ) : null}
            </div>
            <div className="text-right text-xs text-muted-foreground">
              {product.rating_count > 0 ? (
                <RatingStars avg={product.rating_avg} count={product.rating_count} />
              ) : null}
              {product.sold_count > 0 ? <p>{product.sold_count} sold</p> : null}
              <p>{product.stock > 0 ? `${product.stock} available` : "Currently unavailable"}</p>
            </div>
          </div>

          {wholesaleRetail !== null ? (
            <p className="rounded-xl bg-success/10 px-3 py-2 text-xs text-success">
              Bulk price {peso(wholesaleRetail)} each when you order {wholesaleMin}
              {product.unit ? ` ${product.unit}` : ""} or more.
            </p>
          ) : null}

          {product.description ? (
            <div>
              <p className="text-xs font-semibold">About this product</p>
              <p className="mt-1 whitespace-pre-line text-sm text-muted-foreground">
                {product.description}
              </p>
            </div>
          ) : null}

          <ul className="space-y-1.5 rounded-2xl border border-border px-3 py-2.5 text-xs text-muted-foreground">
            {settings.pickupEnabled ? (
              <li className="flex items-center gap-2">
                <ShoppingBag className="size-3.5 text-primary" /> Pickup at {shopName}
              </li>
            ) : null}
            {settings.deliveryEnabled ? (
              <li className="flex items-center gap-2">
                <Truck className="size-3.5 text-primary" />
                {codDelivery !== null
                  ? codDelivery > 0
                    ? `Door-to-door delivery · ${peso(codDelivery)} delivery fee on cash-on-delivery orders`
                    : "Door-to-door delivery · free delivery on cash-on-delivery orders"
                  : "Door-to-door delivery available"}
              </li>
            ) : null}
            <li className="flex items-center gap-2">
              <ChevronRight className="size-3.5 text-primary" /> Exact total is shown before you
              confirm — no hidden charges.
            </li>
          </ul>
        </div>

        <div className="sticky bottom-0 flex items-center gap-2 border-t border-border bg-background/95 p-3 backdrop-blur">
          {footer ?? (
            <>
              <div className="flex items-center rounded-xl border border-border">
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-10"
                  aria-label="Decrease quantity"
                  disabled={pending <= (inCart ? 0 : 1)}
                  onClick={() => (inCart ? onChange(-1) : setDraftQty((q) => Math.max(1, q - 1)))}
                >
                  <Minus className="size-4" />
                </Button>
                <span className="w-8 text-center text-sm font-semibold" aria-live="polite">
                  {pending}
                </span>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-10"
                  aria-label="Increase quantity"
                  disabled={pending >= product.stock}
                  onClick={() =>
                    inCart ? onChange(1) : setDraftQty((q) => Math.min(product.stock, q + 1))
                  }
                >
                  <Plus className="size-4" />
                </Button>
              </div>
              <div className="min-w-0 flex-1 text-right sm:text-left">
                <p className="text-[11px] text-muted-foreground">
                  {pending} × {peso(unit)}
                </p>
                <p className="text-sm font-bold">{peso(Math.round(unit * pending * 100) / 100)}</p>
              </div>
              {inCart ? (
                <Button onClick={onBuyNow} className="shrink-0">
                  <ShoppingCart className="size-4" /> Checkout
                </Button>
              ) : (
                <>
                  <Button
                    variant="outline"
                    className="shrink-0"
                    disabled={product.stock <= 0}
                    onClick={() => onChange(pending)}
                  >
                    Add to cart
                  </Button>
                  <Button
                    className="shrink-0"
                    disabled={product.stock <= 0}
                    onClick={() => {
                      onChange(pending);
                      onBuyNow();
                    }}
                  >
                    Buy now
                  </Button>
                </>
              )}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

/* ------------------------------------------------------------------ */
/* Cart                                                                */
/* ------------------------------------------------------------------ */

export function CartSheet({
  open,
  lines,
  quote,
  feePercent,
  settings,
  onChange,
  onRemove,
  onCheckout,
  onClose,
}: {
  open: boolean;
  lines: CartLine[];
  quote: CartQuote;
  feePercent: number;
  settings: StoreSettings;
  onChange: (product: RetailProduct, delta: number) => void;
  onRemove: (product: RetailProduct) => void;
  onCheckout: () => void;
  onClose: () => void;
}) {
  const count = useMemo(() => lines.reduce((s, l) => s + l.quantity, 0), [lines]);
  const codDelivery = settings.codEnabled && settings.deliveryEnabled ? settings.deliveryFee : null;
  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side="bottom"
        className="mx-auto flex max-h-[92dvh] w-full flex-col rounded-t-3xl p-0 sm:max-w-lg"
      >
        <SheetHeader className="border-b border-border p-4 text-left">
          <SheetTitle className="flex items-center gap-2">
            <ShoppingCart className="size-5 text-primary" /> Your cart
          </SheetTitle>
          <SheetDescription>
            {count === 0 ? "Nothing here yet." : `${count} item${count === 1 ? "" : "s"}`}
          </SheetDescription>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto p-4">
          {lines.length === 0 ? (
            <div className="py-10 text-center">
              <ShoppingBag className="mx-auto size-8 text-muted-foreground/60" />
              <p className="mt-3 text-sm font-medium">Your cart is empty</p>
              <p className="text-xs text-muted-foreground">
                Add products to see the exact total here.
              </p>
              <Button className="mt-4" size="sm" variant="outline" onClick={onClose}>
                Browse products
              </Button>
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {lines.map((l) => (
                <li key={l.product.id} className="flex gap-3 py-3">
                  <RetailImage
                    path={l.product.image_path}
                    alt={l.product.name}
                    className="size-16 shrink-0 rounded-xl aspect-square"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 text-sm font-medium leading-snug">
                      {l.product.name}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {peso(sellerToCustomer(l.unitPrice, feePercent))} each
                      {l.wholesale ? (
                        <>
                          {" "}
                          <span className="text-success">bulk price</span>{" "}
                          <s>{peso(sellerToCustomer(l.product.price, feePercent))}</s>
                        </>
                      ) : null}
                    </p>
                    <div className="mt-1.5 flex items-center justify-between gap-2">
                      <div className="flex items-center rounded-lg border border-border">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="size-8"
                          aria-label={`Remove one ${l.product.name}`}
                          onClick={() => onChange(l.product, -1)}
                        >
                          <Minus className="size-3.5" />
                        </Button>
                        <span className="w-7 text-center text-sm font-semibold">{l.quantity}</span>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="size-8"
                          aria-label={`Add one ${l.product.name}`}
                          disabled={l.quantity >= l.product.stock}
                          onClick={() => onChange(l.product, 1)}
                        >
                          <Plus className="size-3.5" />
                        </Button>
                      </div>
                      <p className="text-sm font-semibold">{peso(l.lineTotal)}</p>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-8 text-muted-foreground"
                        aria-label={`Remove ${l.product.name} from cart`}
                        onClick={() => onRemove(l.product)}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
        {lines.length > 0 ? (
          <div className="space-y-2 border-t border-border bg-background p-4">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Products ({count})</span>
              <span className="font-semibold">{peso(quote.total)}</span>
            </div>
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Delivery fee</span>
              <span>
                {codDelivery !== null && codDelivery > 0
                  ? `${peso(codDelivery)} on cash-on-delivery · confirmed at checkout`
                  : "Shown at checkout"}
              </span>
            </div>
            <Button className="w-full" size="lg" onClick={onCheckout}>
              Checkout · {peso(quote.total)}
              <ChevronRight className="size-4" />
            </Button>
            <p className="text-center text-[11px] text-muted-foreground">
              Prices and stock are re-checked by the shop when you place the order.
            </p>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
