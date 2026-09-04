/**
 * "Bought from THIS shop" — originating-shop chip for voucher purchase history.
 *
 * The shop comes from the id recorded on the sale itself, never from the
 * buyer's or seller's current affiliation. Open shops link to their Universe
 * storefront (no join required); archived/closed shops keep their name but no
 * link; unresolvable ids show a neutral placeholder.
 */
import { Link } from "@tanstack/react-router";
import { Store } from "lucide-react";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { RetailImage } from "@/components/retail/retail-image";
import { listPurchaseShopLabels } from "@/lib/voucher-monitoring.functions";
import {
  purchaseShopFor,
  UNAVAILABLE_SHOP_LABEL,
  type PurchaseShopLabels,
} from "@/lib/customer-shops";

/** One batched server read for every shop/seller in the caller's purchase history. */
export function usePurchaseShopLabels(enabled = true) {
  const load = useServerFn(listPurchaseShopLabels);
  const [labels, setLabels] = useState<PurchaseShopLabels | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    load()
      .then((l) => alive && setLabels(l))
      .catch(() => alive && setLabels({ shops: {}, sellers: {} }));
    return () => {
      alive = false;
    };
  }, [load, enabled]);
  return labels;
}

export function PurchaseShopChip({
  labels,
  ecosystemId,
  sellerId,
}: {
  labels: PurchaseShopLabels | null;
  ecosystemId: string | null | undefined;
  sellerId?: string | null | undefined;
}) {
  const shop = purchaseShopFor(labels, ecosystemId);
  const seller = sellerId && labels ? (labels.sellers[sellerId] ?? null) : null;
  const logo = shop?.logoPath ? (
    <RetailImage path={shop.logoPath} alt="" className="aspect-square size-6 shrink-0 rounded" />
  ) : (
    <span className="flex size-6 shrink-0 items-center justify-center rounded bg-brand-soft text-primary">
      <Store className="size-3.5" />
    </span>
  );
  const body = (
    <>
      {logo}
      <span className="min-w-0 leading-tight">
        <span className="block truncate text-xs font-semibold text-foreground">
          {shop ? shop.name : labels ? UNAVAILABLE_SHOP_LABEL : "…"}
        </span>
        {seller ? (
          <span className="block truncate text-[11px] text-muted-foreground">Seller: {seller}</span>
        ) : null}
      </span>
    </>
  );
  const cls = "mt-1 inline-flex max-w-full items-center gap-2 rounded-md border border-border bg-muted/40 px-2 py-1";
  if (shop?.storefrontOpen) {
    return (
      <Link
        to="/shop/$slug"
        params={{ slug: shop.slug }}
        aria-label={`Open ${shop.name} in Universe`}
        className={`${cls} transition-colors hover:border-primary/40 hover:bg-brand-soft/40`}
        onClick={(e) => e.stopPropagation()}
      >
        {body}
      </Link>
    );
  }
  return <span className={cls}>{body}</span>;
}
