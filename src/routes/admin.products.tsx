import { createFileRoute } from "@tanstack/react-router";
import { Archive, Pencil, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
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
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState, PageSection, StatusBadge } from "@/components/ui-kit";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/lib/session";
import { peso } from "@/lib/wavewallet";
import {
  canSubmitProductDeletion,
  deleteVoucherProduct,
  productDeletionWarning,
} from "@/lib/voucher-product-deletion";
import {
  fetchInventoryCounts,
  fetchProducts,
  listPrice,
  type InventoryCount,
  type VoucherProductRow,
} from "@/lib/wallet";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/products")({
  head: () => ({
    meta: [
      { title: "Voucher Products — WaveWallet Admin" },
      {
        name: "description",
        content:
          "Create, price and archive text-only voucher products for your shop. Coin price, points placeholder and promo pricing.",
      },
      { property: "og:title", content: "Voucher Products — WaveWallet Admin" },
      {
        property: "og:description",
        content: "Manage voucher products and pricing for your own shop only.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AdminProducts,
});

interface Draft {
  id?: string;
  name: string;
  description: string;
  credit_price: string;
  points_price: string;
  promo_price: string;
  promo_note: string;
  active: boolean;
}

const emptyDraft: Draft = {
  name: "",
  description: "",
  credit_price: "",
  points_price: "",
  promo_price: "",
  promo_note: "",
  active: true,
};

function AdminProducts() {
  const { ecosystemDbId } = useSession("admin");
  const [products, setProducts] = useState<VoucherProductRow[]>([]);
  const [counts, setCounts] = useState<Record<string, InventoryCount>>({});
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [toDelete, setToDelete] = useState<VoucherProductRow | null>(null);
  const [typed, setTyped] = useState("");
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    if (!ecosystemDbId) return;
    setLoading(true);
    try {
      const [p, c] = await Promise.all([
        fetchProducts(ecosystemDbId),
        fetchInventoryCounts(ecosystemDbId),
      ]);
      setProducts(p);
      setCounts(c);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [ecosystemDbId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!ecosystemDbId) return null;

  const save = async () => {
    if (!draft) return;
    if (!draft.name.trim()) {
      toast.error("A product needs a name");
      return;
    }
    setBusy(true);
    const payload = {
      ecosystem_id: ecosystemDbId,
      name: draft.name.trim(),
      description: draft.description.trim(),
      credit_price: Number(draft.credit_price) || 0,
      points_price: draft.points_price ? Number(draft.points_price) : null,
      promo_price: draft.promo_price ? Number(draft.promo_price) : null,
      promo_note: draft.promo_note.trim() || null,
      active: draft.active,
    };
    const { error } = draft.id
      ? await supabase.from("voucher_products").update(payload).eq("id", draft.id)
      : await supabase.from("voucher_products").insert(payload);
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(draft.id ? "Product updated" : "Product created");
    setDraft(null);
    await load();
  };

  const toggleArchive = async (p: VoucherProductRow) => {
    const { error } = await supabase
      .from("voucher_products")
      .update({ archived: !p.archived, active: p.archived ? p.active : false })
      .eq("id", p.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(p.archived ? "Product restored" : "Product archived");
    await load();
  };

  const toggleActive = async (p: VoucherProductRow, active: boolean) => {
    const { error } = await supabase.from("voucher_products").update({ active }).eq("id", p.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    await load();
  };

  return (
    <PageSection devSlot="products.voucher-products"
      title="Voucher products"
      description="Text-only products: name, description, prices and stock. No images."
      action={
        <Button size="sm" onClick={() => setDraft({ ...emptyDraft })}>
          <Plus className="size-4" /> New product
        </Button>
      }
    >
      {loading ? (
        <EmptyState title="Loading products…" />
      ) : products.length === 0 ? (
        <EmptyState
          title="No voucher products yet"
          description="Create a product, then import its codes in Code inventory."
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {products.map((p) => {
            const c = counts[p.id];
            return (
              <Card key={p.id} className="shadow-[var(--shadow-card)]">
                <CardContent className="space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium">{p.name}</p>
                      <p className="text-xs text-muted-foreground">{p.description || "No description"}</p>
                    </div>
                    <StatusBadge tone={p.archived ? "muted" : p.active ? "success" : "warning"}>
                      {p.archived ? "Archived" : p.active ? "Active" : "Inactive"}
                    </StatusBadge>
                  </div>
                  <div className="flex flex-wrap items-end gap-3">
                    <div>
                      <p className="text-lg font-semibold">{peso(listPrice(p))}</p>
                      {p.promo_price !== null ? (
                        <p className="text-[11px] text-muted-foreground line-through">
                          {peso(p.credit_price)} {p.promo_note ? `· ${p.promo_note}` : ""}
                        </p>
                      ) : null}
                    </div>
                    <StatusBadge tone="points">
                      {p.points_price ? `${p.points_price} pts` : "Points later"}
                    </StatusBadge>
                    <StatusBadge tone={c && c.unused > 0 ? "success" : "danger"}>
                      {c ? `${c.unused} unused · ${c.sold} sold` : "0 unused · 0 sold"}
                    </StatusBadge>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        setDraft({
                          id: p.id,
                          name: p.name,
                          description: p.description,
                          credit_price: String(p.credit_price),
                          points_price: p.points_price === null ? "" : String(p.points_price),
                          promo_price: p.promo_price === null ? "" : String(p.promo_price),
                          promo_note: p.promo_note ?? "",
                          active: p.active,
                        })
                      }
                    >
                      <Pencil className="size-4" /> Edit
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => void toggleArchive(p)}>
                      <Archive className="size-4" /> {p.archived ? "Restore" : "Archive"}
                    </Button>
                    {!p.archived ? (
                      <label className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
                        On sale
                        <Switch
                          checked={p.active}
                          onCheckedChange={(v) => void toggleActive(p, v)}
                        />
                      </label>
                    ) : null}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={!!draft} onOpenChange={(o) => !o && setDraft(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{draft?.id ? "Edit voucher product" : "New voucher product"}</DialogTitle>
            <DialogDescription>Codes are imported separately in Code inventory.</DialogDescription>
          </DialogHeader>
          {draft ? (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="pname">Product name</Label>
                <Input
                  id="pname"
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  placeholder="e.g. 3 Hours Surf"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pdesc">Description</Label>
                <Textarea
                  id="pdesc"
                  rows={2}
                  value={draft.description}
                  onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                  placeholder="What the customer gets"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="pcredit">Coin price</Label>
                  <Input
                    id="pcredit"
                    type="number"
                    value={draft.credit_price}
                    onChange={(e) => setDraft({ ...draft, credit_price: e.target.value })}
                    placeholder="0"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="ppoints">Points price</Label>
                  <Input
                    id="ppoints"
                    type="number"
                    value={draft.points_price}
                    onChange={(e) => setDraft({ ...draft, points_price: e.target.value })}
                    placeholder="Optional (later stage)"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="ppromo">Promo price</Label>
                  <Input
                    id="ppromo"
                    type="number"
                    value={draft.promo_price}
                    onChange={(e) => setDraft({ ...draft, promo_price: e.target.value })}
                    placeholder="Optional"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="pnote">Promo note</Label>
                  <Input
                    id="pnote"
                    value={draft.promo_note}
                    onChange={(e) => setDraft({ ...draft, promo_note: e.target.value })}
                    placeholder="Weekend deal"
                  />
                </div>
              </div>
              <label className="flex items-center justify-between rounded-xl border border-border px-3 py-2 text-sm">
                Show in customer shop
                <Switch
                  checked={draft.active}
                  onCheckedChange={(v) => setDraft({ ...draft, active: v })}
                />
              </label>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDraft(null)}>
              Cancel
            </Button>
            <Button onClick={() => void save()} disabled={busy}>
              {busy ? "Saving…" : "Save product"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageSection>
  );
}
