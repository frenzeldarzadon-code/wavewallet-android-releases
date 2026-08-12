import { createFileRoute } from "@tanstack/react-router";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState, PageSection, StatusBadge } from "@/components/ui-kit";
import { useSession } from "@/lib/session";
import { accounts, ledger, peso, shortDate } from "@/lib/wavewallet";
import { toast } from "sonner";

export const Route = createFileRoute("/reseller/customers")({
  head: () => ({
    meta: [
      { title: "My Customers — WaveWallet Reseller" },
      { name: "description", content: "Customers assigned to you, their wallet balances, points and purchase counts." },
      { property: "og:title", content: "My Customers — WaveWallet Reseller" },
      { property: "og:description", content: "Customers assigned to you, their wallet balances, points and purchase counts." },
    ],
  }),
  component: ResellerCustomers,
});

function ResellerCustomers() {
  const { account } = useSession("reseller");
  if (!account) return null;
  const mine = accounts.filter((a) => a.resellerId === account.id);

  return (
    <PageSection title="Assigned customers" description="Customers linked to your reseller account.">
      {mine.length === 0 ? (
        <EmptyState title="No customers yet" description="Customers appear here once they are linked to you." />
      ) : (
        <Card className="overflow-hidden py-0 shadow-[var(--shadow-card)]">
          <CardContent className="px-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Customer</TableHead>
                    <TableHead>Credits</TableHead>
                    <TableHead className="hidden sm:table-cell">Points</TableHead>
                    <TableHead className="hidden md:table-cell">Purchases</TableHead>
                    <TableHead className="hidden lg:table-cell">Joined</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {mine.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell>
                        <p className="font-medium">{c.name}</p>
                        <p className="text-xs text-muted-foreground">{c.phone}</p>
                      </TableCell>
                      <TableCell className="font-medium text-success">{peso(c.creditBalance)}</TableCell>
                      <TableCell className="hidden sm:table-cell">
                        <StatusBadge tone="points">{c.pointsBalance} pts</StatusBadge>
                      </TableCell>
                      <TableCell className="hidden md:table-cell text-sm">
                        {ledger.filter((l) => l.accountId === c.id && l.kind === "voucher_purchase").length}
                      </TableCell>
                      <TableCell className="hidden lg:table-cell text-xs text-muted-foreground">
                        {shortDate(c.joinedAt)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" variant="outline" onClick={() => toast(`Load credits to ${c.name} (demo)`)}>
                          Load credits
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
  );
}
