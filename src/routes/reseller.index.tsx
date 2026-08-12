import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, Facebook, Percent, Ticket, Users, Wallet } from "lucide-react";
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
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageSection, StatCard, StatusBadge } from "@/components/ui-kit";
import { useSession } from "@/lib/session";
import { accounts, ledgerIn, peso, shortDateTime } from "@/lib/wavewallet";
import { toast } from "sonner";

export const Route = createFileRoute("/reseller/")({
  head: () => ({
    meta: [
      { title: "Reseller Dashboard — WaveWallet" },
      { name: "description", content: "Reseller wallet, discount, customer loads and recent activity in one place." },
      { property: "og:title", content: "Reseller Dashboard — WaveWallet" },
      { property: "og:description", content: "Reseller wallet, discount, customer loads and recent activity in one place." },
    ],
  }),
  component: ResellerDashboard,
});

function ResellerDashboard() {
  const { account, ecosystem } = useSession("reseller");
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState("");
  if (!account || !ecosystem) return null;

  const entries = ledgerIn(ecosystem.id).filter(
    (l) => l.resellerId === account.id || l.accountId === account.id,
  );
  const sales = entries.filter((l) => l.kind === "voucher_purchase" && l.resellerId === account.id);
  const earnings = sales.reduce((s, l) => s + (l.resellerEarning ?? 0), 0);
  const myCustomers = accounts.filter((a) => a.resellerId === account.id);

  return (
    <>
      <Card className="credit-gradient mb-5 border-0 text-primary-foreground shadow-[var(--shadow-float)]">
        <CardContent className="space-y-4">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs opacity-85">Reseller credit wallet</p>
              <p className="text-3xl font-semibold tracking-tight">{peso(account.creditBalance)}</p>
            </div>
            <Wallet className="size-5 opacity-80" />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild size="sm" variant="secondary">
              <Link to="/reseller/shop">Buy vouchers</Link>
            </Button>
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button size="sm" variant="secondary">
                  Load a customer
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-sm">
                <DialogHeader>
                  <DialogTitle>Load credits to a customer</DialogTitle>
                  <DialogDescription>
                    Deducted from your wallet and recorded in both ledgers.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <Label>Customer</Label>
                    <Select value={target} onValueChange={setTarget}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select customer" />
                      </SelectTrigger>
                      <SelectContent>
                        {myCustomers.map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.name} · {c.phone}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="amount">Amount</Label>
                    <Input id="amount" type="number" placeholder="0" />
                  </div>
                </div>
                <DialogFooter>
                  <Button
                    disabled={!target}
                    onClick={() => {
                      setOpen(false);
                      toast.success("Credits loaded (demo)");
                    }}
                  >
                    Confirm load
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </CardContent>
      </Card>

      <PageSection>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="My discount" value={`${account.discountPercent}%`} icon={Percent} tone="brand" />
          <StatCard label="Earnings" value={peso(earnings)} tone="positive" hint="Captured at sale time" />
          <StatCard label="Vouchers sold" value={String(sales.length)} icon={Ticket} />
          <StatCard label="My customers" value={String(myCustomers.length)} icon={Users} />
        </div>
      </PageSection>

      <PageSection
        title="Recent activity"
        action={
          <Button asChild variant="ghost" size="sm">
            <Link to="/reseller/reports">
              All reports <ArrowRight className="size-3.5" />
            </Link>
          </Button>
        }
      >
        <Card className="shadow-[var(--shadow-card)]">
          <CardContent className="divide-y divide-border px-0 py-0">
            {entries.slice(0, 6).map((t) => (
              <div key={t.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {t.productName ?? t.kind.replaceAll("_", " ")}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {t.accountName} · {shortDateTime(t.createdAt)}
                  </p>
                </div>
                {t.resellerEarning ? (
                  <StatusBadge tone="success">+{peso(t.resellerEarning)}</StatusBadge>
                ) : (
                  <span className={t.amount < 0 ? "text-sm text-destructive" : "text-sm text-success"}>
                    {t.amount < 0 ? "−" : "+"}
                    {peso(t.amount)}
                  </span>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      </PageSection>

      <Card className="shadow-[var(--shadow-card)]">
        <CardContent className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-start gap-2">
            <Facebook className="mt-0.5 size-4 text-primary" />
            <div>
              <p className="text-sm font-medium">{ecosystem.facebookPageName}</p>
              <p className="text-xs text-muted-foreground">{ecosystem.facebookSupportMessage}</p>
            </div>
          </div>
          <Button asChild variant="outline" size="sm">
            <a href={ecosystem.facebookPageUrl} target="_blank" rel="noreferrer">
              Message support
            </a>
          </Button>
        </CardContent>
      </Card>
    </>
  );
}
