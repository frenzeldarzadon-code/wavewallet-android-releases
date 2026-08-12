import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowRight, ShieldCheck, Store, Users, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusBadge } from "@/components/ui-kit";
import { homeFor, writeSession } from "@/lib/session";
import { accounts, platformSettings, type Role } from "@/lib/wavewallet";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "WaveWallet — Voucher & Wallet Platform for Hotspot Operators" },
      {
        name: "description",
        content:
          "WaveWallet is a multi-tenant credit wallet, voucher marketplace and rewards platform for Omada hotspot operators, resellers and their customers.",
      },
      { property: "og:title", content: "WaveWallet — Voucher & Wallet Platform for Hotspot Operators" },
      {
        property: "og:description",
        content:
          "Run your hotspot shop: credit wallets, voucher inventory, reseller network, points and rewards — all in one mobile-first console.",
      },
    ],
  }),
  component: LoginPage,
});

const demoRoles: {
  role: Role;
  accountId: string;
  label: string;
  blurb: string;
  icon: typeof ShieldCheck;
}[] = [
  {
    role: "super_admin",
    accountId: "acc_super",
    label: "Super Admin",
    blurb: "Platform owner — all tenants, plans and approvals",
    icon: ShieldCheck,
  },
  {
    role: "admin",
    accountId: "acc_admin_sagada",
    label: "Admin",
    blurb: "Owns one ecosystem: vouchers, resellers, reports",
    icon: Store,
  },
  {
    role: "reseller",
    accountId: "acc_res_1",
    label: "Reseller",
    blurb: "Credit wallet, discounts, loads and redemptions",
    icon: Users,
  },
  {
    role: "customer",
    accountId: "acc_cus_1",
    label: "Customer",
    blurb: "Buy vouchers, transfer credits, redeem rewards",
    icon: Wallet,
  },
];

function LoginPage() {
  const navigate = useNavigate();

  const signIn = (accountId: string, role: Role) => {
    writeSession({ accountId });
    navigate({ to: homeFor(role) });
  };

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-2">
      <div className="surface-gradient relative overflow-hidden px-6 py-10 text-primary-foreground lg:flex lg:flex-col lg:justify-between lg:px-12 lg:py-14">
        <div>
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-xl bg-background/15 text-lg font-bold">
              W
            </div>
            <div>
              <p className="text-lg font-semibold leading-tight">{platformSettings.productName}</p>
              <p className="text-xs opacity-80">Multi-tenant hotspot commerce</p>
            </div>
          </div>
          <h1 className="mt-10 max-w-md text-3xl font-semibold leading-tight tracking-tight lg:text-4xl">
            Run your hotspot shop like a real business.
          </h1>
          <p className="mt-3 max-w-md text-sm opacity-90">
            Closed-loop credit wallets, voucher inventory with duplicate-safe imports, reseller
            networks, points and physical rewards — each operator fully isolated in their own
            ecosystem.
          </p>
          <ul className="mt-6 space-y-2 text-sm opacity-90">
            {[
              "Atomic voucher dispensing — a code is never sold twice",
              "Immutable ledger for every credit and point movement",
              "Reseller discount and earnings captured at sale time",
              "Subscription gating with approval workflow",
            ].map((line) => (
              <li key={line} className="flex items-start gap-2">
                <ArrowRight className="mt-0.5 size-4 shrink-0" />
                {line}
              </li>
            ))}
          </ul>
        </div>
        <p className="mt-10 hidden text-xs opacity-70 lg:block">
          No Omada API dependency. Voucher codes are imported manually in this version.
        </p>
      </div>

      <div className="flex items-center justify-center px-4 py-10 lg:px-12">
        <div className="w-full max-w-md">
          <h2 className="text-xl font-semibold tracking-tight">Sign in</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Choose a demo role to explore the console. Real authentication connects next.
          </p>

          <Card className="mt-5 shadow-[var(--shadow-card)]">
            <CardContent className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="email">Email or mobile number</Label>
                <Input id="email" placeholder="you@example.com" autoComplete="username" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password">Password</Label>
                <Input id="password" type="password" placeholder="••••••••" autoComplete="current-password" />
              </div>
              <Button className="w-full" onClick={() => signIn("acc_cus_1", "customer")}>
                Continue
              </Button>
              <p className="text-center text-[11px] text-muted-foreground">
                Demo build — credentials are not verified yet.
              </p>
            </CardContent>
          </Card>

          <div className="mt-6">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Demo accounts
              </p>
              <StatusBadge tone="brand">Sample data</StatusBadge>
            </div>
            <div className="grid gap-2">
              {demoRoles.map((r) => {
                const acct = accounts.find((a) => a.id === r.accountId);
                return (
                  <button
                    key={r.role}
                    onClick={() => signIn(r.accountId, r.role)}
                    className="flex w-full items-center gap-3 rounded-xl border border-border bg-card px-3 py-3 text-left transition-colors hover:border-primary/40 hover:bg-accent"
                  >
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-accent-foreground">
                      <r.icon className="size-4.5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium">{r.label}</span>
                      <span className="block truncate text-xs text-muted-foreground">{r.blurb}</span>
                    </span>
                    <span className="hidden shrink-0 text-right text-[11px] text-muted-foreground sm:block">
                      {acct?.name}
                    </span>
                    <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
