/**
 * Universe shell — the global layer above every ecosystem.
 *
 * Identity, community and discovery live here; wallets, roles, history and
 * reports of a specific shop stay inside that shop's console. The layout is a
 * modern three-column social app on desktop (left rail = navigation, centre =
 * content, right rail = the three primary destinations: Search, Profile and
 * Wallet Center) and collapses to a compact header plus a thumb-reachable
 * bottom bar on phones.
 *
 * Navigation is presentation only — the database authorizes every read/write.
 */
import { Link, useRouterState } from "@tanstack/react-router";
import {
  ArrowRight,
  Bell,
  ChevronRight,
  Home,
  LogOut,
  Mail,
  Search,
  Sparkles,
  Store,
  User,
  Users,
  Wallet,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { MemberAvatar } from "@/components/member-avatar";
import { cn } from "@/lib/utils";
import { homeFor, useSession } from "@/lib/session";
import { fetchNotifications, unreadCount } from "@/lib/notifications";
import { fetchWalletView } from "@/lib/wallet";
import { fetchMyProfile } from "@/lib/profile";
import { peso } from "@/lib/wavewallet";
import { useVisiblePoll } from "@/hooks/use-visible-poll";

/** Full navigation (desktop rail). */
const railItems = [
  { to: "/universe", label: "Home", icon: Home },
  { to: "/universe/search", label: "Search", icon: Search },
  { to: "/universe/notifications", label: "Alerts", icon: Bell },
  { to: "/universe/messages", label: "Messages", icon: Mail },
  { to: "/universe/shops", label: "Shops", icon: Store },
  { to: "/universe/members", label: "Members", icon: Users },
  { to: "/universe/wallet", label: "Wallet Center", icon: Wallet },
  { to: "/universe/profile", label: "Profile", icon: User },
] as const;

/** Five-slot bottom bar on phones; the rest is reachable from Home and Search. */
const barItems = [
  { to: "/universe", label: "Home", icon: Home },
  { to: "/universe/search", label: "Search", icon: Search },
  { to: "/universe/wallet", label: "Wallet", icon: Wallet },
  { to: "/universe/messages", label: "Messages", icon: Mail },
  { to: "/universe/profile", label: "Profile", icon: User },
] as const;

/** The three primary destinations, surfaced on the right rail. */
const primary = [
  {
    to: "/universe/search",
    label: "Search",
    blurb: "Shops, vouchers and the sellers who offer them",
    icon: Search,
  },
  {
    to: "/universe/profile",
    label: "Profile",
    blurb: "Your public identity, @handle and storefront",
    icon: User,
  },
  {
    to: "/universe/wallet",
    label: "Wallet Center",
    blurb: "Your one global Universe wallet and history",
    icon: Wallet,
  },
] as const;

/** Small unread badge; polls quietly so the count is never stale for long. */
function useUnread() {
  const [count, setCount] = useState(0);
  useVisiblePoll(() => {
    void fetchNotifications(20)
      .then((rows) => setCount(unreadCount(rows)))
      .catch(() => undefined);
  }, 60_000);
  return count;
}

/** Global wallet balance + @handle for the identity card. Read-only, RLS-scoped. */
function useIdentity(userId: string | null) {
  const [balance, setBalance] = useState<number | null>(null);
  const [handle, setHandle] = useState<string | null>(null);
  const [avatar, setAvatar] = useState<string | null>(null);
  useEffect(() => {
    if (!userId) return;
    let alive = true;
    void fetchWalletView(userId, null)
      .then((v) => alive && setBalance(v?.balance ?? 0))
      .catch(() => undefined);
    void fetchMyProfile(userId)
      .then((p) => {
        if (!alive || !p) return;
        setHandle(p.handle);
        setAvatar(p.avatar_path);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [userId]);
  return { balance, handle, avatar };
}

function Badge({ count, className }: { count: number; className?: string }) {
  if (count <= 0) return null;
  return (
    <span
      className={cn(
        "absolute -right-2 -top-1 min-w-4 rounded-full bg-destructive px-1 text-center text-[10px] font-semibold leading-4 text-destructive-foreground",
        className,
      )}
    >
      {count > 9 ? "9+" : count}
    </span>
  );
}

export function UniverseShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  const session = useSession();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const unread = useUnread();
  const account = session.account;
  const identity = useIdentity(account?.id ?? null);
  if (!account) return null;

  const active = (to: string) =>
    to === "/universe" ? pathname === "/universe" : pathname.startsWith(to);

  return (
    <div className="min-h-screen bg-app">
      {/* Mobile / tablet header */}
      <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur lg:hidden">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-2.5">
          <Link to="/universe/profile" aria-label="Your profile">
            <MemberAvatar path={identity.avatar} name={account.name} className="size-9" />
          </Link>
          <div className="min-w-0 flex-1">
            <p className="truncate text-base font-bold leading-tight tracking-tight">{title}</p>
            {subtitle ? <p className="truncate text-xs text-muted-foreground">{subtitle}</p> : null}
          </div>
          <Link
            to="/universe/notifications"
            aria-label="Alerts"
            className="relative rounded-full p-2 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <Bell className="size-5" />
            <Badge count={unread} className="-right-0.5 top-0.5" />
          </Link>
          <Link
            to="/universe/wallet"
            aria-label="Wallet Center"
            className="flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-semibold shadow-[var(--shadow-card)]"
          >
            <Wallet className="size-4 text-primary" />
            <span className="tabular-nums">
              {identity.balance === null ? "…" : peso(identity.balance)}
            </span>
          </Link>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-[1400px] gap-5 px-0 sm:px-4 xl:gap-7">
        {/* Left rail — full navigation */}
        <aside className="sticky top-0 hidden h-screen w-56 shrink-0 flex-col py-5 lg:flex xl:w-60">
          <Link to="/universe" className="mb-5 flex items-center gap-2.5 px-3">
            <span className="flex size-10 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-[var(--shadow-card)]">
              <Sparkles className="size-5" />
            </span>
            <span className="leading-tight">
              <span className="block text-lg font-bold tracking-tight">Universe</span>
              <span className="block text-[11px] text-muted-foreground">WaveWallet community</span>
            </span>
          </Link>

          <nav aria-label="Universe navigation" className="flex flex-col gap-0.5">
            {railItems.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                aria-current={active(item.to) ? "page" : undefined}
                className={cn(
                    "group flex items-center gap-3 rounded-lg px-3 py-2.5 text-[15px] transition-colors",
                  active(item.to)
                    ? "bg-brand-soft font-bold text-primary"
                    : "font-medium text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                )}
              >
                <span className="relative">
                  <item.icon className={cn("size-6", active(item.to) && "stroke-[2.5]")} />
                  {item.to === "/universe/notifications" ? <Badge count={unread} /> : null}
                </span>
                {item.label}
              </Link>
            ))}
          </nav>

          <Button asChild className="mt-4 h-11 rounded-lg text-[15px] font-semibold">
            <Link to="/universe/search">
              <Search className="size-4" /> Find vouchers & sellers
            </Link>
          </Button>

          <div className="mt-auto space-y-2">
            <Button
              asChild
              variant="outline"
              size="sm"
              className="w-full justify-start gap-2 rounded-lg"
            >
              <Link to={homeFor(account.role)}>
                <Store className="size-4" /> My shop console
              </Link>
            </Button>
            <Link
              to="/universe/profile"
              className="flex items-center gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-accent/60"
            >
              <MemberAvatar path={identity.avatar} name={account.name} className="size-9" />
              <span className="min-w-0 flex-1 leading-tight">
                <span className="block truncate text-sm font-semibold">{account.name}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {identity.handle ? `@${identity.handle}` : "Set up your @handle"}
                </span>
              </span>
              <button
                type="button"
                aria-label="Sign out"
                onClick={(e) => {
                  e.preventDefault();
                  session.signOut();
                }}
                className="rounded-full p-1.5 text-muted-foreground hover:text-destructive"
              >
                <LogOut className="size-4" />
              </button>
            </Link>
          </div>
        </aside>

        {/* Centre column */}
        <main className="min-w-0 flex-1 pb-24 lg:max-w-2xl lg:border-x lg:border-border lg:pb-8">
          <div className="sticky top-0 z-30 hidden items-center gap-3 border-b border-border bg-background/85 px-4 py-3 backdrop-blur lg:flex">
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-lg font-bold tracking-tight">{title}</h1>
              {subtitle ? (
                <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
              ) : null}
            </div>
          </div>
          <div className="pt-3 lg:px-0">{children}</div>
        </main>

        {/* Right rail — primary destinations */}
        <aside className="sticky top-0 hidden h-screen w-72 shrink-0 flex-col gap-4 overflow-y-auto py-5 xl:flex">
          <section
            aria-label="Primary destinations"
            className="overflow-hidden rounded-lg border border-border bg-card shadow-[var(--shadow-card)]"
          >
            <div className="border-b border-border px-4 py-3">
              <p className="text-sm font-bold tracking-tight">Start here</p>
              <p className="text-xs text-muted-foreground">
                Everything a member needs, one tap away.
              </p>
            </div>
            <ul className="divide-y divide-border">
              {primary.map((p) => (
                <li key={p.to}>
                  <Link
                    to={p.to}
                    aria-current={active(p.to) ? "page" : undefined}
                    className={cn(
                      "flex items-center gap-3 px-4 py-3 transition-colors hover:bg-accent/50",
                      active(p.to) && "bg-brand-soft/60",
                    )}
                  >
                    <span
                      className={cn(
                         "flex size-10 shrink-0 items-center justify-center rounded-lg",
                        active(p.to)
                          ? "bg-primary text-primary-foreground"
                          : "bg-brand-soft text-primary",
                      )}
                    >
                      <p.icon className="size-5" />
                    </span>
                    <span className="min-w-0 flex-1 leading-tight">
                      <span className="block text-sm font-semibold">{p.label}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {p.blurb}
                      </span>
                    </span>
                    <ChevronRight className="size-4 text-muted-foreground" />
                  </Link>
                </li>
              ))}
            </ul>
          </section>

          <section className="rounded-lg border border-border bg-card p-4 shadow-[var(--shadow-card)]">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Universe wallet
            </p>
            <p className="mt-1 text-2xl font-bold tabular-nums tracking-tight text-success">
              {identity.balance === null ? "…" : peso(identity.balance)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              One global balance for vouchers from any Universe seller. Posting, replies, likes and
              messages are always free.
            </p>
            <Button asChild size="sm" variant="outline" className="mt-3 w-full rounded-lg">
              <Link to="/universe/wallet">
                Open Wallet Center <ArrowRight className="size-4" />
              </Link>
            </Button>
          </section>

          <section className="rounded-lg border border-border bg-card shadow-[var(--shadow-card)]">
            <p className="px-4 pt-3 text-sm font-bold tracking-tight">Explore</p>
            <ul className="py-1 text-sm">
              {[
                { to: "/universe/shops", label: "Shops directory", icon: Store },
                { to: "/universe/members", label: "Members near you", icon: Users },
                { to: "/universe/messages", label: "Direct messages", icon: Mail },
                { to: "/universe/notifications", label: "Alerts", icon: Bell },
              ].map((l) => (
                <li key={l.to}>
                  <Link
                    to={l.to}
                    className="flex items-center gap-3 px-4 py-2 text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
                  >
                    <l.icon className="size-4" /> {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </div>

      {/* Mobile bottom bar */}
      <nav
        aria-label="Universe navigation"
        className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-border bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
      >
        {barItems.map((item) => (
          <Link
            key={item.to}
            to={item.to}
            aria-current={active(item.to) ? "page" : undefined}
            className={cn(
              "flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium",
              active(item.to) ? "text-primary" : "text-muted-foreground",
            )}
          >
            <span
              className={cn(
                "relative flex h-7 w-12 items-center justify-center rounded-full transition-colors",
                active(item.to) && "bg-brand-soft",
              )}
            >
              <item.icon className={cn("size-5", active(item.to) && "stroke-[2.5]")} />
              {item.to === "/universe/messages" ? null : null}
            </span>
            {item.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
