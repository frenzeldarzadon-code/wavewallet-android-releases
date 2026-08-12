import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Plus } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageSection, StatusBadge, subscriptionTone } from "@/components/ui-kit";
import { writeSession } from "@/lib/session";
import { accounts, ecosystems, peso, shortDate, statusLabel } from "@/lib/wavewallet";
import { toast } from "sonner";

export const Route = createFileRoute("/super/admins")({
  head: () => ({
    meta: [
      { title: "Ecosystems & Admins — WaveWallet Super Admin" },
      { name: "description", content: "Create admins, review tenant ecosystems and enter Super Admin Mode." },
      { property: "og:title", content: "Ecosystems & Admins — WaveWallet Super Admin" },
      { property: "og:description", content: "Create admins, review tenant ecosystems and enter Super Admin Mode." },
    ],
  }),
  component: SuperAdmins,
});

function SuperAdmins() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  const access = (ecosystemId: string) => {
    writeSession({ accountId: "acc_super", superAdminMode: true, ecosystemId });
    navigate({ to: "/admin" });
  };

  return (
    <PageSection
      title="Admin ecosystems"
      description="One Admin ecosystem = one isolated tenant. Multiple admin users may share an ecosystem."
      action={
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="size-4" /> New admin
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Create admin & ecosystem</DialogTitle>
              <DialogDescription>
                The admin names their shop; all their data is scoped to that ecosystem.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="ecoName">Ecosystem / shop name</Label>
                <Input id="ecoName" placeholder="e.g. Northview WiFi" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ecoDesc">Description</Label>
                <Textarea id="ecoDesc" rows={2} placeholder="Coverage area, sites served…" />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="adminName">Admin name</Label>
                  <Input id="adminName" placeholder="Full name" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="adminEmail">Admin email</Label>
                  <Input id="adminEmail" type="email" placeholder="admin@shop.com" />
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button
                onClick={() => {
                  setOpen(false);
                  toast.success("Admin invited", {
                    description: "Demo only — persists once the database is connected.",
                  });
                }}
              >
                Create admin
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      }
    >
      <Card className="overflow-hidden py-0 shadow-[var(--shadow-card)]">
        <CardContent className="px-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Ecosystem</TableHead>
                  <TableHead className="hidden md:table-cell">Admin users</TableHead>
                  <TableHead className="hidden sm:table-cell">Created</TableHead>
                  <TableHead>Plan</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ecosystems.map((eco) => (
                  <TableRow key={eco.id}>
                    <TableCell>
                      <p className="font-medium">{eco.name}</p>
                      <p className="text-xs text-muted-foreground">{eco.contactEmail}</p>
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-sm">
                      {accounts
                        .filter((a) => a.ecosystemId === eco.id && a.role === "admin")
                        .map((a) => a.name)
                        .join(", ") || "—"}
                    </TableCell>
                    <TableCell className="hidden sm:table-cell text-sm text-muted-foreground">
                      {shortDate(eco.createdAt)}
                    </TableCell>
                    <TableCell className="text-sm">{peso(eco.subscription.priceMonthly)}/mo</TableCell>
                    <TableCell>
                      <StatusBadge tone={subscriptionTone(eco.subscription.status)}>
                        {statusLabel[eco.subscription.status]}
                      </StatusBadge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="outline" onClick={() => access(eco.id)}>
                        Access
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
      <p className="mt-3 text-xs text-muted-foreground">
        Entering an ecosystem starts Super Admin Mode: a persistent banner is shown, a return path is
        provided, and the access is written to the audit trail.
      </p>
    </PageSection>
  );
}
