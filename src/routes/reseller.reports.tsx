import { createFileRoute } from "@tanstack/react-router";
import { Download } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageSection, StatCard } from "@/components/ui-kit";
import { useSession } from "@/lib/session";
import { ledgerIn, peso, shortDateTime } from "@/lib/wavewallet";
import { toast } from "sonner";

export const Route = createFileRoute("/reseller/reports")({
  head: () => ({
    meta: [
      { title: "Earnings & Reports — WaveWallet Reseller" },
      { name: "description", content: "Track reseller earnings, voucher volume and credit activity across daily, monthly, quarterly and custom ranges." },
      { property: "og:title", content: "Earnings & Reports — WaveWallet Reseller" },
      { property: "og:description", content: "Track reseller earnings, voucher volume and credit activity across daily, monthly, quarterly and custom ranges." },
    ],
  }),
  component: ResellerReports,
});

const ranges = [
  { id: "today", label: "Today", days: 1 },
  { id: "daily", label: "7 days", days: 7 },
  { id: "monthly", label: "Monthly", days: 30 },
  { id: "quarterly", label: "Quarterly", days: 90 },
  { id: "yearly", label: "Yearly", days: 365 },
  { id: "custom", label: "Custom", days: 0 },
];

function ResellerReports() {
  const { account, ecosystem } = useSession("reseller");
  const [range, setRange] = useState("monthly");
  if (!account || !ecosystem) return null;

  const days = ranges.find((r) => r.id === range)?.days ?? 30;
  const cutoff = Date.now() - (days || 3650) * 86400000;
  const mine = ledgerIn(ecosystem.id).filter(
    (l) => (l.resellerId === account.id || l.accountId === account.id) && new Date(l.createdAt).getTime() >= cutoff,
  );
  const sales = mine.filter((l) => l.kind === "voucher_purchase" && l.resellerId === account.id);
  const gross = sales.reduce((s, l) => s + (l.grossPrice ?? 0), 0);
  const earnings = sales.reduce((s, l) => s + (l.resellerEarning ?? 0), 0);
  const loads = mine.filter((l) => l.kind === "credit_load");

  return (
    <>
      <PageSection title="My earnings" description="Based on the discount captured at the time of each sale.">
        <Tabs value={range} onValueChange={setRange}>
          <TabsList className="flex w-full flex-wrap justify-start">
            {ranges.map((r) => (
              <TabsTrigger key={r.id} value={r.id}>
                {r.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        {range === "custom" ? (
          <Card className="mt-3 shadow-[var(--shadow-card)]">
            <CardContent className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="from">From</Label>
                <Input id="from" type="date" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="to">To</Label>
                <Input id="to" type="date" />
              </div>
              <div className="flex items-end">
                <Button className="w-full" onClick={() => toast("Custom range applied (demo)")}>
                  Apply range
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : null}
      </PageSection>

      <PageSection>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Gross sales" value={peso(gross)} tone="brand" />
          <StatCard label="My earnings" value={peso(earnings)} tone="positive" />
          <StatCard label="Vouchers sold" value={String(sales.length)} />
          <StatCard label="Credit loads" value={peso(loads.reduce((s, l) => s + Math.abs(l.amount), 0))} hint={`${loads.length} loads`} />
        </div>
      </PageSection>

      <PageSection
        title="Transactions"
        action={
          <Button variant="outline" size="sm" onClick={() => toast("CSV export coming with the data layer")}>
            <Download className="size-4" /> Export CSV
          </Button>
        }
      >
        <Card className="overflow-hidden py-0 shadow-[var(--shadow-card)]">
          <CardContent className="px-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Transaction</TableHead>
                    <TableHead className="hidden sm:table-cell">Customer</TableHead>
                    <TableHead>Gross</TableHead>
                    <TableHead>My earning</TableHead>
                    <TableHead className="hidden md:table-cell text-right">Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {mine.map((t) => (
                    <TableRow key={t.id}>
                      <TableCell>
                        <p className="text-sm font-medium">{t.productName ?? t.kind.replaceAll("_", " ")}</p>
                        <p className="font-mono text-[11px] text-muted-foreground">{t.id}</p>
                      </TableCell>
                      <TableCell className="hidden sm:table-cell text-sm">{t.accountName}</TableCell>
                      <TableCell className="text-sm">{t.grossPrice ? peso(t.grossPrice) : "—"}</TableCell>
                      <TableCell className="text-sm text-success">
                        {t.resellerEarning ? `+${peso(t.resellerEarning)}` : "—"}
                      </TableCell>
                      <TableCell className="hidden md:table-cell text-right text-xs text-muted-foreground">
                        {shortDateTime(t.createdAt)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </PageSection>
    </>
  );
}
