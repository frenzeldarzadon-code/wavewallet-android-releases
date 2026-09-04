/**
 * Universe ↔ Shop Dashboard switch.
 *
 * `ShopDashboardSwitch` lives in the Universe shell: it appears only for
 * members who hold a management role (admin / reseller / subreseller) in at
 * least one shop, opens that shop's existing console directly, or asks which
 * shop when several are managed. `UniverseSwitch` is the way back from any
 * shop console. Both are navigation only — the database re-authorizes the
 * active-shop switch and every screen behind it.
 */
import { Link } from "@tanstack/react-router";
import { ArrowLeftRight, Check, Loader2, Sparkles, Store } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ShopTypeBadge } from "@/components/shop/shop-type-card";
import { fetchMyMemberships, switchEcosystem, type Membership } from "@/lib/memberships";
import {
  dashboardLabelFor,
  dashboardPathFor,
  shopDashboardEntry,
  type ShopDashboardEntry,
} from "@/lib/shop-dashboard";
import { fetchShopTypes, type ShopTypeState } from "@/lib/shop-type";
import { cn } from "@/lib/utils";

/** Loads the member's managed shops once; a customer-only member gets `none`. */
export function useShopDashboardEntry(enabled = true): ShopDashboardEntry | null {
  const [entry, setEntry] = useState<ShopDashboardEntry | null>(null);
  useEffect(() => {
    if (!enabled) {
      setEntry({ kind: "none" });
      return;
    }
    let alive = true;
    void fetchMyMemberships()
      .then((list) => alive && setEntry(shopDashboardEntry(list)))
      .catch(() => alive && setEntry({ kind: "none" }));
    return () => {
      alive = false;
    };
  }, [enabled]);
  return entry;
}

/** Makes the chosen shop active (when needed) and opens its console. */
export async function openShopDashboard(membership: Membership): Promise<void> {
  if (!membership.isActive) await switchEcosystem(membership.ecosystemId);
  // Full navigation so wallets, lists and reports load in the new shop context.
  window.location.href = dashboardPathFor(membership.role);
}

export function ShopDashboardSwitch({
  entry,
  variant = "menu",
  className,
}: {
  entry: ShopDashboardEntry | null;
  /** `menu` = hamburger row, `button` = outlined rail button. */
  variant?: "menu" | "button";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [types, setTypes] = useState<Record<string, ShopTypeState>>({});

  useEffect(() => {
    if (!open || entry?.kind !== "choose") return;
    void fetchShopTypes(entry.memberships.map((m) => m.ecosystemId)).then(setTypes);
  }, [open, entry]);

  if (!entry || entry.kind === "none") return null;

  const go = async (m: Membership) => {
    if (busy) return;
    setBusy(m.ecosystemId);
    try {
      await openShopDashboard(m);
    } catch (e) {
      setBusy(null);
      toast.error(e instanceof Error ? e.message : "Could not open the Shop Dashboard");
    }
  };

  const onClick = () => {
    if (entry.kind === "single") void go(entry.membership);
    else setOpen(true);
  };

  const label = "Switch to Shop Dashboard";
  const hint =
    entry.kind === "single"
      ? `${entry.membership.ecosystemName} · ${dashboardLabelFor(entry.membership.role)}`
      : `${entry.memberships.length} shops you manage`;

  return (
    <>
      {variant === "menu" ? (
        <button
          type="button"
          onClick={onClick}
          className={cn(
            "flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-sm font-medium hover:bg-accent",
            className,
          )}
        >
          <ArrowLeftRight className="size-5 text-primary" />
          <span className="min-w-0 flex-1 leading-tight">
            <span className="block">{label}</span>
            <span className="block truncate text-[11px] font-normal text-muted-foreground">
              {hint}
            </span>
          </span>
          {busy ? <Loader2 className="size-4 animate-spin" /> : null}
        </button>
      ) : (
        <Button
          variant="outline"
          size="sm"
          onClick={onClick}
          disabled={!!busy}
          className={cn("w-full justify-start gap-2 rounded-lg", className)}
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : <ArrowLeftRight className="size-4" />}
          <span className="min-w-0 flex-1 truncate text-left">
            <span className="block">{label}</span>
            <span className="block truncate text-[10px] font-normal text-muted-foreground">
              {hint}
            </span>
          </span>
        </Button>
      )}

      {entry.kind === "choose" ? (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Which shop?</DialogTitle>
              <DialogDescription>
                You manage several shops. Each Shop Dashboard keeps its own sellers, inventory,
                storefront and history.
              </DialogDescription>
            </DialogHeader>
            <ul className="space-y-2">
              {entry.memberships.map((m) => (
                <li key={m.ecosystemId}>
                  <button
                    type="button"
                    disabled={!!busy}
                    onClick={() => void go(m)}
                    className="flex w-full items-center gap-3 rounded-xl border border-border bg-card p-3 text-left transition-colors hover:bg-accent/50 disabled:opacity-60"
                  >
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-primary">
                      <Store className="size-5" />
                    </span>
                    <span className="min-w-0 flex-1 leading-tight">
                      <span className="block truncate text-sm font-semibold">{m.ecosystemName}</span>
                      <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                        {types[m.ecosystemId] ? <ShopTypeBadge type={types[m.ecosystemId]!} /> : null}
                        <span>{dashboardLabelFor(m.role)}</span>
                        {m.isActive ? <span>· current</span> : null}
                      </span>
                    </span>
                    {busy === m.ecosystemId ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : m.isActive ? (
                      <Check className="size-4 text-success" />
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}

/** The way back to the member's Universe home from any shop console. */
export function UniverseSwitch({
  mini,
  className,
  onNavigate,
}: {
  mini?: boolean;
  className?: string;
  onNavigate?: () => void;
}) {
  return (
    <Button
      asChild
      variant="outline"
      size="sm"
      className={cn("w-full gap-2", mini ? "justify-center px-0" : "justify-start", className)}
    >
      <Link to="/universe" onClick={onNavigate} aria-label="Switch to Universe" title="Switch to Universe">
        <Sparkles className="size-4 text-primary" />
        {mini ? null : (
          <span className="min-w-0 flex-1 truncate text-left">
            <span className="block">Switch to Universe</span>
            <span className="block truncate text-[10px] font-normal text-muted-foreground">
              Wallet, monitoring, rewards, social
            </span>
          </span>
        )}
      </Link>
    </Button>
  );
}
