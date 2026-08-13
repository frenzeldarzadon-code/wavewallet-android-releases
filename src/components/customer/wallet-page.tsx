/**
 * Member wallet — balances only.
 *
 * Deliberately free of transaction lists: every movement lives on the
 * Transaction history screen. Resellers and subresellers see two extra
 * read-only totals derived from the same earnings records as the earnings
 * history page (no new financial logic).
 */
import { Link } from "@tanstack/react-router";
import { Coins, Gift, History, Send, ShoppingBag, Sparkles, Wallet } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { PageSection, StatCard } from "@/components/ui-kit";
import { FacebookSupportCard } from "@/components/facebook-support-card";
import { useSession } from "@/lib/session";
import { peso } from "@/lib/wavewallet";
import { fetchCreditBalance } from "@/lib/wallet";
import { fetchPointsAccount, type PointsAccount } from "@/lib/rewards";
import { fetchEarnings, summariseEarnings } from "@/lib/earnings";

export interface WalletPageProps {
  /** Route prefix for the quick actions ("/app" or "/reseller"). */
  base: "/app" | "/reseller";
  /** Show wholesale discount + cashback totals (reseller / subreseller). */
  showSellerTotals?: boolean;
}

export function WalletPage({ base, showSellerTotals = false }: WalletPageProps) {
  const { account, ecosystem } = useSession();
  const [balance, setBalance] = useState(0);
  const [points, setPoints] = useState<PointsAccount>({ balance: 0, held: 0, available: 0 });
  const [discountSaved, setDiscountSaved] = useState(0);
  const [cashback, setCashback] = useState(0);
  const userId = account?.id ?? null;

  const load = useCallback(async () => {
    if (!userId) return;
    const [b, p] = await Promise.all([fetchCreditBalance(userId), fetchPointsAccount(userId)]);
    setBalance(b);
    setPoints(p);
    if (!showSellerTotals) return;
    try {
      const from = new Date();
      from.setFullYear(from.getFullYear() - 1);
      const rows = await fetchEarnings({ recipientId: userId, from, to: new Date() });
      const totals = summariseEarnings(rows);
      setDiscountSaved(totals.discountSaved);
      setCashback(totals.byType.sale_cashback ?? 0);
    } catch {
      setDiscountSaved(0);
      setCashback(0);
    }
  }, [userId, showSellerTotals]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!account || !ecosystem) return null;

  return (
    <>
      <PageSection
        title="My wallet"
        description={`Closed-loop balances inside ${ecosystem.name}.`}
      >
        <div className={showSellerTotals ? "grid gap-3 sm:grid-cols-2 xl:grid-cols-4" : "grid gap-3 sm:grid-cols-2"}>
          <StatCard
            label="Credit balance"
            value={peso(balance)}
            hint="Validated against your ledger"
            icon={Wallet}
            tone="positive"
          />
          <StatCard
            label="Points balance"
            value={`${points.available} pts`}
            hint={
              points.held > 0
                ? `${points.held} pts held for redemptions`
                : "Earned from voucher purchases"
            }
            icon={Sparkles}
            tone="brand"
          />
          {showSellerTotals ? (
            <>
              <StatCard
                label="Total discounts saved"
                value={peso(discountSaved)}
                hint="Wholesale margin, last 12 months"
                icon={Coins}
              />
              <StatCard
                label="Cashback rewards total"
                value={peso(cashback)}
                hint="Sales cashback, last 12 months"
                icon={Coins}
                tone="positive"
              />
            </>
          ) : null}
        </div>
      </PageSection>

      <PageSection title="Quick actions">
        <div className="grid gap-2 sm:grid-cols-4">
          <Button asChild className="h-11">
            <Link to={base === "/app" ? "/app/shop" : "/reseller/shop"}>
              <ShoppingBag className="size-4" /> Buy a voucher
            </Link>
          </Button>
          <Button asChild variant="outline" className="h-11">
            <Link to={base === "/app" ? "/app/rewards" : "/reseller/rewards"}>
              <Gift className="size-4" /> Rewards
            </Link>
          </Button>
          <Button asChild variant="outline" className="h-11">
            <Link to={base === "/app" ? "/app/transfer" : "/reseller/transfer"}>
              <Send className="size-4" /> Send credits
            </Link>
          </Button>
          <Button asChild variant="outline" className="h-11">
            <Link to={base === "/app" ? "/app/history" : "/reseller/history"}>
              <History className="size-4" /> Transaction history
            </Link>
          </Button>
        </div>
      </PageSection>

      <PageSection title="Contact us / Support">
        <FacebookSupportCard
          url={ecosystem.facebookPageUrl}
          pageName={ecosystem.facebookPageName}
          title={`${ecosystem.name} support`}
          message="Message your shop's Facebook page for help with credits, vouchers and rewards."
          emptyHint="Your shop has not added a Facebook support page yet. Contact them directly for now."
        />
      </PageSection>
    </>
  );
}

