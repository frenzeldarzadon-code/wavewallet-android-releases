/**
 * Application shell: collapsible grouped sidebar (desktop/tablet), slide-out
 * drawer (mobile) and a compact bottom bar for the most-used destinations.
 *
 * Navigation is presentation only — every read and write is still authorized by
 * the database, so what the sidebar shows never widens a role's permissions.
 */
import { Link, useRouterState } from "@tanstack/react-router";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  FlaskConical,
  LogOut,
  Menu,
  ShieldCheck,
  UserCheck,
} from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { EcosystemSwitcher } from "@/components/ecosystem-switcher";
import { SuperAdminBadge } from "@/components/role-badge";
import { ReviewBanner } from "@/components/review-banner";
import { NotificationBell } from "@/components/notification-bell";


import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { writeSession, type ResolvedSession } from "@/lib/session";
import { DEMO_ECOSYSTEM_SLUG } from "@/lib/demo";
import { platformSettings } from "@/lib/wavewallet";
import type { Nav, NavGroup, NavItem } from "@/lib/navigation";

export type { NavItem } from "@/lib/navigation";
import { applyBottomNavLayout, applyNavLayout } from "@/lib/ui-layout";
import { useDeveloperMode, useRoleLayout } from "@/lib/dev-mode";
import { RoleLayoutProvider } from "@/components/dev/dev-slot";
import { DeveloperModeBanner } from "@/components/dev/developer-mode-banner";

const COLLAPSE_KEY = "ww.sidebar.collapsed";

interface Props {
  session: ResolvedSession;
  /** Grouped sidebar, or a flat list which is treated as one unlabelled group. */
  nav: Nav | NavItem[];
  /** Items shown in the mobile bottom bar (subset of nav). */
  bottomNav?: NavItem[];
  title: string;
  subtitle?: string;
  children: ReactNode;
}

const toGroups = (nav: Nav | NavItem[]): NavGroup[] =>
  nav.length > 0 && "items" in (nav[0] as NavGroup)
    ? (nav as NavGroup[])
    : [{ items: nav as NavItem[] }];

