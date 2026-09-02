/**
 * Quick-start strip at the top of the Universe home feed.
 *
 * A brand-new member with zero shops lands here; these tiles answer "what can
 * I do?" in one glance and point at the existing destinations — nothing here
 * is a new feature, only discoverability.
 */
import { Link } from "@tanstack/react-router";
import { Mail, Search, Store, User, Users, Wallet } from "lucide-react";

const tiles = [
  {
    to: "/universe/search",
    title: "Find vouchers",
    blurb: "Search shops & products, pick a seller",
    icon: Search,
    tone: "bg-primary text-primary-foreground",
  },
  {
    to: "/universe/wallet",
    title: "Wallet Center",
    blurb: "Your one global Universe wallet",
    icon: Wallet,
    tone: "bg-success text-success-foreground",
  },
  {
    to: "/universe/profile",
    title: "My profile",
    blurb: "Name, @handle, photo & storefront",
    icon: User,
    tone: "bg-brand-soft text-primary",
  },
  {
    to: "/universe/shops",
    title: "Shops directory",
    blurb: "Browse & join Universe shops",
    icon: Store,
    tone: "bg-brand-soft text-primary",
  },
] as const;

const chips = [
  { to: "/universe/members", label: "Members", icon: Users },
  { to: "/universe/messages", label: "Messages", icon: Mail },
] as const;

export function UniverseHomeHero() {
  return (
    <section aria-label="Get started" className="space-y-2 px-4 sm:px-0">
      <div className="-mx-4 flex snap-x gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0 lg:grid-cols-4">
        {tiles.map((t) => (
          <Link
            key={t.to}
            to={t.to}
            className="flex min-w-[11.5rem] snap-start flex-col gap-2 rounded-2xl border border-border bg-card p-3 shadow-[var(--shadow-card)] transition-transform hover:-translate-y-0.5 sm:min-w-0"
          >
            <span className={`flex size-9 items-center justify-center rounded-xl ${t.tone}`}>
              <t.icon className="size-4.5" />
            </span>
            <span className="leading-tight">
              <span className="block text-sm font-bold tracking-tight">{t.title}</span>
              <span className="block text-xs text-muted-foreground">{t.blurb}</span>
            </span>
          </Link>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2 lg:hidden">
        {chips.map((c) => (
          <Link
            key={c.to}
            to={c.to}
            className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            <c.icon className="size-3.5" /> {c.label}
          </Link>
        ))}
        <span className="ml-auto text-[11px] text-muted-foreground">Posting is free</span>
      </div>
    </section>
  );
}
