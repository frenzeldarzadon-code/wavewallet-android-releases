import { createFileRoute } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PageSection, StatusBadge } from "@/components/ui-kit";
import { useSession } from "@/lib/session";
import { effectivePrice, peso, voucherProductsIn } from "@/lib/wavewallet";
import { toast } from "sonner";

export const Route = createFileRoute("/reseller/shop")({
  head: () => ({
    meta: [
      { title: "Buy Vouchers — WaveWallet Reseller" },
      { name: "description", content: "Purchase voucher stock at your discounted reseller cost using your credit wallet." },
      { property: "og:title", content: "Buy Vouchers — WaveWallet Reseller" },
      { property: "og:description", content: "Purchase voucher stock at your discounted reseller cost using your credit wallet." },
    ],
  }),
  component: ResellerShop,
});

function ResellerShop() {
  const { account, ecosystem } = useSession("reseller");
  if (!account || !ecosystem) return null;
  const discount = account.discountPercent ?? 0;
  const products = voucherProductsIn(ecosystem.id).filter((p) => p.active);

  return (
    <PageSection
      title="Voucher shop"
      description={`Your reseller discount is ${discount}%. Cost and earnings are recorded at the time of sale.`}
    >
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {products.map((p) => {
          const retail = effectivePrice(p);
          const cost = retail * (1 - discount / 100);
          const soldOut = p.stockUnused === 0;
          return (
            <Card key={p.id} className="shadow-[var(--shadow-card)]">
              <CardContent className="space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium">{p.name}</p>
                    <p className="text-xs text-muted-foreground">{p.description}</p>
                  </div>
                  <StatusBadge tone={soldOut ? "danger" : p.stockUnused <= 10 ? "warning" : "success"}>
                    {soldOut ? "Sold out" : `${p.stockUnused} left`}
                  </StatusBadge>
                </div>
                <div className="flex items-end justify-between rounded-lg bg-muted px-3 py-2">
                  <div>
                    <p className="text-[11px] text-muted-foreground">Your cost</p>
                    <p className="text-lg font-semibold text-success">{peso(cost)}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-[11px] text-muted-foreground">Customer price</p>
                    <p className="text-sm font-medium">{peso(retail)}</p>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <StatusBadge tone="brand">Earn {peso(retail - cost)} per sale</StatusBadge>
                  <Button
                    size="sm"
                    disabled={soldOut}
                    onClick={() => toast.success(`Reserved 1× ${p.name} (demo)`)}
                  >
                    Buy
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </PageSection>
  );
}
