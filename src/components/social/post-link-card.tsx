/**
 * The "Link / Recommend" card: one shop or one product from a public Universe
 * storefront. Used both as the composer's selected-item preview and inside
 * published posts. Clicking opens the existing storefront route — nothing
 * here sells, prices or checks out on its own.
 */
import { Link } from "@tanstack/react-router";
import { ArrowRight, Store, Ticket, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { RetailImage } from "@/components/retail/retail-image";
import { voucherArtworkUrl } from "@/components/universe/voucher-artwork";
import { retailImageUrl } from "@/lib/retail";
import { shopTypeLabel, type LinkCard } from "@/lib/social";
import { cn } from "@/lib/utils";

const coins = (n: number) => `${n.toLocaleString(undefined, { maximumFractionDigits: 2 })} coins`;

function ShopLogo({ path, name }: { path: string | null; name: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void retailImageUrl(path).then((u) => alive && setUrl(u));
    return () => {
      alive = false;
    };
  }, [path]);
  return (
    <span className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-xl border-2 border-card bg-brand-soft shadow-sm">
      {url ? (
        <img src={url} alt={`${name} logo`} loading="lazy" className="size-full object-cover" />
      ) : (
        <Store className="size-5 text-primary" aria-hidden />
      )}
    </span>
  );
}

/** Product variant: photo (or voucher artwork), name, shop, current price. */
function ProductLinkBody({ card, compact }: { card: LinkCard; compact: boolean }) {
  const name = card.product_name ?? "Product";
  return (
    <div className="flex gap-3 p-3">
      <div className={cn("shrink-0 overflow-hidden rounded-xl", compact ? "size-20" : "size-24")}>
        {card.image_path ? (
          <RetailImage path={card.image_path} alt={name} className="aspect-square h-full" />
        ) : card.product_kind === "voucher" ? (
          // Small square: the curated artwork alone; its labels need more room.
          <img
            src={voucherArtworkUrl(`${card.shop_id}-${card.product_id}`)}
            alt=""
            loading="lazy"
            className="size-full object-cover"
          />
        ) : (
          <RetailImage path={null} alt={name} className="aspect-square h-full" />
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <p className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {card.product_kind === "voucher" ? (
            <Ticket className="size-3" aria-hidden />
          ) : (
            <Store className="size-3" aria-hidden />
          )}
          {card.product_kind === "voucher" ? "Voucher" : "Product"} · {card.shop_name}
        </p>
        <p className="mt-0.5 line-clamp-2 text-sm font-semibold leading-snug">{name}</p>
        {card.price !== null ? (
          <p className="mt-auto pt-1 text-base font-bold text-primary">{coins(card.price)}</p>
        ) : null}
        {typeof card.available === "number" ? (
          <p className="text-[11px] text-muted-foreground">
            {card.available <= 0
              ? "Currently unavailable"
              : `${card.available} ${card.product_kind === "voucher" ? "available" : "in stock"}`}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/** Shop variant: cover strip, logo, name, shop type. */
function ShopLinkBody({ card, compact }: { card: LinkCard; compact: boolean }) {
  return (
    <div>
      <RetailImage
        path={card.cover_path}
        alt=""
        className={cn(compact ? "aspect-[4/1]" : "aspect-[3/1]")}
      />
      {/* Only the logo overlaps the cover; the text always sits on the card surface. */}
      <div className="flex items-end gap-3 px-3 pb-3">
        <span className="-mt-6">
          <ShopLogo path={card.logo_path} name={card.shop_name} />
        </span>
        <div className="min-w-0 flex-1 pt-2">
          <p className="truncate text-sm font-semibold">{card.shop_name}</p>
          <p className="text-xs text-muted-foreground">{shopTypeLabel(card.shop_type)}</p>
        </div>
      </div>
    </div>
  );
}

export function PostLinkCard({
  card,
  onRemove,
  onChange,
  compact = false,
  className,
}: {
  card: LinkCard;
  /** Composer preview controls. When absent the card is a plain link. */
  onRemove?: () => void;
  onChange?: () => void;
  compact?: boolean;
  className?: string;
}) {
  const isProduct = card.kind === "product";
  const actionLabel = isProduct
    ? card.product_kind === "voucher"
      ? "View voucher"
      : "View product"
    : "Open shop";
  const editable = Boolean(onRemove || onChange);

  const body = isProduct ? (
    <ProductLinkBody card={card} compact={compact} />
  ) : (
    <ShopLinkBody card={card} compact={compact} />
  );

  const footer = (
    <div className="flex items-center gap-2 border-t border-border px-3 py-2">
      <span className="truncate text-xs text-muted-foreground">
        {isProduct ? `Sold by ${card.shop_name}` : "Recommended shop"}
      </span>
      <span className="ml-auto inline-flex h-8 shrink-0 items-center gap-1 rounded-full bg-primary px-3 text-xs font-semibold text-primary-foreground">
        {actionLabel} <ArrowRight className="size-3.5" aria-hidden />
      </span>
    </div>
  );

  const shell = cn(
    "block overflow-hidden rounded-2xl border border-border bg-card text-left shadow-[var(--shadow-card)] transition-colors",
    !editable && "hover:border-primary/40",
    className,
  );

  if (editable) {
    return (
      <div className={cn(shell, "relative")} data-testid="post-link-preview">
        {body}
        <div className="flex items-center gap-2 border-t border-border px-3 py-2">
          <span className="truncate text-xs text-muted-foreground">
            {isProduct ? "Linked product" : "Linked shop"}
          </span>
          <span className="ml-auto flex gap-1">
            {onChange ? (
              <Button type="button" variant="outline" size="sm" className="h-8" onClick={onChange}>
                Change
              </Button>
            ) : null}
            {onRemove ? (
              <Button type="button" variant="ghost" size="sm" className="h-8" onClick={onRemove}>
                <X className="size-3.5" /> Remove
              </Button>
            ) : null}
          </span>
        </div>
      </div>
    );
  }

  return (
    <Link
      to="/shop/$slug"
      params={{ slug: card.shop_slug }}
      search={isProduct && card.product_id ? { product: card.product_id } : {}}
      className={shell}
      aria-label={`${actionLabel}: ${isProduct ? card.product_name : card.shop_name}`}
    >
      {body}
      {footer}
    </Link>
  );
}
