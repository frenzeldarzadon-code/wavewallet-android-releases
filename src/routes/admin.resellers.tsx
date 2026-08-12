import { createFileRoute, Link } from "@tanstack/react-router";
import { Percent, Users, Wallet } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState, PageSection, StatCard, StatusBadge } from "@/components/ui-kit";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/lib/session";
import { peso, roleLabel, shortDate, type Role } from "@/lib/wavewallet";

export const Route = createFileRoute("/admin/resellers")({
  head: () => ({
    meta: [
      { title: "Resellers — WaveWallet Admin" },
      {
        name: "description",
        content:
          "Reseller and subreseller network inside your ecosystem: wallets, wholesale discounts, sale cashback and sales.",
      },
      { property: "og:title", content: "Resellers — WaveWallet Admin" },
      {
        property: "og:description",
        content:
          "Reseller and subreseller network inside your ecosystem: wallets, wholesale discounts, sale cashback and sales.",
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
  credits: number;
  sales: number;
  revenue: number;
}

function AdminResellers() {
  const { ecosystem, ecosystemDbId } = useSession("admin");
  const [rows, setRows] = useState<ResellerRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!ecosystemDbId) return;
    setLoading(true);
    const [{ data: roles }, { data: profiles }, { data: credits }, { data: sales }] =
      await Promise.all([
        supabase
          .from("user_roles")
          .select("user_id, role")
          .eq("ecosystem_id", ecosystemDbId)
          .in("role", ["reseller", "subreseller"]),
        supabase
          .from("profiles")
          .select(
            "id, full_name, email, joined_at, status, reseller_discount_percent",
          )
          .eq("ecosystem_id", ecosystemDbId),
        supabase.from("credit_accounts").select("user_id, balance").eq("ecosystem_id", ecosystemDbId),
        supabase
          .from("voucher_sales")
          .select("reseller_id, sale_price")
          .eq("ecosystem_id", ecosystemDbId),
      ]);

    const roleOf = new Map<string, ResellerRow["role"]>();
    for (const r of roles ?? []) {
      const rank = (x: string) => (x === "reseller" ? 0 : 1);
      const cur = roleOf.get(r.user_id);
      if (!cur || rank(r.role) < rank(cur)) roleOf.set(r.user_id, r.role as ResellerRow["role"]);
    }
    const creditOf = new Map((credits ?? []).map((c) => [c.user_id, Number(c.balance)]));
    const saleCount = new Map<string, number>();
    const saleValue = new Map<string, number>();
    for (const s of sales ?? []) {
      if (!s.reseller_id) continue;
      saleCount.set(s.reseller_id, (saleCount.get(s.reseller_id) ?? 0) + 1);
      saleValue.set(s.reseller_id, (saleValue.get(s.reseller_id) ?? 0) + Number(s.sale_price));
    }

    setRows(
      (profiles ?? [])
        .filter((p) => roleOf.has(p.id))
        .map((p) => ({
          id: p.id,
          full_name: p.full_name,
          email: p.email,
          joined_at: p.joined_at,
          status: p.status as ResellerRow["status"],
          discount: p.reseller_discount_percent ?? 0,
          role: roleOf.get(p.id)!,
          credits: creditOf.get(p.id) ?? 0,
          sales: saleCount.get(p.id) ?? 0,
          revenue: saleValue.get(p.id) ?? 0,
        }))
        .sort((a, b) => b.credits - a.credits),
    );
    setLoading(false);
  }, [ecosystemDbId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!ecosystem) return null;

  const float = rows.reduce((s, r) => s + r.credits, 0);
  const avgDiscount = rows.length
    ? (rows.reduce((s, r) => s + r.discount, 0) / rows.length).toFixed(1)
    : "0.0";
  const totalSales = rows.reduce((s, r) => s + r.sales, 0);

  return (
    <>
      <PageSection>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Resellers" value={String(rows.length)} tone="brand" />
          <StatCard label="Total float" value={peso(float)} tone="positive" />
          <StatCard label="Avg discount" value={`${avgDiscount}%`} />
          <StatCard label="Reseller sales" value={String(totalSales)} />
        </div>
      </PageSection>

      <PageSection
        title="Reseller network"
        description="Wholesale discounts and sales commissions are captured at transaction time. Credit transfers move exact amounts."
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
                  <div className="grid grid-cols-2 gap-2 rounded-lg bg-muted sm:grid-cols-4 px-3 py-2 text-center">
                    <div>
                      <p className="text-[11px] text-muted-foreground">Wallet</p>
                      <p className="text-sm font-semibold text-success">{peso(r.credits)}</p>
                    </div>
                    <div>
                      <p className="text-[11px] text-muted-foreground">Discount</p>
                      <p className="text-sm font-semibold">{r.discount}%</p>
                    </div>
                    <div>
                      <p className="text-[11px] text-muted-foreground">Discount margin</p>
                      <p className="text-sm font-semibold">{r.discount}%</p>
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
                        <Wallet className="size-4" /> Add credit
                      </Link>
                    </Button>
                    <Button size="sm" variant="outline" className="flex-1" asChild>
                      <Link to="/admin/customers">Edit rates</Link>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </PageSection>
    </>
  );
}
