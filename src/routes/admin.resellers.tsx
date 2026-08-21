import { createFileRoute, Link } from "@tanstack/react-router";
import { Percent, Users, Wallet } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState, PageSection, StatCard, StatusBadge } from "@/components/ui-kit";
import { CashbackRateDialog, type CashbackTarget } from "@/components/cashback-rate-dialog";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/lib/session";
import { fetchMyVoucherDiscount } from "@/lib/wallet";
import { peso, roleLabel, shortDate, type Role } from "@/lib/wavewallet";

export const Route = createFileRoute("/admin/resellers")({
  head: () => ({
    meta: [
      { title: "Resellers — WaveWallet Admin" },
      {
        name: "description",
        content:
          "Reseller and subreseller network inside your shop: wallets, wholesale discounts, sale cashback and sales.",
      },
      { property: "og:title", content: "Resellers — WaveWallet Admin" },
      {
        property: "og:description",
        content:
          "Reseller and subreseller network inside your shop: wallets, wholesale discounts, sale cashback and sales.",
      },
    ],
  }),
  component: AdminResellers,
});

interface ResellerRow {
  id: string;
  full_name: string;
  email: string;
  joined_at: string;
  status: "active" | "suspended";
  discount: number;
  role: Extract<Role, "reseller" | "subreseller">;
  cashback: number;
  credits: number;
  sales: number;
  revenue: number;
}

function AdminResellers() {
  const { ecosystem, ecosystemDbId } = useSession("admin");
  const [rows, setRows] = useState<ResellerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [rateTarget, setRateTarget] = useState<CashbackTarget | null>(null);

  const load = useCallback(async () => {
    if (!ecosystemDbId) return;
    setLoading(true);
    // Membership — not the single profiles.ecosystem_id mirror — decides who
    // belongs to this shop, so a reseller of two shops appears in both.
    const [members, { data: credits }, { data: sales }] = await Promise.all([
      fetchShopMembers(ecosystemDbId),
      supabase.from("credit_accounts").select("user_id, balance").eq("ecosystem_id", ecosystemDbId),
      supabase
        .from("voucher_sales")
        .select("reseller_id, sale_price")
        .eq("ecosystem_id", ecosystemDbId),
    ]);

    const creditOf = new Map((credits ?? []).map((c) => [c.user_id, Number(c.balance)]));
    const saleCount = new Map<string, number>();
    const saleValue = new Map<string, number>();
    for (const s of sales ?? []) {
      if (!s.reseller_id) continue;
      saleCount.set(s.reseller_id, (saleCount.get(s.reseller_id) ?? 0) + 1);
      saleValue.set(s.reseller_id, (saleValue.get(s.reseller_id) ?? 0) + Number(s.sale_price));
    }

    // The single Discount lives on the shop membership: it is both the
    // member's share and their voucher shop discount in THIS shop.
    const base = resellersOf(members).map((m) => ({
      id: m.id,
      full_name: m.full_name,
      email: m.email,
      joined_at: m.joined_at,
      status: m.status,
      discount: m.sale_commission_percent ?? 0,
      cashback: m.sale_commission_percent ?? 0,
      role: m.role as ResellerRow["role"],
      credits: creditOf.get(m.id) ?? 0,
      sales: saleCount.get(m.id) ?? 0,
      revenue: saleValue.get(m.id) ?? 0,
    }));


    // The displayed percentage must be the one the purchase engine would use,
    // including the shop-default fallback — never a locally computed value.
    const resolved = await Promise.all(
      base.map(async (r) => {
        const pct = await fetchMyVoucherDiscount(r.id, ecosystemDbId);
        return { ...r, discount: pct, cashback: pct };
      }),
    );

    setRows(resolved.sort((a, b) => b.credits - a.credits));
    setLoading(false);
  }, [ecosystemDbId]);


  useEffect(() => {
    void load();
  }, [load]);

  if (!ecosystem) return null;

  const float = rows.reduce((s, r) => s + r.credits, 0);
  const avgCashback = rows.length
    ? (rows.reduce((s, r) => s + r.cashback, 0) / rows.length).toFixed(1)
    : "0.0";
  const totalSales = rows.reduce((s, r) => s + r.sales, 0);

  return (
    <>
      <PageSection>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Resellers" value={String(rows.length)} tone="brand" />
          <StatCard label="Total float" value={peso(float)} tone="positive" />
          <StatCard label="Avg discount" value={`${avgCashback}%`} />
          <StatCard label="Reseller sales" value={String(totalSales)} />
        </div>
      </PageSection>

      <PageSection
        title="Reseller network"
        description="Every reseller and subreseller has ONE Discount: their share of qualifying purchases and, automatically, their voucher shop discount. The shop admin always receives the remainder, and changes apply to future transactions only."
        action={
          <Button size="sm" asChild>
            <Link to="/admin/customers">
              <Users className="size-4" /> Manage members
            </Link>
          </Button>
        }
      >
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading resellers…</p>
        ) : rows.length === 0 ? (
          <EmptyState
            title="No resellers yet"
            description="Promote an existing customer to reseller or subreseller from the members directory."
          />
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {rows.map((r) => (
              <Card key={r.id} className="min-w-0 shadow-[var(--shadow-card)]">
                <CardContent className="space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{r.full_name || r.email}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {r.email} · joined {shortDate(r.joined_at)}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1 text-right">
                      <StatusBadge tone={r.status === "active" ? "success" : "danger"}>
                        {r.status}
                      </StatusBadge>
                      <StatusBadge tone="brand">{roleLabel(r.role)}</StatusBadge>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2 rounded-lg bg-muted px-3 py-2 text-center">
                    <div>
                      <p className="text-[11px] text-muted-foreground">Wallet</p>
                      <p className="text-sm font-semibold text-success">{peso(r.credits)}</p>
                    </div>
                    <div>
                      <p className="text-[11px] text-muted-foreground">Discount &amp; voucher price</p>
                      <p className="text-sm font-semibold text-primary">{r.cashback}%</p>
                    </div>
                    <div>
                      <p className="text-[11px] text-muted-foreground">Sales</p>
                      <p className="text-sm font-semibold">{peso(r.revenue)}</p>
                    </div>
                  </div>

                  <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
                    <Percent className="size-3" /> Earnings come from voucher sales, not transfers.
                  </p>
                  <div className="flex gap-2">
                    <Button size="sm" className="flex-1" asChild>
                      <Link to="/admin/wallets">
                        <Wallet className="size-4" /> Add coin
                      </Link>
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-1"
                      onClick={() =>
                        setRateTarget({
                          id: r.id,
                          name: r.full_name || r.email,
                          role: r.role,
                          ecosystemId: ecosystemDbId!,
                          shopName: ecosystem.name,
                          percent: r.cashback,
                        })
                      }
                    >
                      <Percent className="size-4" /> Set discount
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </PageSection>

      <CashbackRateDialog
        target={rateTarget}
        onClose={() => setRateTarget(null)}
        onSaved={() => void load()}
      />
    </>
  );
}
