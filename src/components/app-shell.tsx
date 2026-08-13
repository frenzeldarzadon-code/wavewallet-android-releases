import { Link, useRouterState, type LinkProps } from "@tanstack/react-router";
import { Menu, ShieldCheck, LogOut, ArrowLeft, FlaskConical, UserCheck } from "lucide-react";
import type { ComponentType, ReactNode } from "react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { writeSession, type ResolvedSession } from "@/lib/session";
import { DEMO_ECOSYSTEM_SLUG } from "@/lib/demo";
import { platformSettings } from "@/lib/wavewallet";

export interface NavItem {
  to: NonNullable<LinkProps["to"]>;
  label: string;
  icon: ComponentType<{ className?: string }>;
}

interface Props {
  session: ResolvedSession;
  nav: NavItem[];
  /** Items shown in the mobile bottom bar (subset of nav). */
  bottomNav?: NavItem[];
  title: string;
  subtitle?: string;
  children: ReactNode;
}

export function AppShell({ session, nav, bottomNav, title, subtitle, children }: Props) {
  const [open, setOpen] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const bottom = (bottomNav ?? nav).slice(0, 5);
  const superMode = session.session?.superAdminMode && session.account?.role === "super_admin";
  const isDemo =
    session.ecosystem?.slug === DEMO_ECOSYSTEM_SLUG ||
    (session.account?.email ?? "").endsWith("@wavewallet.demo");

  const isActive = (to: string) => pathname === to || (to !== "/" && pathname.startsWith(to + "/"));

  const NavLinks = ({ onNavigate }: { onNavigate?: () => void }) => (
    <nav className="flex flex-col gap-1">
      {nav.map((item) => (
        <Link
          key={item.to}
          to={item.to}
          onClick={onNavigate}
          className={cn(
            "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
            isActive(String(item.to))
              ? "bg-accent text-accent-foreground"
              : "text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          <item.icon className="size-4.5 shrink-0" />
          {item.label}
        </Link>
      ))}
    </nav>
  );

  return (
    <div className="min-h-screen bg-background">
      {isDemo ? (
        <div className="flex items-center justify-center gap-2 bg-warning px-4 py-1.5 text-center text-[11px] font-semibold uppercase tracking-wide text-warning-foreground sm:text-xs">
          <FlaskConical className="size-3.5 shrink-0" />
          Demo / preview environment — sample data only, not live customer data
        </div>
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
            Super Admin Mode — viewing {session.ecosystem?.name ?? "tenant"} ecosystem. Actions are audited.
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

      <div className="mx-auto flex w-full max-w-7xl">
        <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-border bg-sidebar p-4 lg:flex">
          <Brand ecosystem={session.ecosystem?.name} />
          <div className="mt-6 flex-1 overflow-y-auto">
            <NavLinks />
          </div>
          <AccountBlock session={session} />
        </aside>

        <div className="min-w-0 flex-1">
          <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-border bg-background/85 px-4 py-3 backdrop-blur lg:px-8">
            <Sheet open={open} onOpenChange={setOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open menu">
                  <Menu className="size-5" />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-72 p-4">
                <SheetTitle className="sr-only">Navigation</SheetTitle>
                <Brand ecosystem={session.ecosystem?.name} />
                <div className="mt-6">
                  <NavLinks onNavigate={() => setOpen(false)} />
                </div>
                <div className="mt-6">
                  <AccountBlock session={session} />
                </div>
              </SheetContent>
            </Sheet>
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-base font-semibold tracking-tight sm:text-lg">{title}</h1>
              {subtitle ? (
                <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
              ) : null}
            </div>
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

          <main className="px-4 pt-4 pb-28 lg:px-8 lg:pb-10">{children}</main>
        </div>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 backdrop-blur lg:hidden">
        <div className="mx-auto flex max-w-lg items-stretch">
          {bottom.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className={cn(
                "flex flex-1 flex-col items-center gap-1 py-2.5 text-[11px] font-medium",
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
  );
}

function Brand({ ecosystem }: { ecosystem?: string | undefined }) {
  return (
    <div className="flex items-center gap-3">
      <div className="surface-gradient flex size-9 items-center justify-center rounded-xl text-sm font-bold text-primary-foreground">
        W
      </div>
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold leading-tight">
          {ecosystem ?? platformSettings.productName}
        </p>
        <p className="text-[11px] text-muted-foreground">
          {ecosystem ? `on ${platformSettings.productName}` : "Platform console"}
        </p>
      </div>
    </div>
  );
}

function AccountBlock({ session }: { session: ResolvedSession }) {
  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <p className="truncate text-sm font-medium">{session.account?.name}</p>
      <p className="truncate text-xs capitalize text-muted-foreground">
        {session.account?.role.replace("_", " ")}
      </p>
      <Button variant="outline" size="sm" className="mt-3 w-full" onClick={session.signOut}>
        <LogOut className="size-3.5" /> Sign out
      </Button>
    </div>
  );
}
