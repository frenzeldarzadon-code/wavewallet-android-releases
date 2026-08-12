import { createFileRoute } from "@tanstack/react-router";
import { Plus, Wallet } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageSection, StatCard, StatusBadge } from "@/components/ui-kit";
import { useSession } from "@/lib/session";
import { accountsIn, ledgerIn, peso, shortDate, type Account } from "@/lib/wavewallet";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/resellers")({
  head: () => ({
    meta: [
      { title: "Resellers — WaveWallet Admin" },
      { name: "description", content: "Manage reseller accounts, discounts, credit loads and performance inside your ecosystem." },
      { property: "og:title", content: "Resellers — WaveWallet Admin" },
      { property: "og:description", content: "Manage reseller accounts, discounts, credit loads and performance inside your ecosystem." },
    ],
  }),
  component: AdminResellers,
});

function AdminResellers() {
  const { ecosystem } = useSession("admin");
  const [loadTarget, setLoadTarget] = useState<Account | null>(null);
  if (!ecosystem) return null;

  const resellers = accountsIn(ecosystem.id, "reseller");
  const entries = ledgerIn(ecosystem.id);

  return (
    <>
      <PageSection>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Resellers" value={String(resellers.length)} tone="brand" />
          <StatCard
            label="Total float"
            value={peso(resellers.reduce((s, r) => s + r.creditBalance, 0))}
            tone="positive"
          />
          <StatCard
            label="Avg discount"
            value={`${(resellers.reduce((s, r) => s + (r.discountPercent ?? 0), 0) / (resellers.length || 1)).toFixed(1)}%`}
          />
          <StatCard
            label="Reseller sales"
            value={String(entries.filter((l) => l.kind === "voucher_purchase" && l.resellerId).length)}
          />
        </div>
      </PageSection>

      <PageSection
        title="Reseller network"
        description="Discounts are configurable per reseller and captured at sale time."
        action={
          <Button size="sm" onClick={() => toast("Invite reseller (demo)")}>
            <Plus className="size-4" /> Add reseller
          </Button>
        }
      >
        <div className="grid gap-3 md:grid-cols-2">
          {resellers.map((r) => {
            const sales = entries.filter((l) => l.resellerId === r.id && l.kind === "voucher_purchase");
            const earnings = sales.reduce((s, l) => s + (l.resellerEarning ?? 0), 0);
            return (
              <Card key={r.id} className="shadow-[var(--shadow-card)]">
                <CardContent className="space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-medium">{r.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {r.email} · joined {shortDate(r.joinedAt)}
                      </p>
                    </div>
                    <StatusBadge tone={r.status === "active" ? "success" : "danger"}>{r.status}</StatusBadge>
                  </div>
                  <div className="grid grid-cols-3 gap-2 rounded-lg bg-muted px-3 py-2 text-center">
                    <div>
                      <p className="text-[11px] text-muted-foreground">Wallet</p>
                      <p className="text-sm font-semibold text-success">{peso(r.creditBalance)}</p>
                    </div>
                    <div>
                      <p className="text-[11px] text-muted-foreground">Discount</p>
                      <p className="text-sm font-semibold">{r.discountPercent}%</p>
                    </div>
                    <div>
                      <p className="text-[11px] text-muted-foreground">Earnings</p>
                      <p className="text-sm font-semibold">{peso(earnings)}</p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" className="flex-1" onClick={() => setLoadTarget(r)}>
                      <Wallet className="size-4" /> Add credit
                    </Button>
                    <Button size="sm" variant="outline" className="flex-1" onClick={() => toast("Edit discount (demo)")}>
                      Edit discount
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </PageSection>

      <Dialog open={!!loadTarget} onOpenChange={(o) => !o && setLoadTarget(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Add credit to {loadTarget?.name}</DialogTitle>
            <DialogDescription>
              Creates an immutable ledger entry. Credit loads do not earn points.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="amt">Amount (credits)</Label>
              <Input id="amt" type="number" placeholder="0" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="note">Note</Label>
              <Input id="note" placeholder="Reference or remark" />
            </div>
          </div>
          <DialogFooter>
            <Button
              onClick={() => {
                toast.success(`Credit loaded to ${loadTarget?.name} (demo)`);
                setLoadTarget(null);
              }}
            >
              Confirm load
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
