import { createFileRoute } from "@tanstack/react-router";
import { ArrowDownLeft, ArrowUpRight, Wallet } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState, PageSection, StatCard } from "@/components/ui-kit";
import { EarningsSummaryCards } from "@/components/earnings-summary-cards";
import { FacebookSupportCard } from "@/components/facebook-support-card";
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
  // Upline commission: paid to a reseller when their subreseller's credits fund
  // a sale, or when the subreseller buys for themselves.
  const uplineCommission = entries
    .filter((e) => e.direction === "credit" && e.entry_kind === "upline_commission")
    .reduce((s, e) => s + Number(e.amount ?? 0), 0);
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
            label="Sales cashback"
            value={peso(saleCreditBack)}
            hint="Earned when customers spend the credits you funded"
            tone="positive"
          />
          <StatCard
            label="Upline commission"
            value={peso(uplineCommission)}
            hint={
              isSubreseller
                ? "Resellers only — this goes to your parent reseller"
                : "Earned on your subresellers' sales and purchases"
            }
            tone={isSubreseller ? "neutral" : "positive"}
          />
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          Your wholesale discount ({account.discountPercent ?? 0}%) is applied automatically at voucher
          checkout. Credit transfers move exact amounts — no commission is added or deducted.
        </p>
      </PageSection>

      <EarningsSummaryCards
        title="Total benefit (separate from your wallet balance)"
        description="Cash earnings plus wholesale discounts saved, ledger-backed for the current periods. Credit transfers are face value and never counted."
        types={["sale_cashback", "upline_commission", "wholesale_discount"]}
        recipientId={account.id}
        linkTo="/reseller/earnings"
      />

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

      <PageSection
        title="Support"
        description={`Questions about credits, vouchers or payouts go to ${ecosystem.name}.`}
      >
        <FacebookSupportCard
          url={ecosystem.facebookPageUrl}
          pageName={ecosystem.facebookPageName}
          title={`${ecosystem.name} support`}
          message="Message your shop admin's Facebook page for help with loads, vouchers and earnings."
          emptyHint="Your shop admin has not added a Facebook support page yet. Contact them directly for now."
        />
      </PageSection>
    </>
  );
}
