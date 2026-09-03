import { Link } from "@tanstack/react-router";
import { ArrowRight, ShoppingBag, Store } from "lucide-react";
import { useEffect, useState } from "react";
import { RetailImage } from "@/components/retail/retail-image";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { peso } from "@/lib/wavewallet";
import { VoucherArtwork } from "./voucher-artwork";

interface MarketPulseRow {
  section: "featured" | "top_shops" | "top_products";
  rank: number;
  shop_id: string;
  shop_name: string;
  shop_slug: string;
  commerce_kind: "retail" | "voucher";
  item_id: string | null;
  item_name: string | null;
  image_path: string | null;
  price: number | null;
  sales_count: number;
  rating_avg: number;
  rating_count: number;
  logo_path: string | null;
  cover_path: string | null;
}

export async function fetchMarketPulse(limit = 8): Promise<MarketPulseRow[]> {
  const { data, error } = await supabase.rpc("universe_market_pulse", { _limit: limit });
  if (error) throw new Error(error.message);
  return ((data ?? []) as MarketPulseRow[]).map((row) => ({
    ...row,
    rank: Number(row.rank),
    sales_count: Number(row.sales_count),
    rating_avg: Number(row.rating_avg),
    price: row.price === null ? null : Number(row.price),
  }));
}

function Heading({ title, label }: { title: string; label: string }) {
  return (
    <div className="flex items-end justify-between gap-3 px-4 sm:px-0">
      <div>
        <p className="text-[11px] font-semibold uppercase text-primary">{label}</p>
        <h2 className="text-lg font-bold">{title}</h2>
      </div>
      <Button asChild variant="ghost" size="sm">
        <Link to="/universe/search">See all <ArrowRight className="size-3.5" /></Link>
      </Button>
    </div>
  );
}

export function MarketPulse() {
  const [rows, setRows] = useState<MarketPulseRow[] | null>(null);
  useEffect(() => {
    let active = true;
    void fetchMarketPulse().then((value) => active && setRows(value)).catch(() => active && setRows([]));
    return () => { active = false; };
  }, []);

  const featured = rows?.filter((row) => row.section === "featured") ?? [];
  const shops = rows?.filter((row) => row.section === "top_shops") ?? [];
  const products = rows?.filter((row) => row.section === "top_products") ?? [];

  if (rows === null) return <div className="mx-4 h-40 animate-pulse rounded-lg bg-muted sm:mx-0" />;
  if (!featured.length) return null;

  return (
    <section aria-label="Marketplace discovery" className="space-y-5">
      <div className="space-y-2">
        <Heading title="Featured shops" label="Market Pulse" />
        <div className="flex snap-x gap-3 overflow-x-auto px-4 pb-1 sm:px-0">
          {featured.map((shop) => (
            <Link key={shop.shop_id} to="/shop/$slug" params={{ slug: shop.shop_slug }} className="group min-w-64 max-w-64 snap-start overflow-hidden rounded-xl border border-border bg-card shadow-[var(--shadow-card)] transition-transform hover:-translate-y-0.5 hover:border-primary/40">
              <div className="relative aspect-[16/8] overflow-hidden bg-brand-soft">
                {shop.cover_path ? <RetailImage path={shop.cover_path} alt={`${shop.shop_name} cover`} className="aspect-[16/8] transition-transform group-hover:[&_img]:scale-105" /> : shop.commerce_kind === "voucher" ? <VoucherArtwork seed={shop.shop_id} name={shop.shop_name} compact className="aspect-[16/8]" /> : <div className="surface-gradient flex size-full items-center justify-center"><Store className="size-9 text-primary-foreground/80" /></div>}
                <Badge variant="secondary" className="absolute right-2 top-2 shadow-[var(--shadow-card)]">{shop.commerce_kind === "retail" ? "Retail" : "Voucher"}</Badge>
              </div>
              <div className="relative px-3 pb-3 pt-4">
                <span className="absolute -top-7 left-3 flex size-12 items-center justify-center overflow-hidden rounded-xl border-4 border-card bg-brand-soft text-primary shadow-[var(--shadow-card)]">
                  {shop.logo_path ? <RetailImage path={shop.logo_path} alt={`${shop.shop_name} logo`} className="aspect-square size-full" /> : <Store className="size-5" />}
                </span>
                <p className="mt-2 truncate font-bold">{shop.shop_name}</p>
                <p className="mt-1 text-xs text-muted-foreground">{shop.rating_count ? `${shop.rating_avg.toFixed(1)} rating · ${shop.sales_count} sales` : shop.sales_count ? `${shop.sales_count} sales` : "New to the marketplace"}</p>
              </div>
            </Link>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <Heading title="Top selling shops" label="Completed sales" />
        {shops.length ? <div className="flex snap-x gap-3 overflow-x-auto px-4 pb-1 sm:px-0">
          {shops.map((shop) => (
            <Link key={shop.shop_id} to="/shop/$slug" params={{ slug: shop.shop_slug }} className="relative flex min-w-72 snap-start items-center gap-3 overflow-hidden rounded-xl border border-border bg-card p-3 shadow-[var(--shadow-card)] transition-colors hover:border-primary/40">
              <span className="absolute left-0 top-0 rounded-br-xl bg-primary px-2 py-1 text-xs font-bold text-primary-foreground">#{shop.rank}</span>
              <span className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-brand-soft text-primary">
                {shop.logo_path || shop.cover_path ? <RetailImage path={shop.logo_path ?? shop.cover_path} alt={`${shop.shop_name} shop image`} className="aspect-square size-full" /> : shop.commerce_kind === "voucher" ? <VoucherArtwork seed={shop.shop_id} name={shop.shop_name} compact className="aspect-square size-full" /> : <Store className="size-5" />}
              </span>
              <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{shop.shop_name}</span><span className="block text-xs text-muted-foreground">{shop.sales_count} completed sales</span></span>
              <ArrowRight className="size-4 text-muted-foreground" />
            </Link>
          ))}
        </div> : <p className="px-4 text-sm text-muted-foreground sm:px-0">Rankings appear after real purchases.</p>}
      </div>

      <div className="space-y-2">
        <Heading title="Top selling products" label="Real marketplace sales" />
        {products.length ? <div className="flex snap-x gap-3 overflow-x-auto px-4 pb-1 sm:px-0">
          {products.map((product) => (
            <Link key={`${product.commerce_kind}-${product.item_id}`} to="/shop/$slug" params={{ slug: product.shop_slug }} className="min-w-40 max-w-40 snap-start overflow-hidden rounded-lg border border-border bg-card">
               {product.image_path ? <RetailImage path={product.image_path} alt={product.item_name ?? "Product"} className="aspect-square" /> : product.commerce_kind === "voucher" ? <VoucherArtwork seed={`${product.shop_id}-${product.item_id}`} name={product.item_name ?? "Voucher"} className="aspect-square" /> : <div className="surface-gradient flex aspect-square items-center justify-center"><ShoppingBag className="size-8 text-primary-foreground/80" /></div>}
               <div className="p-3"><p className="line-clamp-2 min-h-10 text-sm font-semibold">{product.item_name}</p><p className="mt-1 truncate text-xs text-muted-foreground">{product.shop_name}</p><p className="mt-2 font-bold text-primary">{product.price === null ? "View price" : peso(product.price)}</p><p className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground"><ShoppingBag className="size-3" /> {product.sales_count} sold</p><span className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-primary">View <ArrowRight className="size-3" /></span></div>
            </Link>
          ))}
        </div> : <p className="px-4 text-sm text-muted-foreground sm:px-0">Top products appear after real purchases.</p>}
      </div>
    </section>
  );
}