export function AppShell({ session, nav, bottomNav, title, subtitle, children }: Props) {
  const [drawer, setDrawer] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  // Developer Mode: the stored layout for this ROLE decides which tabs are
  // shown and in what order. Routes, data and permissions are untouched.
  const role = session.account?.role ?? null;
  const layout = useRoleLayout(role);
  // While acting as a member, the operator is the one who may see Developer Mode.
  const dev = useDeveloperMode(session.actingAs?.operatorRole ?? role);
  const groups = applyNavLayout(toGroups(nav), layout);
  const flat = groups.flatMap((g) => g.items);
  const bottom = applyBottomNavLayout(bottomNav ?? flat, layout).slice(0, 5);
  const superMode = session.session?.superAdminMode && session.account?.role === "super_admin";
  const isDemo =
    session.ecosystem?.slug === DEMO_ECOSYSTEM_SLUG ||
    (session.account?.email ?? "").endsWith("@wavewallet.demo");

  useEffect(() => {
    if (typeof window === "undefined") return;
    setCollapsed(window.localStorage.getItem(COLLAPSE_KEY) === "1");
  }, []);

  const toggleCollapsed = () => {
    setCollapsed((c) => {
      const next = !c;
      if (typeof window !== "undefined") {
        window.localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
      }
      return next;
    });
  };

  const isActive = (to: string) => pathname === to || (to !== "/" && pathname.startsWith(to + "/"));

  const NavLinks = ({ mini, onNavigate }: { mini?: boolean; onNavigate?: () => void }) => (
    <nav className="flex flex-col gap-4" aria-label="Main navigation">
      {groups.map((group, gi) => (
        <div key={group.label ?? `group-${gi}`} className="flex flex-col gap-1">
          {group.label && !mini ? (
            <p className="px-3 pb-0.5 text-[11px] font-semibold uppercase tracking-wider text-sidebar-foreground/55">
              {group.label}
            </p>
          ) : null}
          {group.label && mini ? <div className="mx-auto my-1 h-px w-6 bg-sidebar-border" /> : null}
          {group.items.map((item) => {
            const active = isActive(String(item.to));
            const link = (
              <Link
                key={item.to}
                to={item.to}
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                title={mini ? item.label : undefined}
                className={cn(
                  "group relative flex items-center rounded-xl text-sm font-medium transition-colors",
                  mini ? "justify-center px-0 py-2.5" : "gap-3 px-3 py-2.5",
                  active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground shadow-[var(--shadow-card)]"
                    : "text-sidebar-foreground/75 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground",
                )}
              >
                <span
                  className={cn(
                    "absolute left-0 top-1/2 h-6 w-1 -translate-y-1/2 rounded-r-full bg-primary transition-opacity",
                    active ? "opacity-100" : "opacity-0",
                  )}
                  aria-hidden
                />
                <item.icon className="size-4.5 shrink-0" />
                {mini ? null : <span className="flex-1 truncate">{item.label}</span>}
                {item.badge && item.badge > 0 ? (
                  <span
                    className={cn(
                      "rounded-full bg-destructive px-1.5 py-0.5 text-[11px] font-semibold leading-none text-destructive-foreground",
                      mini && "absolute right-1 top-1 px-1",
                    )}
                  >
                    {item.badge > 99 ? "99+" : item.badge}
                  </span>
                ) : null}
              </Link>
            );
            return mini ? (
              <Tooltip key={item.to}>
                <TooltipTrigger asChild>{link}</TooltipTrigger>
                <TooltipContent side="right">{item.label}</TooltipContent>
              </Tooltip>
            ) : (
              link
            );
          })}
        </div>
      ))}
    </nav>
  );

  return (
    // The collapsed sidebar renders tooltips for its icon-only links. Radix
    // tooltips must sit inside a provider — without it the whole console throws
    // on render for anyone whose sidebar is collapsed.
    <TooltipProvider delayDuration={150}>
    <div className="min-h-screen bg-app">

      {isDemo ? (
        <div className="flex items-center justify-center gap-2 bg-warning px-4 py-1.5 text-center text-[11px] font-semibold uppercase tracking-wide text-warning-foreground sm:text-xs">
          <FlaskConical className="size-3.5 shrink-0" />
          Demo / preview environment — sample data only, not live customer data
        </div>
      ) : null}
      <ReviewBanner />
      {dev.enabled ? (
        <DeveloperModeBanner
          {...(session.actingAs ? { inspecting: session.actingAs.session.targetName } : {})}
        />
      ) : null}
      {session.actingAs ? (
        <div className="sticky top-0 z-50 flex flex-wrap items-center justify-between gap-2 bg-destructive px-4 py-2 text-destructive-foreground">
          <div className="flex items-center gap-2 text-xs font-semibold sm:text-sm">
            <UserCheck className="size-4 shrink-0" />
            <span>
              ACTING AS {session.actingAs.session.targetName} — all changes are recorded under{" "}
              {session.actingAs.operatorRole === "super_admin" ? "Super Admin" : "Admin"}{" "}
              {session.actingAs.operatorName}
            </span>
          </div>
          <button
            type="button"
            onClick={session.exitActingAs}
            className="inline-flex items-center gap-1.5 rounded-full bg-background/15 px-3 py-1 text-xs font-semibold hover:bg-background/25"
          >
            <ArrowLeft className="size-3.5" /> Exit account
          </button>
        </div>
      ) : null}
      {superMode ? (
        <div className="sticky top-0 z-50 flex flex-wrap items-center justify-between gap-2 bg-destructive px-4 py-2 text-destructive-foreground">
          <div className="flex items-center gap-2 text-xs font-semibold sm:text-sm">
            <ShieldCheck className="size-4" />
            Super Admin Mode — viewing {session.ecosystem?.name ?? "tenant"} ecosystem. Actions are
            audited.
          </div>
          <Link
            to="/super"
            onClick={() => writeSession({ accountId: session.account!.id })}
            className="inline-flex items-center gap-1.5 rounded-full bg-background/15 px-3 py-1 text-xs font-semibold hover:bg-background/25"
          >
            <ArrowLeft className="size-3.5" /> Return to Super Admin
          </Link>
        </div>
      ) : null}

      <div className="flex w-full">
        <aside
          data-collapsed={collapsed ? "true" : "false"}
          className={cn(
            "sticky top-0 hidden h-screen shrink-0 flex-col border-r border-sidebar-border bg-sidebar p-3 transition-[width] duration-200 lg:flex",
            collapsed ? "w-[76px]" : "w-64",
          )}
        >
          <Brand ecosystem={session.ecosystem?.name} mini={collapsed} />
          {session.account?.role === "super_admin" ? null : (
            <div className="mt-3">
              <EcosystemSwitcher mini={collapsed} />
            </div>
          )}
          <div className="mt-6 flex-1 overflow-y-auto">
            <NavLinks mini={collapsed} />
          </div>

          <Button
            variant="ghost"
            size="sm"
            onClick={toggleCollapsed}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-expanded={!collapsed}
            className="mb-2 w-full justify-center text-sidebar-foreground/70"
          >
            {collapsed ? <ChevronRight className="size-4" /> : <ChevronLeft className="size-4" />}
            {collapsed ? null : <span className="ml-1 text-xs">Collapse</span>}
          </Button>
          <AccountBlock session={session} mini={collapsed} />
        </aside>

        <div className="min-w-0 flex-1">
          <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-border bg-background/85 px-4 py-3 backdrop-blur lg:px-8">
            <Button
              variant="ghost"
              size="icon"
              className="lg:hidden"
              aria-label="Open menu"
              onClick={() => setDrawer(true)}
            >
              <Menu className="size-5" />
            </Button>
            <Sheet open={drawer} onOpenChange={setDrawer}>
              <SheetContent side="left" className="w-[17rem] overflow-y-auto bg-sidebar p-4">
                <SheetTitle className="sr-only">Navigation</SheetTitle>
                <Brand ecosystem={session.ecosystem?.name} />
                {session.account?.role === "super_admin" ? null : (
                  <div className="mt-3">
                    <EcosystemSwitcher />
                  </div>
                )}
                <div className="mt-6">
                  <NavLinks onNavigate={() => setDrawer(false)} />
                </div>

                <div className="mt-6">
                  <AccountBlock session={session} />
                </div>
              </SheetContent>
            </Sheet>
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-base font-semibold tracking-tight sm:text-lg">
                {title}
              </h1>
              {subtitle ? <p className="truncate text-xs text-muted-foreground">{subtitle}</p> : null}
            </div>
            <NotificationBell />
            <Button
              variant="ghost"
              size="icon"
              className="lg:hidden"
              aria-label="Sign out"
              onClick={session.signOut}
            >
              <LogOut className="size-4.5" />
            </Button>
          </header>

          <main className="mx-auto w-full max-w-5xl px-4 pt-4 pb-28 lg:px-8 lg:pb-10">
            <RoleLayoutProvider role={role}>
              {children}
            </RoleLayoutProvider>
          </main>
        </div>
      </div>

      <nav
        className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 backdrop-blur lg:hidden"
        aria-label="Quick navigation"
      >
        <div className="mx-auto flex max-w-lg items-stretch">
          {bottom.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              aria-current={isActive(String(item.to)) ? "page" : undefined}
              className={cn(
                "flex min-h-12 flex-1 flex-col items-center gap-1 py-2.5 text-[11px] font-medium",
                isActive(String(item.to)) ? "text-primary" : "text-muted-foreground",
              )}
            >
              <item.icon className="size-5" />
              <span className="truncate px-0.5">{item.label}</span>
            </Link>
          ))}
        </div>
      </nav>
    </div>
    </TooltipProvider>
  );

}

