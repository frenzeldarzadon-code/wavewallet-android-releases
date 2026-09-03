import { Wifi } from "lucide-react";
import caveArt from "@/assets/voucher-art/cave.jpg.asset.json";
import fallsArt from "@/assets/voucher-art/falls.jpg.asset.json";
import mistArt from "@/assets/voucher-art/mist.jpg.asset.json";
import pinesArt from "@/assets/voucher-art/pines.jpg.asset.json";
import sunriseArt from "@/assets/voucher-art/sunrise.jpg.asset.json";
import terracesArt from "@/assets/voucher-art/terraces.jpg.asset.json";
import { cn } from "@/lib/utils";

const VOUCHER_ART = [mistArt.url, terracesArt.url, pinesArt.url, fallsArt.url, caveArt.url, sunriseArt.url];

/** Stable decorative artwork for vouchers, which do not currently have uploaded product photos. */
export function voucherArtworkUrl(seed: string): string {
  let hash = 0;
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return VOUCHER_ART[hash % VOUCHER_ART.length] ?? VOUCHER_ART[0] ?? "";
}

export function VoucherArtwork({
  seed,
  name,
  className,
  compact = false,
}: {
  seed: string;
  name: string;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div className={cn("relative aspect-[16/10] overflow-hidden bg-brand-soft", className)}>
      <img
        src={voucherArtworkUrl(seed)}
        alt=""
        loading="lazy"
        className="size-full object-cover"
      />
      <div className="absolute inset-0 bg-gradient-to-t from-foreground/75 via-foreground/10 to-transparent" aria-hidden />
      <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 p-3 text-primary-foreground">
        <span className="min-w-0">
          <span className="flex items-center gap-1 text-[10px] font-semibold uppercase">
            <Wifi className="size-3" aria-hidden /> Voucher artwork
          </span>
          {!compact ? <span className="mt-0.5 block truncate text-sm font-bold">{name}</span> : null}
        </span>
        <span className="shrink-0 rounded-full border border-primary-foreground/40 bg-foreground/25 px-2 py-1 text-[10px] font-semibold">
          ONE WAVE
        </span>
      </div>
    </div>
  );
}