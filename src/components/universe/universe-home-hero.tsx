/**
 * Quick-start strip at the top of the Universe home feed.
 *
 * A brand-new member with zero shops lands here; these tiles answer "what can
 * I do?" in one glance and point at the existing destinations — nothing here
 * is a new feature, only discoverability.
 */
import { Link } from "@tanstack/react-router";
import { ArrowRight, Bell, Gift, Mail, Search, Store, User, Users, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";

const tiles = [
  {
    to: "/universe/wallet",
    title: "Wallet Center",
    blurb: "Coins, purchases & history",
    icon: Wallet,
    tone: "bg-success text-success-foreground",
  },
  {
    to: "/universe/profile",
    title: "My profile",
    blurb: "Identity, posts & storefront",
    icon: User,
    tone: "bg-brand-soft text-primary",
  },
  {
    to: "/universe/shops",
    title: "Universe shops",
    blurb: "Browse shops & rewards",
    icon: Store,
    tone: "bg-brand-soft text-primary",
  },
] as const;

const chips = [
  { to: "/universe/members", label: "Members", icon: Users },
  { to: "/universe/messages", label: "Messages", icon: Mail },
  { to: "/universe/notifications", label: "Alerts", icon: Bell },
  { to: "/universe/shops", label: "Rewards", icon: Gift },
] as const;

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

      <div className="grid grid-cols-3 gap-2">
        {tiles.map((t) => (
          <Link
            key={t.to}
            to={t.to}
            className="flex min-w-0 flex-col gap-2 rounded-lg border border-border bg-card p-3 shadow-[var(--shadow-card)] transition-colors hover:border-primary/30 hover:bg-accent/30"
          >
            <span className={`flex size-9 items-center justify-center rounded-lg ${t.tone}`}>
              <t.icon className="size-4.5" />
            </span>
            <span className="leading-tight">
              <span className="block truncate text-xs font-bold sm:text-sm">{t.title}</span>
              <span className="hidden text-xs text-muted-foreground sm:block">{t.blurb}</span>
            </span>
          </Link>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border pb-3 lg:hidden">
        {chips.map((c) => (
          <Link
            key={c.to}
            to={c.to}
            className="inline-flex min-h-9 items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground"
          >
            <c.icon className="size-3.5" /> {c.label}
          </Link>
        ))}
      </div>
    </section>
  );
}
