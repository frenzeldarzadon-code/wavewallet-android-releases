import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PageSection, StatusBadge } from "@/components/ui-kit";
import { useSession } from "@/lib/session";
import { effectivePrice, peso, voucherProductsIn, type VoucherProduct } from "@/lib/wavewallet";
import { toast } from "sonner";

export const Route = createFileRoute("/app/shop")({
  head: () => ({
    meta: [
      { title: "Voucher Shop — WaveWallet" },
      { name: "description", content: "Buy WiFi vouchers with credits or points. Codes are issued instantly and never reused." },
      { property: "og:title", content: "Voucher Shop — WaveWallet" },
      { property: "og:description", content: "Buy WiFi vouchers with credits or points. Codes are issued instantly and never reused." },
    ],
  }),
  component: CustomerShop,
});

function CustomerShop() {
  const { account, ecosystem } = useSession("customer");
  const [buying, setBuying] = useState<{ product: VoucherProduct; method: "credits" | "points" } | null>(null);
  if (!account || !ecosystem) return null;

  const products = voucherProductsIn(ecosystem.id).filter((p) => p.active);

  const confirm = () => {
    if (!buying) return;
    toast.success("Voucher issued", {
      description: `${buying.product.name} · code assigned and marked sold. Check History for the code.`,
    });
    setBuying(null);
  };

  return (
    <>
      <PageSection
        title="Voucher shop"
        description={`Balance: ${peso(account.creditBalance)} credits · ${account.pointsBalance} points`}
      >
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {products.map((p) => {
            const price = effectivePrice(p);
            const soldOut = p.stockUnused === 0;
            const canCredits = !soldOut && account.creditBalance >= price;
            const canPoints = !soldOut && !!p.pointsPrice && account.pointsBalance >= p.pointsPrice;
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
                  <div className="flex items-end gap-2">
                    <p className="text-2xl font-semibold tracking-tight text-success">{peso(price)}</p>
                    {p.promoPrice ? (
                      <>
                        <p className="pb-1 text-sm text-muted-foreground line-through">{peso(p.creditPrice)}</p>
                        <StatusBadge tone="warning" className="mb-1">
                          {p.promoLabel ?? "Promo"}
                        </StatusBadge>
                      </>
                    ) : null}
                  </div>
                  <div className="flex gap-2">
                    <Button
                      className="flex-1"
                      disabled={!canCredits}
                      onClick={() => setBuying({ product: p, method: "credits" })}
                    >
                      {soldOut ? "Unavailable" : canCredits ? "Buy with credits" : "Not enough credits"}
                    </Button>
                    {p.pointsPrice ? (
                      <Button
                        variant="outline"
                        disabled={!canPoints}
                        onClick={() => setBuying({ product: p, method: "points" })}
                      >
                        {p.pointsPrice} pts
                      </Button>
                    ) : null}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </PageSection>

      <Dialog open={!!buying} onOpenChange={(o) => !o && setBuying(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Confirm purchase</DialogTitle>
            <DialogDescription>
              One unused code is reserved and marked sold the moment you confirm.
            </DialogDescription>
          </DialogHeader>
          {buying ? (
            <div className="space-y-2 text-sm">
              <Line label="Product" value={buying.product.name} />
              <Line
                label="Pay with"
                value={buying.method === "credits" ? "Credit wallet" : "Points"}
              />
              <Line
                label="Amount"
                value={
                  buying.method === "credits"
                    ? peso(effectivePrice(buying.product))
                    : `${buying.product.pointsPrice} points`
                }
                highlight
              />
              {buying.method === "credits" ? (
                <Line
                  label="Points earned"
                  value={`+${Math.floor(effectivePrice(buying.product) / ecosystem.pointsPerPeso)} pts`}
                />
              ) : (
                <p className="text-xs text-muted-foreground">Points purchases do not earn points.</p>
              )}
            </div>
          ) : null}
          <DialogFooter>
            <Button onClick={confirm}>Confirm and get code</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Line({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex items-center justify-between border-b border-border pb-2 last:border-0">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={highlight ? "font-semibold text-success" : "font-medium"}>{value}</span>
    </div>
  );
}
