import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowDownLeft, ArrowUpRight, History, Send, ShoppingBag, Wallet } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState, PageSection, StatCard } from "@/components/ui-kit";
import { useSession } from "@/lib/session";
import { peso, shortDateTime } from "@/lib/wavewallet";
import { fetchCreditBalance, fetchCreditLedger, type CreditEntry } from "@/lib/wallet";

export const Route = createFileRoute("/app/")({
  head: () => ({
    meta: [
      { title: "My Wallet — WaveWallet" },
      {
        name: "description",
        content:
          "Your closed-loop credit wallet: live balance, credit loads, transfers and voucher purchases with transaction IDs.",
      },
      { property: "og:title", content: "My Wallet — WaveWallet" },
      {
        property: "og:description",
        content: "Live credit balance, loads, transfers and voucher purchases in one place.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CustomerWallet,
});

function CustomerWallet() {
  const { account, ecosystem } = useSession("customer");
  const [balance, setBalance] = useState(0);
  const [entries, setEntries] = useState<CreditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const userId = account?.id ?? null;

  const load = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    const [b, l] = await Promise.all([fetchCreditBalance(userId), fetchCreditLedger(userId, 25)]);
    setBalance(b);
    setEntries(l);
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!account || !ecosystem) return null;

  const loadsIn = entries.filter((e) => e.direction === "credit");

  return (
    <>
      <PageSection title="My wallet" description={`Closed-loop credits inside ${ecosystem.name}.`}>
        <div className="grid gap-3 sm:grid-cols-3">
          <StatCard
            label="Credit balance"
            value={peso(balance)}
            hint="Validated against your ledger"
            icon={Wallet}
            tone="positive"
          />
          <StatCard
            label="Credits received"
            value={peso(loadsIn.reduce((s, e) => s + e.amount, 0))}
            hint={`${loadsIn.length} incoming entries`}
            icon={ArrowDownLeft}
            tone="brand"
          />
          <StatCard
            label="Recent movements"
            value={String(entries.length)}
            hint="Latest 25 ledger rows"
            icon={History}
          />
        </div>
      </PageSection>

      <PageSection>
        <div className="grid gap-2 sm:grid-cols-3">
          <Button asChild>
            <Link to="/app/shop">
              <ShoppingBag className="size-4" /> Buy a voucher
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link to="/app/transfer">
              <Send className="size-4" /> Send credits
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link to="/app/history">
              <History className="size-4" /> Full history
            </Link>
          </Button>
        </div>
      </PageSection>

      <PageSection title="Recent credit activity" description="Every entry carries a transaction ID.">
        {loading ? (
          <EmptyState title="Loading your wallet…" />
        ) : entries.length === 0 ? (
          <EmptyState
            title="No credit movements yet"
            description="Ask your shop admin or reseller to load credits into your wallet."
          />
        ) : (
          <Card className="shadow-[var(--shadow-card)]">
            <CardContent className="divide-y divide-border px-0 py-0">
              {entries.map((e) => (
                <div key={e.id} className="flex items-start justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{e.reason}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {shortDateTime(e.created_at)} · {e.tx_id ?? "—"}
                      {e.reference ? ` · ${e.reference}` : ""}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p
                      className={
                        e.direction === "credit"
                          ? "text-sm font-semibold text-success"
                          : "text-sm font-semibold text-destructive"
                      }
                    >
                      {e.direction === "credit" ? "+" : "−"}
                      {peso(e.amount)}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      Bal {peso(e.balance_after)}
                    </p>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </PageSection>

      <p className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <ArrowUpRight className="size-3.5" />
        Credits are shop credits only — they cannot be cashed out or transferred to another shop.
      </p>
    </>
  );
}
