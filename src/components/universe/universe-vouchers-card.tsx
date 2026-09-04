/**
 * Universe wallet + voucher purchases of the signed-in member.
 *
 * A Universe buyer needs no shop membership, so this is the one place a
 * member with zero shops can see their portable Universe balance and get back
 * the codes of every voucher they bought. Reads are RLS-scoped to the caller.
 */
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui-kit";
import { PurchaseShopChip, usePurchaseShopLabels } from "@/components/universe/purchase-shop-chip";
import { peso } from "@/lib/wavewallet";
import { fetchCreditBalance, fetchMyPurchases } from "@/lib/wallet";
import { useSession } from "@/lib/session";

type Purchase = Awaited<ReturnType<typeof fetchMyPurchases>>[number];

export function UniverseVouchersCard() {
  const session = useSession();
  const userId = session.account?.id ?? null;
  const [balance, setBalance] = useState<number | null>(null);
  const [rows, setRows] = useState<Purchase[]>([]);
  const [loading, setLoading] = useState(true);
  const shopLabels = usePurchaseShopLabels(Boolean(userId));

  useEffect(() => {
    if (!userId) return;
    let alive = true;
    Promise.all([fetchCreditBalance(userId, null), fetchMyPurchases(userId, null)])
      .then(([b, p]) => {
        if (!alive) return;
        setBalance(b);
        setRows(p.slice(0, 20));
      })
      .catch((e: Error) => toast.error("Could not load your vouchers", { description: e.message }))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [userId]);

  if (!userId) return null;

  return (
    <Card className="shadow-[var(--shadow-card)]">
      <CardHeader>
        <CardTitle className="text-base">Universe wallet &amp; vouchers</CardTitle>
        <CardDescription>
          Your portable coin balance and the voucher codes you bought from Universe sellers.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm">
          Universe wallet:{" "}
          <span className="font-semibold text-foreground">{balance === null ? "…" : peso(balance)}</span>
        </p>
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading purchases…</p>
        ) : rows.length === 0 ? (
          <EmptyState title="No voucher purchases yet" />
        ) : (
          <ul className="divide-y">
            {rows.map((s) => (
              <li key={s.id} className="space-y-1 py-2">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="truncate text-sm font-medium">{s.product_name}</p>
                  <p className="text-xs text-muted-foreground">
                    {peso(s.sale_price)} · {new Date(s.created_at).toLocaleDateString()}
                  </p>
                </div>
                <PurchaseShopChip labels={shopLabels} ecosystemId={s.ecosystem_id} sellerId={s.reseller_id} />
                {s.codes.length > 0 ? (
                  <div className="flex flex-wrap items-center gap-1">
                    {s.codes.map((c) => (
                      <code key={c} className="select-all rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                        {c}
                      </code>
                    ))}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 px-2 text-xs"
                      onClick={() => {
                        void navigator.clipboard?.writeText(s.codes.join("\n"));
                        toast.success("Codes copied");
                      }}
                    >
                      Copy
                    </Button>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">Codes already used or no longer available.</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
