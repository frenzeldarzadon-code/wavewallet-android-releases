import { createFileRoute } from "@tanstack/react-router";
import { Search } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState, PageSection, StatCard, StatusBadge } from "@/components/ui-kit";
import { useSession } from "@/lib/session";
import { accountsIn, getAccount, peso, shortDate } from "@/lib/wavewallet";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/customers")({
  head: () => ({
    meta: [
      { title: "Customers — WaveWallet Admin" },
      { name: "description", content: "All customer accounts in your ecosystem with credit wallets, points and reseller assignment." },
      { property: "og:title", content: "Customers — WaveWallet Admin" },
      { property: "og:description", content: "All customer accounts in your ecosystem with credit wallets, points and reseller assignment." },
    ],
  }),
  component: AdminCustomers,
});

function AdminCustomers() {
  const { ecosystem } = useSession("admin");
  const [q, setQ] = useState("");
  if (!ecosystem) return null;

  const customers = accountsIn(ecosystem.id, "customer").filter(
    (c) =>
      c.name.toLowerCase().includes(q.toLowerCase()) ||
      c.phone.includes(q) ||
      c.email.toLowerCase().includes(q.toLowerCase()),
  );

  return (
    <>
      <PageSection>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Customers" value={String(accountsIn(ecosystem.id, "customer").length)} tone="brand" />
          <StatCard
            label="Credits held"
            value={peso(accountsIn(ecosystem.id, "customer").reduce((s, c) => s + c.creditBalance, 0))}
            tone="positive"
          />
          <StatCard
            label="Points outstanding"
            value={String(accountsIn(ecosystem.id, "customer").reduce((s, c) => s + c.pointsBalance, 0))}
          />
          <StatCard
            label="Direct (no reseller)"
            value={String(accountsIn(ecosystem.id, "customer").filter((c) => !c.resellerId).length)}
          />
        </div>
      </PageSection>

      <PageSection title="Customer directory" description="Scoped strictly to this ecosystem.">
        <div className="mb-3 flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, email or mobile" className="pl-9" />
          </div>
        </div>
        {customers.length === 0 ? (
          <EmptyState title="No customers match" description="Try a different name or number." />
        ) : (
          <Card className="overflow-hidden py-0 shadow-[var(--shadow-card)]">
            <CardContent className="px-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Customer</TableHead>
                      <TableHead className="hidden md:table-cell">Reseller</TableHead>
                      <TableHead>Credits</TableHead>
                      <TableHead className="hidden sm:table-cell">Points</TableHead>
                      <TableHead className="hidden lg:table-cell">Joined</TableHead>
                      <TableHead className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {customers.map((c) => (
                      <TableRow key={c.id}>
                        <TableCell>
                          <p className="font-medium">{c.name}</p>
                          <p className="text-xs text-muted-foreground">{c.phone}</p>
                        </TableCell>
                        <TableCell className="hidden md:table-cell text-sm">
                          {c.resellerId ? (
                            getAccount(c.resellerId)?.name
                          ) : (
                            <StatusBadge tone="brand">Direct</StatusBadge>
                          )}
                        </TableCell>
                        <TableCell className="text-sm font-medium text-success">
                          {peso(c.creditBalance)}
                        </TableCell>
                        <TableCell className="hidden sm:table-cell">
                          <StatusBadge tone="points">
                            {c.pointsBalance} pts{c.pointsHeld ? ` · ${c.pointsHeld} held` : ""}
                          </StatusBadge>
                        </TableCell>
                        <TableCell className="hidden lg:table-cell text-xs text-muted-foreground">
                          {shortDate(c.joinedAt)}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button size="sm" variant="outline" onClick={() => toast(`Add credit to ${c.name} (demo)`)}>
                            Add credit
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        )}
      </PageSection>
    </>
  );
}
