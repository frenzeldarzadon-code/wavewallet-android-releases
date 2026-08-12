import { createFileRoute } from "@tanstack/react-router";
import { Ticket } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
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
import { EmptyState, PageSection, StatusBadge } from "@/components/ui-kit";
import { useSession } from "@/lib/session";
import { peso } from "@/lib/wavewallet";
import {
  fetchCreditBalance,
  fetchShopProducts,
  listPrice,
  purchaseVoucher,
  type ShopProduct,
} from "@/lib/wallet";
import { toast } from "sonner";

export const Route = createFileRoute("/app/shop")({
  head: () => ({
    meta: [
      { title: "Voucher Shop — WaveWallet" },
      {
        name: "description",
        content:
          "Buy WiFi vouchers with your shop credits. One unused code is issued per purchase and marked sold instantly.",
      },
      { property: "og:title", content: "Voucher Shop — WaveWallet" },
      {
        property: "og:description",
        content: "Buy WiFi vouchers with credits — codes are issued atomically and never reused.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CustomerShop,
});

export function VoucherShopView({
  role,
  discountPercent = 0,
}: {
  role: "customer" | "reseller";
  discountPercent?: number;
}) {
  const { account } = useSession(role);
  const [products, setProducts] = useState<ShopProduct[]>([]);
  const [balance, setBalance] = useState(0);
  const [loading, setLoading] = useState(true);
  const [buying, setBuying] = useState<ShopProduct | null>(null);
  const [busy, setBusy] = useState(false);
  const [issued, setIssued] = useState<{ code: string; tx: string; name: string; price: number } | null>(
    null,
  );
  const userId = account?.id ?? null;

  const load = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const [p, b] = await Promise.all([fetchShopProducts(), fetchCreditBalance(userId)]);
      setProducts(p);
      setBalance(b);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!account) return null;

  const priceFor = (p: ShopProduct) =>
    Math.round(listPrice(p) * (100 - discountPercent)) / 100;

  const confirm = async () => {
    if (!buying) return;
    setBusy(true);
    try {
      const res = await purchaseVoucher(buying.id);
      setIssued({ code: res.code, tx: res.tx_id, name: res.product_name, price: res.sale_price });
      setBuying(null);
      await load();
    } catch (e) {
      toast.error("Purchase failed", { description: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageSection
        title="Voucher shop"
        description={`Balance: ${peso(balance)}${discountPercent > 0 ? ` · ${discountPercent}% reseller discount applied` : ""}`}
      >
        {loading ? (
          <EmptyState title="Loading products…" />
        ) : products.length === 0 ? (
          <EmptyState
            title="No vouchers on sale"
            description="Your shop admin has not published any active voucher products yet."
          />
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {products.map((p) => {
              const price = priceFor(p);
              const soldOut = p.available === 0;
              const affordable = balance >= price;
              return (
                <Card key={p.id} className="shadow-[var(--shadow-card)]">
                  <CardContent className="space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-medium">{p.name}</p>
                        <p className="text-xs text-muted-foreground">{p.description}</p>
                      </div>
                      <StatusBadge tone={soldOut ? "danger" : p.available <= 10 ? "warning" : "success"}>
                        {soldOut ? "Sold out" : `${p.available} left`}
                      </StatusBadge>
                    </div>
                    <div className="flex items-end gap-2">
                      <p className="text-xl font-semibold tracking-tight">{peso(price)}</p>
                      {p.promo_price !== null || discountPercent > 0 ? (
                        <p className="pb-1 text-xs text-muted-foreground line-through">
                          {peso(Number(p.credit_price))}
                        </p>
                      ) : null}
                    </div>
                    <Button
                      className="w-full"
                      disabled={soldOut || !affordable}
                      onClick={() => setBuying(p)}
                    >
                      <Ticket className="size-4" />
                      {soldOut ? "Out of stock" : affordable ? "Buy with credits" : "Not enough credits"}
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </PageSection>

      <Dialog open={!!buying} onOpenChange={(o) => !o && setBuying(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Confirm purchase</DialogTitle>
            <DialogDescription>
              One unused code will be assigned to you and marked sold immediately.
            </DialogDescription>
          </DialogHeader>
          {buying ? (
            <div className="space-y-1 rounded-xl border border-border px-3 py-3 text-sm">
              <p className="flex justify-between">
                <span className="text-muted-foreground">Voucher</span>
                <span className="font-medium">{buying.name}</span>
              </p>
              <p className="flex justify-between">
                <span className="text-muted-foreground">Price</span>
                <span className="font-semibold text-destructive">−{peso(priceFor(buying))}</span>
              </p>
              <p className="flex justify-between">
                <span className="text-muted-foreground">Balance after</span>
                <span className="font-medium">{peso(balance - priceFor(buying))}</span>
              </p>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setBuying(null)}>
              Cancel
            </Button>
            <Button onClick={() => void confirm()} disabled={busy}>
              {busy ? "Issuing…" : "Confirm purchase"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!issued} onOpenChange={(o) => !o && setIssued(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Voucher issued</DialogTitle>
            <DialogDescription>
              {issued?.name} · {peso(issued?.price ?? 0)} · {issued?.tx}
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-xl border border-success/40 bg-success-soft px-4 py-5 text-center">
            <p className="text-[11px] font-medium uppercase tracking-wide text-success">Your code</p>
            <p className="mt-1 font-mono text-xl font-semibold tracking-widest text-success">
              {issued?.code}
            </p>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                if (issued) void navigator.clipboard?.writeText(issued.code);
                toast.success("Code copied");
              }}
            >
              Copy code
            </Button>
            <Button onClick={() => setIssued(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function CustomerShop() {
  return <VoucherShopView role="customer" />;
}
