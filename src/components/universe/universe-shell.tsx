/**
 * Universe shell — the global layer above every ecosystem.
 *
 * Identity and community live here; wallets, roles, history and reports stay
 * inside the selected ecosystem console. Mobile-first: a compact sticky header
 * and a thumb-reachable bottom bar on phones, a quiet left rail on desktop.
 *
 * Navigation is presentation only — the database authorizes every read/write.
 */
import { Link, useRouterState } from "@tanstack/react-router";
import { Bell, Home, LogOut, Mail, Store, User, Wallet } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { MemberAvatar } from "@/components/member-avatar";
import { cn } from "@/lib/utils";
import { homeFor, useSession } from "@/lib/session";
import { fetchNotifications, unreadCount } from "@/lib/notifications";

const items = [
  { to: "/universe", label: "Home", icon: Home },
  { to: "/universe/notifications", label: "Alerts", icon: Bell },
  { to: "/universe/messages", label: "Messages", icon: Mail },
  { to: "/universe/shops", label: "Shops", icon: Store },
  { to: "/universe/profile", label: "Profile", icon: User },
] as const;

/** Small unread badge; polls quietly so the count is never stale for long. */
function useUnread() {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let active = true;
    const load = () =>
      fetchNotifications(50)
        .then((rows) => active && setCount(unreadCount(rows)))
        .catch(() => undefined);
    void load();
    const timer = setInterval(load, 60_000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);
  return count;
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
  if (!account) return null;

  const active = (to: string) =>
    to === "/universe" ? pathname === "/universe" : pathname.startsWith(to);

  return (
    <div className="min-h-screen bg-app">
      <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-2.5">
          <Link to="/universe/profile" aria-label="Your profile" className="lg:hidden">
            <MemberAvatar name={account.name} className="size-8" />
          </Link>
          <div className="min-w-0 flex-1">
            <p className="truncate text-base font-semibold leading-tight">{title}</p>
            {subtitle ? (
              <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
            ) : null}
          </div>
          <Button asChild size="sm" variant="outline" className="gap-1.5">
            <Link to={homeFor(account.role)}>
              <Wallet className="size-4" />
              <span className="hidden sm:inline">My wallet</span>
            </Link>
          </Button>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-5xl gap-6 px-0 sm:px-4">
        <aside className="sticky top-16 hidden h-[calc(100vh-4rem)] w-56 shrink-0 flex-col gap-1 py-4 lg:flex">
          {items.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              aria-current={active(item.to) ? "page" : undefined}
              className={cn(
                "flex items-center gap-3 rounded-full px-4 py-2.5 text-sm font-medium transition-colors",
                active(item.to)
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
              )}
            >
              <span className="relative">
                <item.icon className="size-5" />
                {item.to === "/universe/notifications" && unread > 0 ? (
                  <span className="absolute -right-1.5 -top-1 min-w-4 rounded-full bg-destructive px-1 text-[10px] font-semibold leading-4 text-destructive-foreground">
                    {unread > 9 ? "9+" : unread}
                  </span>
                ) : null}
              </span>
              {item.label}
            </Link>
          ))}
          <button
            type="button"
            onClick={session.signOut}
            className="mt-auto flex items-center gap-3 rounded-full px-4 py-2.5 text-sm font-medium text-muted-foreground hover:bg-accent/50 hover:text-foreground"
          >
            <LogOut className="size-5" /> Sign out
          </button>
        </aside>

        <main className="min-w-0 flex-1 pb-24 pt-3 lg:pb-8">{children}</main>
      </div>

      <nav
        aria-label="Universe navigation"
        className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-border bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
      >
        {items.map((item) => (
          <Link
            key={item.to}
            to={item.to}
            aria-current={active(item.to) ? "page" : undefined}
            className={cn(
              "flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium",
              active(item.to) ? "text-primary" : "text-muted-foreground",
            )}
          >
            <span className="relative">
              <item.icon className="size-5" />
              {item.to === "/universe/notifications" && unread > 0 ? (
                <span className="absolute -right-2 -top-1 min-w-4 rounded-full bg-destructive px-1 text-[10px] font-semibold leading-4 text-destructive-foreground">
                  {unread > 9 ? "9+" : unread}
                </span>
              ) : null}
            </span>
            {item.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