function Brand({ ecosystem, mini }: { ecosystem?: string | undefined; mini?: boolean }) {
  return (
    <div className={cn("flex items-center gap-3", mini && "justify-center")}>
      <div className="surface-gradient flex size-9 shrink-0 items-center justify-center rounded-xl text-sm font-bold text-primary-foreground">
        OW
      </div>
      {mini ? null : (
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold leading-tight text-sidebar-foreground">
            {ecosystem ?? platformSettings.productName}
          </p>
          <p className="text-[11px] text-sidebar-foreground/60">
            {ecosystem ? `on ${platformSettings.productName}` : "Platform console"}
          </p>
        </div>
      )}
    </div>
  );
}

function AccountBlock({ session, mini }: { session: ResolvedSession; mini?: boolean }) {
  if (mini) {
    return (
      <Button
        variant="ghost"
        size="icon"
        className="mx-auto"
        aria-label="Sign out"
        onClick={session.signOut}
      >
        <LogOut className="size-4" />
      </Button>
    );
  }
  return (
    <div className="rounded-xl border border-sidebar-border bg-card p-3">
      <p className="truncate text-sm font-medium">{session.account?.name}</p>
      {session.account?.role === "super_admin" ? (
        <SuperAdminBadge className="mt-1" />
      ) : (
        <p className="truncate text-xs capitalize text-muted-foreground">
          {session.account?.role.replace("_", " ")}
        </p>
      )}
      <Button variant="outline" size="sm" className="mt-3 w-full" onClick={session.signOut}>
        <LogOut className="size-3.5" /> Sign out
      </Button>
    </div>
  );
}
