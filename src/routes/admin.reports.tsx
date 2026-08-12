import { createFileRoute } from "@tanstack/react-router";
import { Download } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageSection, StatCard, StatusBadge } from "@/components/ui-kit";
import { useSession } from "@/lib/session";
import { accountsIn, ledgerIn, peso, shortDateTime } from "@/lib/wavewallet";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/reports")({
  head: () => ({
    meta: [
      { title: "Earnings & Reports — WaveWallet Admin" },
      { name: "description", content: "Daily, monthly, quarterly, yearly and custom-range reporting on gross sales, reseller earnings and net revenue." },
      { property: "og:title", content: "Earnings & Reports — WaveWallet Admin" },
      { property: "og:description", content: "Daily, monthly, quarterly, yearly and custom-range reporting on gross sales, reseller earnings and net revenue." },
    ],
  }),
  component: AdminReports,
});

const ranges = [
  { id: "today", label: "Today", days: 1 },
  { id: "daily", label: "7 days", days: 7 },
  { id: "monthly", label: "Monthly", days: 30 },
  { id: "quarterly", label: "Quarterly", days: 90 },
  { id: "yearly", label: "Yearly", days: 365 },
  { id: "custom", label: "Custom", days: 0 },
];

function AdminReports() {
  const { ecosystem } = useSession("admin");
  const [range, setRange] = useState("monthly");
  if (!ecosystem) return null;

  const days = ranges.find((r) => r.id === range)?.days ?? 30;
  const cutoff = Date.now() - (days || 3650) * 86400000;
  const entries = ledgerIn(ecosystem.id).filter((l) => new Date(l.createdAt).getTime() >= cutoff);
  const sales = entries.filter((l) => l.kind === "voucher_purchase");
  const creditSales = sales.filter((l) => l.method === "credits");
  const gross = creditSales.reduce((s, l) => s + (l.grossPrice ?? 0), 0);
  const resellerEarnings = creditSales.reduce((s, l) => s + (l.resellerEarning ?? 0), 0);
  const directSales = creditSales.filter((l) => !l.resellerId);
  const resellerSales = creditSales.filter((l) => l.resellerId);
  const creditActivity = entries
    .filter((l) => l.kind === "credit_load" || l.kind.startsWith("credit_transfer"))
    .reduce((s, l) => s + Math.abs(l.amount), 0);

  const resellers = accountsIn(ecosystem.id, "reseller");

  return (
    <>
      <PageSection title="Earnings & reports" description="Reseller earnings use the discount captured at sale time.">
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
          <StatCard label="Gross sales" value={peso(gross)} tone="positive" />
          <StatCard label="Reseller discount" value={peso(resellerEarnings)} tone="negative" hint="Cost to admin" />
          <StatCard label="Net revenue" value={peso(gross - resellerEarnings)} tone="brand" />
          <StatCard label="Vouchers sold" value={String(sales.length)} hint={`${sales.length - creditSales.length} paid with points`} />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Direct sales" value={String(directSales.length)} hint={peso(directSales.reduce((s, l) => s + (l.grossPrice ?? 0), 0))} />
          <StatCard label="Reseller sales" value={String(resellerSales.length)} hint={peso(resellerSales.reduce((s, l) => s + (l.grossPrice ?? 0), 0))} />
          <StatCard label="Credit activity" value={peso(creditActivity)} hint="Loads and transfers" />
          <StatCard label="Points issued" value={String(entries.filter((l) => l.kind === "points_earned").reduce((s, l) => s + l.amount, 0))} />
        </div>
      </PageSection>

      <PageSection
        title="Reseller performance"
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
                    <TableHead>Reseller</TableHead>
                    <TableHead>Discount</TableHead>
                    <TableHead>Vouchers</TableHead>
                    <TableHead>Gross</TableHead>
                    <TableHead className="text-right">Their earnings</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {resellers.map((r) => {
                    const rs = creditSales.filter((l) => l.resellerId === r.id);
                    return (
                      <TableRow key={r.id}>
                        <TableCell className="font-medium">{r.name}</TableCell>
                        <TableCell>
                          <StatusBadge tone="brand">{r.discountPercent}%</StatusBadge>
                        </TableCell>
                        <TableCell>{rs.length}</TableCell>
                        <TableCell className="text-success">
                          {peso(rs.reduce((s, l) => s + (l.grossPrice ?? 0), 0))}
                        </TableCell>
                        <TableCell className="text-right text-destructive">
                          {peso(rs.reduce((s, l) => s + (l.resellerEarning ?? 0), 0))}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </PageSection>

      <PageSection title="Transactions in range">
        <Card className="overflow-hidden py-0 shadow-[var(--shadow-card)]">
          <CardContent className="px-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Transaction</TableHead>
                    <TableHead className="hidden sm:table-cell">Account</TableHead>
                    <TableHead className="hidden lg:table-cell">Code</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead className="hidden md:table-cell text-right">Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {entries.map((t) => (
                    <TableRow key={t.id}>
                      <TableCell>
                        <p className="text-sm font-medium">{t.productName ?? t.kind.replaceAll("_", " ")}</p>
                        <p className="font-mono text-[11px] text-muted-foreground">{t.id}</p>
                      </TableCell>
                      <TableCell className="hidden sm:table-cell text-sm">{t.accountName}</TableCell>
                      <TableCell className="hidden lg:table-cell font-mono text-xs text-muted-foreground">
                        {t.voucherCode ?? "—"}
                      </TableCell>
                      <TableCell className={t.amount < 0 ? "text-destructive" : "text-success"}>
                        {t.amount < 0 ? "−" : "+"}
                        {t.method === "points" ? `${Math.abs(t.amount)} pts` : peso(t.amount)}
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
