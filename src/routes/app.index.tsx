import { createFileRoute, Link } from "@tanstack/react-router";
import { Facebook, Gift, Send, ShoppingBag, Sparkles, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PageSection, StatusBadge } from "@/components/ui-kit";
import { useSession } from "@/lib/session";
import { getAccount, ledgerFor, peso, redemptionsIn, shortDateTime } from "@/lib/wavewallet";

export const Route = createFileRoute("/app/")({
  head: () => ({
    meta: [
      { title: "My Wallet — WaveWallet" },
      { name: "description", content: "Your credit wallet, points balance, recent transactions and quick actions." },
      { property: "og:title", content: "My Wallet — WaveWallet" },
      { property: "og:description", content: "Your credit wallet, points balance, recent transactions and quick actions." },
    ],
  }),
  component: CustomerHome,
});

function CustomerHome() {
  const { account, ecosystem } = useSession("customer");
  if (!account || !ecosystem) return null;

  const entries = ledgerFor(account.id);
  const pending = redemptionsIn(ecosystem.id).filter(
    (r) => r.accountId === account.id && r.status === "pending",
  );
  const reseller = account.resellerId ? getAccount(account.resellerId) : null;

  return (
    <>
      <div className="mb-5 grid gap-3 sm:grid-cols-2">
        <Card className="credit-gradient border-0 text-primary-foreground shadow-[var(--shadow-float)]">
          <CardContent className="space-y-1">
            <div className="flex items-center justify-between">
              <p className="text-xs opacity-85">Credit wallet</p>
              <Wallet className="size-4 opacity-80" />
            </div>
            <p className="text-3xl font-semibold tracking-tight">{peso(account.creditBalance)}</p>
            <p className="text-[11px] opacity-80">
              Usable inside {ecosystem.name} only · not withdrawable
            </p>
          </CardContent>
        </Card>
        <Card className="surface-gradient border-0 text-primary-foreground shadow-[var(--shadow-float)]">
          <CardContent className="space-y-1">
            <div className="flex items-center justify-between">
              <p className="text-xs opacity-85">Points</p>
              <Sparkles className="size-4 opacity-80" />
            </div>
            <p className="text-3xl font-semibold tracking-tight">{account.pointsBalance}</p>
            <p className="text-[11px] opacity-80">
              {account.pointsHeld ? `${account.pointsHeld} pts on hold · ` : ""}₱{ecosystem.pointsPerPeso} spend = 1 point
            </p>
          </CardContent>
        </Card>
      </div>

      <PageSection>
        <div className="grid grid-cols-3 gap-3">
          <QuickAction to="/app/shop" label="Buy voucher" icon={ShoppingBag} />
          <QuickAction to="/app/transfer" label="Send credits" icon={Send} />
          <QuickAction to="/app/rewards" label="Rewards" icon={Gift} />
        </div>
      </PageSection>

      {pending.length ? (
        <PageSection title="Pending redemption" description="Show this code to a reseller or the admin.">
          {pending.map((r) => (
            <Card key={r.id} className="shadow-[var(--shadow-card)]">
              <CardContent className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-medium">{r.rewardName}</p>
                  <p className="font-mono text-xs text-muted-foreground">{r.code}</p>
                </div>
                <StatusBadge tone="warning">{r.pointsHeld} pts on hold</StatusBadge>
              </CardContent>
            </Card>
          ))}
        </PageSection>
      ) : null}

      <PageSection
        title="Recent transactions"
        action={
          <Button asChild variant="ghost" size="sm">
            <Link to="/app/history">See all</Link>
          </Button>
        }
      >
        <Card className="shadow-[var(--shadow-card)]">
          <CardContent className="divide-y divide-border px-0 py-0">
            {entries.slice(0, 6).map((t) => (
              <div key={t.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {t.productName ?? t.kind.replaceAll("_", " ")}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {t.counterpartyName ? `${t.counterpartyName} · ` : ""}
                    {shortDateTime(t.createdAt)}
                  </p>
                </div>
                <p className={t.amount < 0 ? "text-sm font-medium text-destructive" : "text-sm font-medium text-success"}>
                  {t.amount < 0 ? "−" : "+"}
                  {t.method === "points" ? `${Math.abs(t.amount)} pts` : peso(t.amount)}
                </p>
              </div>
            ))}
          </CardContent>
        </Card>
      </PageSection>

      <Card className="shadow-[var(--shadow-card)]">
        <CardContent className="space-y-3">
          <div className="flex items-start gap-2">
            <Facebook className="mt-0.5 size-4 text-primary" />
            <div>
              <p className="text-sm font-medium">{ecosystem.facebookPageName}</p>
              <p className="text-xs text-muted-foreground">{ecosystem.facebookSupportMessage}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              {reseller ? `Your reseller: ${reseller.name}` : "You buy directly from the admin"}
            </p>
            <Button asChild variant="outline" size="sm">
              <a href={ecosystem.facebookPageUrl} target="_blank" rel="noreferrer">
                Get help
              </a>
            </Button>
          </div>
        </CardContent>
      </Card>
    </>
  );
}

function QuickAction({
  to,
  label,
  icon: Icon,
}: {
  to: "/app/shop" | "/app/transfer" | "/app/rewards";
  label: string;
  icon: typeof Gift;
}) {
  return (
    <Link
      to={to}
      className="flex flex-col items-center gap-2 rounded-xl border border-border bg-card px-2 py-4 text-center transition-colors hover:border-primary/40 hover:bg-accent"
    >
      <span className="flex size-9 items-center justify-center rounded-lg bg-brand-soft text-accent-foreground">
        <Icon className="size-4.5" />
      </span>
      <span className="text-xs font-medium">{label}</span>
    </Link>
  );
}
