/**
 * Shop type — the one management control that says what kind of shop this
 * is: New Generation, Universe Voucher or Universe Retail.
 *
 * Reuses the existing shop record; the database (`set_shop_type`) is the
 * authority and refuses New Generation conversions and switching a Retail
 * shop away while it still has open orders. Products, codes and orders are
 * never deleted by a switch — the hidden store simply stops being offered.
 */
import { Check, Loader2, Package, ShieldCheck, Store, Ticket } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { PageSection, StatusBadge } from "@/components/ui-kit";
import { cn } from "@/lib/utils";
import { useShopStatus } from "@/lib/shop-status";
import {
  SHOP_TYPES,
  SHOP_TYPE_INFO,
  setShopType,
  shopTypeLabel,
  type ShopType,
  type ShopTypeState,
} from "@/lib/shop-type";

const ICONS: Record<ShopType, typeof Store> = {
  new_generation: ShieldCheck,
  universe_voucher: Ticket,
  universe_retail: Package,
};

const TONE: Record<ShopType, { ring: string; icon: string; badge: "brand" | "success" | "warning" }> = {
  new_generation: {
    ring: "border-warning/60 bg-warning/5",
    icon: "bg-warning/15 text-warning",
    badge: "warning",
  },
  universe_voucher: {
    ring: "border-primary/60 bg-primary/5",
    icon: "bg-primary/15 text-primary",
    badge: "brand",
  },
  universe_retail: {
    ring: "border-success/60 bg-success/5",
    icon: "bg-success/15 text-success",
    badge: "success",
  },
};

/** Presentational type cards, shared by shop creation and shop settings. */
export function ShopTypeOptions({
  value,
  onChange,
  disabledTypes = [],
  hint,
}: {
  value: ShopType | null;
  onChange: (t: ShopType) => void;
  disabledTypes?: ShopType[];
  hint?: (t: ShopType) => string | null;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-3" role="radiogroup" aria-label="Shop type">
      {SHOP_TYPES.map((t) => {
        const info = SHOP_TYPE_INFO[t];
        const Icon = ICONS[t];
        const selected = value === t;
        const disabled = disabledTypes.includes(t);
        const note = hint?.(t) ?? null;
        return (
          <button
            key={t}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={info.label}
            disabled={disabled}
            onClick={() => onChange(t)}
            className={cn(
              "relative flex min-h-[9.5rem] flex-col items-start gap-2 rounded-2xl border p-4 text-left transition-all",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              selected
                ? cn(TONE[t].ring, "shadow-[var(--shadow-card)]")
                : "border-border bg-card hover:border-foreground/25",
              disabled && "cursor-not-allowed opacity-55",
            )}
          >
            <span className={cn("grid size-9 place-items-center rounded-xl", TONE[t].icon)}>
              <Icon className="size-4" />
            </span>
            <span className="text-sm font-semibold leading-tight">{info.label}</span>
            <span className="text-[11px] font-medium text-muted-foreground">{info.tagline}</span>
            <span className="text-[11px] leading-relaxed text-muted-foreground">{info.description}</span>
            {note ? <span className="text-[11px] font-medium text-muted-foreground">{note}</span> : null}
            {selected ? (
              <span className="absolute right-3 top-3 grid size-5 place-items-center rounded-full bg-foreground text-background">
                <Check className="size-3" />
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

export function ShopTypeBadge({ type }: { type: ShopTypeState | null }) {
  const tone =
    type === "new_generation" || type === "universe_voucher" || type === "universe_retail"
      ? TONE[type].badge
      : "warning";
  return <StatusBadge tone={tone}>{shopTypeLabel(type)}</StatusBadge>;
}

export function ShopTypeCard({ ecosystemId }: { ecosystemId: string | null }) {
  const [refresh, setRefresh] = useState(0);
  const status = useShopStatus(ecosystemId, refresh);
  const [pending, setPending] = useState<ShopType | null>(null);
  const [busy, setBusy] = useState(false);

  if (!ecosystemId) return null;
  const current = status.shopType;
  const isNg = current === "new_generation";
  const selected: ShopType | null =
    current === "new_generation" || current === "universe_voucher" || current === "universe_retail"
      ? current
      : null;

  const confirm = async () => {
    if (!pending || pending === "new_generation") return;
    setBusy(true);
    try {
      const next = await setShopType(ecosystemId, pending);
      toast.success(`This is now a ${shopTypeLabel(next)} shop`);
      setPending(null);
      setRefresh((n) => n + 1);
      // Sidebar and other cards read the type too.
      window.dispatchEvent(new Event("wavewallet:session"));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <PageSection
      devSlot="shop-type-card"
      title="Shop type"
      description="What this shop sells and which world it belongs to. The console only shows the tools of the selected type."
    >
      <Card className="shadow-[var(--shadow-card)]">
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground">Currently managing:</span>
            {status.loading ? (
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
            ) : (
              <ShopTypeBadge type={current} />
            )}
          </div>
          {current === "universe_mixed" || current === "universe_unset" ? (
            <p className="rounded-xl border border-warning/50 bg-warning/5 px-3 py-2 text-xs text-foreground">
              This shop has an older store configuration. Pick Universe Voucher or Universe Retail
              to confirm what it sells — nothing is deleted either way.
            </p>
          ) : null}
          <ShopTypeOptions
            value={selected}
            onChange={(t) => {
              if (t === selected || t === "new_generation" || isNg) return;
              setPending(t);
            }}
            disabledTypes={isNg ? ["universe_voucher", "universe_retail"] : ["new_generation"]}
            hint={(t) =>
              isNg && t !== "new_generation"
                ? "New Generation shops stay isolated"
                : !isNg && t === "new_generation"
                  ? "Set at creation only"
                  : null
            }
          />
          {isNg ? (
            <p className="text-xs text-muted-foreground">
              A New Generation shop keeps its own wallets and never joins Universe commerce. To sell
              on the Universe, create a separate Universe shop.
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              Switching only changes what customers are offered: voucher products, codes, retail
              products and orders all stay stored. A Retail shop with open orders cannot switch
              until they are finished or cancelled.
            </p>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={pending !== null} onOpenChange={(o) => !o && !busy && setPending(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Switch to {pending ? SHOP_TYPE_INFO[pending].label : ""}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pending === "universe_retail"
                ? "Customers will see your retail products instead of vouchers. Voucher products and codes stay stored and come back if you switch again. If this shop has no products yet, the starter catalog is loaded as drafts."
                : "Customers will see your voucher products instead of retail products. Retail products and past orders stay stored."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Keep current type</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); void confirm(); }} disabled={busy}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Store className="size-4" />}
              Switch shop type
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageSection>
  );
}
