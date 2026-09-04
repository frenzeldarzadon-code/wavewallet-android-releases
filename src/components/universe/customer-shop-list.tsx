/**
 * Customer shop list — the chooser behind Live Monitoring and Reward Shops in
 * the Universe hamburger. Lists only the shops the signed-in member is
 * entitled to (server-derived from their own memberships, purchases and
 * points) and links each one to the EXISTING per-shop experience.
 */
import { Link } from "@tanstack/react-router";
import { ChevronRight, Loader2, Store } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useServerFn } from "@tanstack/react-start";
import { RetailImage } from "@/components/retail/retail-image";
import { EmptyState } from "@/components/ui-kit";
import { listCustomerShops } from "@/lib/voucher-monitoring.functions";
import type { CustomerShop } from "@/lib/customer-shops";

export function useCustomerShops() {
  const load = useServerFn(listCustomerShops);
  const [shops, setShops] = useState<CustomerShop[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    load()
      .then((rows) => alive && setShops(rows))
      .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, [load]);
  return { shops, error };
}

export function CustomerShopList({
  shops,
  error,
  linkFor,
  detail,
  empty,
}: {
  shops: CustomerShop[] | null;
  error: string | null;
  /** Route props for the shop's existing experience. */
  linkFor: (shop: CustomerShop) => { to: string; params?: Record<string, string>; search?: Record<string, string> };
  /** Secondary line under the shop name. */
  detail: (shop: CustomerShop) => ReactNode;
  empty: ReactNode;
}) {
  if (error) return <EmptyState title="Could not load your shops" description={error} />;
  if (!shops) {
    return (
      <div className="flex justify-center py-10 text-muted-foreground">
        <Loader2 className="size-5 animate-spin" aria-label="Loading" />
      </div>
    );
  }
  if (shops.length === 0) return <>{empty}</>;
  return (
    <ul className="space-y-2" aria-label="Your shops">
      {shops.map((shop) => {
        const link = linkFor(shop);
        return (
          <li key={shop.id}>
            <Link
              to={link.to as never}
              params={link.params as never}
              search={link.search as never}
              className="flex items-center gap-3 rounded-xl border border-border bg-card p-3 shadow-[var(--shadow-card)] transition-colors hover:bg-accent/40"
            >
              {shop.logoPath ? (
                <RetailImage
                  path={shop.logoPath}
                  alt=""
                  className="aspect-square size-12 shrink-0 rounded-lg"
                />
              ) : (
                <span className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-primary">
                  <Store className="size-5" />
                </span>
              )}
              <span className="min-w-0 flex-1 leading-tight">
                <span className="block truncate text-sm font-semibold">{shop.name}</span>
                <span className="block truncate text-xs text-muted-foreground">{detail(shop)}</span>
              </span>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
