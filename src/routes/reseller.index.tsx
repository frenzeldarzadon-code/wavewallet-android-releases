import { createFileRoute } from "@tanstack/react-router";
import { ArrowUpRight, Wallet } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState, PageSection, StatCard } from "@/components/ui-kit";
import { SellerEarningsPanel } from "@/components/seller-earnings-panel";
import { FacebookSupportCard } from "@/components/facebook-support-card";
import { useSession } from "@/lib/session";
import { peso, shortDateTime } from "@/lib/wavewallet";
import {
  commissionBreakdown,
  fetchCreditBalance,
  fetchCreditLedger,
  fetchMyVoucherDiscount,
  type CreditEntry,
} from "@/lib/wallet";

export const Route = createFileRoute("/reseller/")({
  head: () => ({
    meta: [
      { title: "Reseller Wallet — WaveWallet" },
      {
        name: "description",
        content:
          "Reseller coin wallet: live balance, coins loaded to customers and discounted voucher purchases.",
      },
      { property: "og:title", content: "Reseller Wallet — WaveWallet" },
      {
        property: "og:description",
        content: "Track your reseller coin balance and every load you make to customers.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ResellerDashboard,
});

function ResellerDashboard() {
  const { account, ecosystem, ecosystemDbId } = useSession("reseller");
  const [balance, setBalance] = useState(0);
  const [entries, setEntries] = useState<CreditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  // The one Discount configured for this member in THIS shop — also the
  // percentage applied at voucher checkout. There is no second setting.
  const [discount, setDiscount] = useState(account?.discountPercent ?? 0);
  const userId = account?.id ?? null;

  const load = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    const [b, l] = await Promise.all([
      fetchCreditBalance(userId, ecosystemDbId),
      fetchCreditLedger(userId, ecosystemDbId, 50),
    ]);
    setBalance(b);
    setEntries(l);
    setLoading(false);
  }, [userId, ecosystemDbId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!userId) return;
    void fetchMyVoucherDiscount(userId, ecosystemDbId).then(setDiscount);
  }, [userId, ecosystemDbId]);

  if (!account || !ecosystem) return null;

  const loadsOut = entries.filter((e) => e.reason === "Coin load to customer");

  return (
    <>
      <PageSection
        title="Reseller wallet"
        description={`Closed-loop coins inside ${ecosystem.name}.`}
      >
        <div className="grid grid-cols-2 gap-3">
          <StatCard label="Coin balance" value={peso(balance)} icon={Wallet} tone="positive" />
          <StatCard
            label="Loaded to customers"
            value={peso(loadsOut.reduce((s, e) => s + e.amount, 0))}
            hint={`${loadsOut.length} loads`}
            icon={ArrowUpRight}
            tone="brand"
          />
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          Your Discount ({discount}%) is applied automatically at
          voucher checkout. Credit transfers move exact amounts — no commission is added or
          deducted.
        </p>
      </PageSection>

      <SellerEarningsPanel recipientId={account.id} ecosystemId={ecosystemDbId} showBalance={false} />

      <PageSection title="Wallet activity">
        {loading ? (
          <EmptyState title="Loading wallet…" />
        ) : entries.length === 0 ? (
          <EmptyState
            title="No coin movements yet"
            description="Ask your shop admin to load coins into your reseller wallet."
          />
        ) : (
          <Card className="shadow-[var(--shadow-card)]">
            <CardContent className="divide-y divide-border px-0 py-0">
              {entries.map((e) => (
                <div key={e.id} className="flex items-start justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{e.reason}</p>
                    {commissionBreakdown(e) ? (
                      <p className="text-[11px] font-medium text-success">
                        {commissionBreakdown(e)}
                      </p>
                    ) : null}
                    <p className="text-[11px] text-muted-foreground">
                      {shortDateTime(e.created_at)} · {e.tx_id ?? "—"}
                      {e.reference ? ` · ${e.reference}` : ""}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p
                      className={
                        e.direction === "coin"
                          ? "text-sm font-semibold text-success"
                          : "text-sm font-semibold text-destructive"
                      }
                    >
                      {e.direction === "coin" ? "+" : "−"}
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
        description={`Questions about coins, vouchers or payouts go to ${ecosystem.name}.`}
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
