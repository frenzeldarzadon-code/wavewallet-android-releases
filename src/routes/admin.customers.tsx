import { createFileRoute } from "@tanstack/react-router";
import { Link2, Search, ShieldCheck, TrendingUp } from "lucide-react";
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState, PageSection, StatCard, StatusBadge } from "@/components/ui-kit";
import { useSession } from "@/lib/session";
import { accountsIn, getAccount, peso, shortDate, type Account } from "@/lib/wavewallet";
import {
  MAX_DISCOUNT,
  PermissionError,
  promoteToReseller,
  setResellerDiscount,
  useDataVersion,
} from "@/lib/wavewallet-actions";
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
  const { ecosystem, account: actor } = useSession("admin");
  useDataVersion();
  const [q, setQ] = useState("");
  const [promoting, setPromoting] = useState<Account | null>(null);
  const [editing, setEditing] = useState<Account | null>(null);
  if (!ecosystem) return null;

  const all = accountsIn(ecosystem.id, "customer");
  const customers = all.filter(
    (c) =>
      c.name.toLowerCase().includes(q.toLowerCase()) ||
      c.phone.includes(q) ||
      c.email.toLowerCase().includes(q.toLowerCase()),
  );

  return (
    <>
      <PageSection>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Customers" value={String(all.length)} tone="brand" />
          <StatCard
            label="Credits held"
            value={peso(all.reduce((s, c) => s + c.creditBalance, 0))}
            tone="positive"
          />
          <StatCard label="Points outstanding" value={String(all.reduce((s, c) => s + c.pointsBalance, 0))} />
          <StatCard label="Direct (no reseller)" value={String(all.filter((c) => !c.resellerId).length)} />
        </div>
      </PageSection>

      <PageSection>
        <Card className="shadow-[var(--shadow-card)]">
          <CardContent className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-start gap-3">
              <Link2 className="mt-0.5 size-5 text-primary" />
              <div>
                <p className="text-sm font-medium">Grow this list with your signup link</p>
                <p className="text-xs text-muted-foreground">
                  Anyone who opens /join/{ecosystem.slug} joins {ecosystem.name} as a customer.
                </p>
              </div>
            </div>
            <Button asChild variant="outline" size="sm">
              <Link to="/admin/signup-link">Open signup link</Link>
            </Button>
          </CardContent>
        </Card>
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
                      <TableHead className="text-right">Actions</TableHead>
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
                        <TableCell className="text-sm font-medium text-success">{peso(c.creditBalance)}</TableCell>
                        <TableCell className="hidden sm:table-cell">
                          <StatusBadge tone="points">
                            {c.pointsBalance} pts{c.pointsHeld ? ` · ${c.pointsHeld} held` : ""}
                          </StatusBadge>
                        </TableCell>
                        <TableCell className="hidden lg:table-cell text-xs text-muted-foreground">
                          {shortDate(c.joinedAt)}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            <Button size="sm" variant="outline" onClick={() => toast(`Add credit to ${c.name} (demo)`)}>
                              Add credit
                            </Button>
                            <Button size="sm" onClick={() => setPromoting(c)}>
                              <TrendingUp className="size-4" />
                              Make reseller
                            </Button>
                          </div>
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

      <PageSection
        title="Resellers in this ecosystem"
        description="Promoted accounts keep their original wallet, points and history."
      >
        {accountsIn(ecosystem.id, "reseller").length === 0 ? (
          <EmptyState title="No resellers yet" description="Promote a trusted customer to start a reseller network." />
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {accountsIn(ecosystem.id, "reseller").map((r) => (
              <Card key={r.id} className="shadow-[var(--shadow-card)]">
                <CardContent className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{r.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {peso(r.creditBalance)} credits · {r.discountPercent ?? 0}% discount
                    </p>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => setEditing(r)}>
                    Edit discount
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </PageSection>

      <PromoteDialog
        customer={promoting}
        actorId={actor?.id}
        onClose={() => setPromoting(null)}
      />
      <DiscountDialog reseller={editing} actorId={actor?.id} onClose={() => setEditing(null)} />
    </>
  );
}

function PromoteDialog({
  customer,
  actorId,
  onClose,
}: {
  customer: Account | null;
  actorId: string | undefined;
  onClose: () => void;
}) {
  const [discount, setDiscount] = useState("10");

  const confirm = () => {
    if (!customer) return;
    try {
      promoteToReseller(actorId, customer.id, Number(discount));
      toast.success(`${customer.name} is now a reseller at ${discount}% discount.`);
      onClose();
    } catch (e) {
      toast.error(e instanceof PermissionError ? e.message : "Promotion failed.");
    }
  };

  return (
    <Dialog open={!!customer} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Promote to reseller</DialogTitle>
          <DialogDescription>
            {customer
              ? `${customer.name} will gain reseller pricing and be able to load credits for other customers in this ecosystem.`
              : ""}
          </DialogDescription>
        </DialogHeader>
        {customer ? (
          <div className="space-y-3">
            <div className="rounded-lg border border-border bg-muted/40 p-3 text-xs">
              <p className="font-medium text-foreground">Nothing is reset by this change</p>
              <ul className="mt-1 space-y-0.5 text-muted-foreground">
                <li>Credits kept: {peso(customer.creditBalance)}</li>
                <li>Points kept: {customer.pointsBalance} pts</li>
                <li>Voucher purchases and full transaction history stay linked to this account</li>
              </ul>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="discount">Reseller discount (%)</Label>
              <Input
                id="discount"
                inputMode="numeric"
                value={discount}
                onChange={(e) => setDiscount(e.target.value)}
                placeholder="10"
              />
              <p className="text-[11px] text-muted-foreground">
                0–{MAX_DISCOUNT}%. You can change this any time from the resellers list.
              </p>
            </div>
            <p className="flex items-start gap-2 text-[11px] text-muted-foreground">
              <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />
              This action is permission-checked server-side and written to the audit trail.
            </p>
          </div>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={confirm}>Confirm promotion</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DiscountDialog({
  reseller,
  actorId,
  onClose,
}: {
  reseller: Account | null;
  actorId: string | undefined;
  onClose: () => void;
}) {
  const [value, setValue] = useState("");

  const save = () => {
    if (!reseller) return;
    try {
      setResellerDiscount(actorId, reseller.id, Number(value || reseller.discountPercent || 0));
      toast.success(`Discount updated for ${reseller.name}.`);
      onClose();
    } catch (e) {
      toast.error(e instanceof PermissionError ? e.message : "Update failed.");
    }
  };

  return (
    <Dialog
      open={!!reseller}
      onOpenChange={(o) => {
        if (!o) onClose();
        else setValue(String(reseller?.discountPercent ?? 0));
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reseller discount</DialogTitle>
          <DialogDescription>{reseller ? `Set the buying discount for ${reseller.name}.` : ""}</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="edit-discount">Discount (%)</Label>
          <Input
            id="edit-discount"
            inputMode="numeric"
            value={value === "" ? String(reseller?.discountPercent ?? 0) : value}
            onChange={(e) => setValue(e.target.value)}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save}>Save discount</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
