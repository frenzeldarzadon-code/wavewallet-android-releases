/**
 * Retail product management for one shop's admin.
 *
 * Hiding or archiving a product never deletes it: past orders, ratings and
 * history keep pointing at the same row, so a shop can switch a store off and
 * back on without losing anything.
 */
import { Archive, ImageUp, Loader2, Pencil, Plus } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
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
import { RetailImage } from "@/components/retail/retail-image";
import {
  fetchAllRetailProducts,
  saveRetailProduct,
  setRetailProductArchived,
  uploadRetailImage,
  type RetailProductRow,
} from "@/lib/retail";

interface Draft {
  id?: string;
  name: string;
  description: string;
  price: string;
  stock: string;
  image_path: string | null;
  public_visible: boolean;
  active: boolean;
}

const empty: Draft = {
  name: "",
  description: "",
  price: "",
  stock: "0",
  image_path: null,
  public_visible: true,
  active: true,
};

export function RetailProductsCard({ ecosystemId }: { ecosystemId: string | null }) {
  const [rows, setRows] = useState<RetailProductRow[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    if (!ecosystemId) return;
    setLoading(true);
    try {
      setRows(await fetchAllRetailProducts(ecosystemId));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [ecosystemId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!ecosystemId) return null;

  const upload = async (file: File) => {
    if (!draft) return;
    setBusy(true);
    try {
      const path = await uploadRetailImage(ecosystemId, file);
      setDraft({ ...draft, image_path: path });
      toast.success("Photo ready");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!draft) return;
    if (!draft.name.trim()) {
      toast.error("A product needs a name");
      return;
    }
    setBusy(true);
    try {
      await saveRetailProduct(ecosystemId, {
        ...(draft.id ? { id: draft.id } : {}),
        name: draft.name,
        description: draft.description,
        price: Number(draft.price) || 0,
        stock: Number(draft.stock) || 0,
        image_path: draft.image_path,
        public_visible: draft.public_visible,
        active: draft.active,
      });
      toast.success(draft.id ? "Product updated" : "Product created");
      setDraft(null);
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageSection
        title="Retail products"
        description="Physical goods with photo, price and stock. Archiving keeps every past order intact."
        action={
          <Button size="sm" onClick={() => setDraft({ ...empty })}>
            <Plus className="size-4" /> New product
          </Button>
        }
      >
        {loading ? (
          <p className="text-xs text-muted-foreground">Loading products…</p>
        ) : rows.length === 0 ? (
          <EmptyState
            title="No retail products yet"
            description="Add your first product to open the retail store."
          />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {rows.map((p) => (
              <Card key={p.id} className="overflow-hidden shadow-[var(--shadow-card)]">
                <RetailImage path={p.image_path} alt={p.name} />
                <CardContent className="space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-semibold">{p.name}</p>
                    <StatusBadge tone={p.archived ? "muted" : p.active ? "success" : "warning"}>
                      {p.archived ? "archived" : p.active ? "live" : "hidden"}
                    </StatusBadge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {p.price.toLocaleString()} credits · {p.stock} in stock · {p.sold_count} sold
                    {p.public_visible ? " · visible to visitors" : " · members only"}
                  </p>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        setDraft({
                          id: p.id,
                          name: p.name,
                          description: p.description ?? "",
                          price: String(p.price),
                          stock: String(p.stock),
                          image_path: p.image_path,
                          public_visible: p.public_visible,
                          active: p.active,
                        })
                      }
                    >
                      <Pencil className="size-4" /> Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={async () => {
                        try {
                          await setRetailProductArchived(p.id, !p.archived);
                          await load();
                        } catch (e) {
                          toast.error((e as Error).message);
                        }
                      }}
                    >
                      <Archive className="size-4" /> {p.archived ? "Restore" : "Archive"}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </PageSection>

      <Dialog open={!!draft} onOpenChange={(o) => !o && setDraft(null)}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{draft?.id ? "Edit product" : "New product"}</DialogTitle>
            <DialogDescription>
              Products, stock and prices belong to this shop only.
            </DialogDescription>
          </DialogHeader>
          {draft ? (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="rp-name">Name</Label>
                <Input
                  id="rp-name"
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rp-desc">Description</Label>
                <Textarea
                  id="rp-desc"
                  rows={2}
                  value={draft.description}
                  onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="rp-price">Price (coins)</Label>
                  <Input
                    id="rp-price"
                    type="number"
                    inputMode="decimal"
                    value={draft.price}
                    onChange={(e) => setDraft({ ...draft, price: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="rp-stock">Stock</Label>
                  <Input
                    id="rp-stock"
                    type="number"
                    inputMode="numeric"
                    value={draft.stock}
                    onChange={(e) => setDraft({ ...draft, stock: e.target.value })}
                  />
                </div>
              </div>
              <RetailImage path={draft.image_path} alt="Product photo" className="rounded-xl" />
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void upload(f);
                  e.target.value = "";
                }}
              />
              <Button
                type="button"
                variant="outline"
                className="w-full"
                disabled={busy}
                onClick={() => fileRef.current?.click()}
              >
                <ImageUp className="size-4" /> Upload photo
              </Button>
              <div className="flex items-center justify-between rounded-xl border border-border px-3 py-2">
                <Label htmlFor="rp-live">Available to buy</Label>
                <Switch
                  id="rp-live"
                  checked={draft.active}
                  onCheckedChange={(v) => setDraft({ ...draft, active: v })}
                />
              </div>
              <div className="flex items-center justify-between rounded-xl border border-border px-3 py-2">
                <Label htmlFor="rp-public">Show on the public storefront</Label>
                <Switch
                  id="rp-public"
                  checked={draft.public_visible}
                  onCheckedChange={(v) => setDraft({ ...draft, public_visible: v })}
                />
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDraft(null)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={() => void save()} disabled={busy}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : null} Save product
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
