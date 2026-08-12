import { createFileRoute } from "@tanstack/react-router";
import { ArrowDownLeft, ArrowUpRight, Wallet } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState, PageSection, StatCard } from "@/components/ui-kit";
import { useSession } from "@/lib/session";
import { peso, shortDateTime } from "@/lib/wavewallet";
import {
  commissionBreakdown,
  fetchCreditBalance,
  fetchCreditLedger,
  type CreditEntry,
} from "@/lib/wallet";

export const Route = createFileRoute("/reseller/")({
  head: () => ({
    meta: [
      { title: "Reseller Wallet — WaveWallet" },
      {
        name: "description",
        content:
          "Reseller credit wallet: live balance, credits loaded to customers and discounted voucher purchases.",
      },
      { property: "og:title", content: "Reseller Wallet — WaveWallet" },
      {
        property: "og:description",
        content: "Track your reseller credit balance and every load you make to customers.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ResellerDashboard,
});

function ResellerDashboard() {
  const { account, ecosystem } = useSession("reseller");
  const [balance, setBalance] = useState(0);
  const [entries, setEntries] = useState<CreditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const userId = account?.id ?? null;

  const load = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    const [b, l] = await Promise.all([fetchCreditBalance(userId), fetchCreditLedger(userId, 50)]);
    setBalance(b);
    setEntries(l);
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!account || !ecosystem) return null;

  const isSubreseller = account.role === "subreseller";
  const loadsOut = entries.filter((e) => e.reason === "Credit load to customer");
  const topUps = entries.filter((e) => e.direction === "credit");
  const loadingCommission = entries
    .filter((e) => e.direction === "credit" && e.entry_kind !== "sale_commission")
    .reduce((s, e) => s + Number(e.commission_amount ?? 0), 0);
  const saleCreditBack = entries
    .filter((e) => e.direction === "credit" && e.entry_kind === "sale_commission")
    .reduce((s, e) => s + Number(e.amount ?? 0), 0);

  return (
    <>
      <PageSection title="Reseller wallet" description={`Closed-loop credits inside ${ecosystem.name}.`}>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Credit balance" value={peso(balance)} icon={Wallet} tone="positive" />
          <StatCard
            label="Loaded to customers"
            value={peso(loadsOut.reduce((s, e) => s + e.amount, 0))}
            hint={`${loadsOut.length} loads`}
            icon={ArrowUpRight}
            tone="brand"
          />
          <StatCard
            label="Credits received"
            value={peso(topUps.reduce((s, e) => s + e.amount, 0))}
            hint="Top-ups from your admin"
            icon={ArrowDownLeft}
          />
          <StatCard
            label="Sale credit-back"
            value={peso(saleCreditBack)}
            hint="Earned when customers spend the credits you funded"
            tone="positive"
          />
          <StatCard
            label="Credit-loading bonus"
            value={peso(loadingCommission)}
            hint={
              isSubreseller
                ? "Resellers only — subresellers earn sale credit-back instead"
                : "Extra credits granted on admin releases"
            }
            tone={isSubreseller ? "default" : "positive"}
          />
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          Your discount ({account.discountPercent ?? 0}%) is applied automatically at voucher checkout.
        </p>
      </PageSection>


      <PageSection title="Wallet activity">
        {loading ? (
          <EmptyState title="Loading wallet…" />
        ) : entries.length === 0 ? (
          <EmptyState
            title="No credit movements yet"
            description="Ask your shop admin to load credits into your reseller wallet."
          />
        ) : (
          <Card className="shadow-[var(--shadow-card)]">
            <CardContent className="divide-y divide-border px-0 py-0">
              {entries.map((e) => (
                <div key={e.id} className="flex items-start justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{e.reason}</p>
                    {commissionBreakdown(e) ? (
                      <p className="text-[11px] font-medium text-success">{commissionBreakdown(e)}</p>
                    ) : null}
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
                    <p className="text-[11px] text-muted-foreground">Bal {peso(e.balance_after)}</p>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </PageSection>
    </>
  );
}
