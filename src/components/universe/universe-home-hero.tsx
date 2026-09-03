/**
 * Quick-start strip at the top of the Universe home feed.
 *
 * A brand-new member with zero shops lands here; these tiles answer "what can
 * I do?" in one glance and point at the existing destinations — nothing here
 * is a new feature, only discoverability.
 */
import { Link } from "@tanstack/react-router";
import { ArrowRight, Search } from "lucide-react";
import { Button } from "@/components/ui/button";

export function UniverseHomeHero() {
  return (
    <section aria-label="Get started" className="space-y-3 px-4 sm:px-0">
      <div className="overflow-hidden rounded-lg border border-border bg-card shadow-[var(--shadow-card)]">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 p-4 sm:p-5">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase text-primary">WaveWallet Universe</p>
            <h2 className="mt-1 text-xl font-bold leading-tight sm:text-2xl">Discover. Connect. Buy with confidence.</h2>
            <p className="mt-1 max-w-xl text-sm text-muted-foreground">
              Find vouchers, choose an authorized seller, and shop with your global wallet.
            </p>
          </div>
          <span className="hidden size-14 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-primary sm:flex">
            <Search className="size-7" />
          </span>
        </div>
        <div className="border-t border-border bg-muted/30 p-3 sm:px-5">
          <Button asChild className="h-11 w-full justify-between sm:w-auto">
            <Link to="/universe/search">
              <span className="flex items-center gap-2"><Search className="size-4" /> Search shops &amp; vouchers</span>
              <ArrowRight className="size-4" />
            </Link>
          </Button>
        </div>
      </div>

    </section>
  );
}
