import { createFileRoute } from "@tanstack/react-router";
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
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { PageSection, StatusBadge } from "@/components/ui-kit";
import { useSession } from "@/lib/session";
import { effectivePrice, peso, voucherProductsIn } from "@/lib/wavewallet";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/products")({
  head: () => ({
    meta: [
      { title: "Voucher Products — WaveWallet Admin" },
      { name: "description", content: "Create and price voucher products with credit price, points price and promo settings." },
      { property: "og:title", content: "Voucher Products — WaveWallet Admin" },
      { property: "og:description", content: "Create and price voucher products with credit price, points price and promo settings." },
    ],
  }),
  component: AdminProducts,
});

function AdminProducts() {
  const { ecosystem } = useSession("admin");
  const [open, setOpen] = useState(false);
  if (!ecosystem) return null;
  const products = voucherProductsIn(ecosystem.id);

  return (
    <PageSection
      title="Voucher products"
      description="Text-only products: name, description, prices and stock. No images."
      action={
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="size-4" /> New product
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>New voucher product</DialogTitle>
              <DialogDescription>Codes are imported separately in Code inventory.</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="pname">Product name</Label>
                <Input id="pname" placeholder="e.g. 3 Hours Surf" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pdesc">Description</Label>
                <Textarea id="pdesc" rows={2} placeholder="What the customer gets" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="pcredit">Credit price</Label>
                  <Input id="pcredit" type="number" placeholder="0" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="ppoints">Points price</Label>
                  <Input id="ppoints" type="number" placeholder="Optional" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="ppromo">Promo price</Label>
                  <Input id="ppromo" type="number" placeholder="Optional" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="plabel">Promo label</Label>
                  <Input id="plabel" placeholder="Optional" />
                </div>
              </div>
              <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
                <Label htmlFor="pactive">Active in shop</Label>
                <Switch id="pactive" defaultChecked />
              </div>
            </div>
            <DialogFooter>
              <Button
                onClick={() => {
                  setOpen(false);
                  toast.success("Product created (demo)");
                }}
              >
                Create product
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      }
    >
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {products.map((p) => (
          <Card key={p.id} className="shadow-[var(--shadow-card)]">
            <CardContent className="space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium">{p.name}</p>
                  <p className="text-xs text-muted-foreground">{p.description}</p>
                </div>
                <StatusBadge tone={p.active ? "success" : "muted"}>
                  {p.active ? "Active" : "Inactive"}
                </StatusBadge>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge tone="brand">{peso(effectivePrice(p))} credits</StatusBadge>
                {p.promoPrice ? (
                  <StatusBadge tone="warning">
                    Promo · was {peso(p.creditPrice)}
                  </StatusBadge>
                ) : null}
                {p.pointsPrice ? (
                  <StatusBadge tone="points">{p.pointsPrice} pts</StatusBadge>
                ) : (
                  <StatusBadge tone="muted">Not points-eligible</StatusBadge>
                )}
              </div>
              <div className="flex items-center justify-between border-t border-border pt-3 text-xs">
                <span className={p.stockUnused === 0 ? "text-destructive" : "text-success"}>
                  {p.stockUnused} unused
                </span>
                <span className="text-muted-foreground">{p.stockSold} sold</span>
                <Button variant="outline" size="sm" onClick={() => toast("Edit product (demo)")}>
                  Edit
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </PageSection>
  );
}
