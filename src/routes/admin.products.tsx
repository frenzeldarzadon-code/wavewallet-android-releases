import { createFileRoute } from "@tanstack/react-router";
import { ShopTypeGate } from "@/components/shop/shop-type-gate";
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
  DEFAULT_VOUCHER_FEE_PERCENT,
  fetchVoucherPlatformFeePercent,
  platformFeeFromRetail,
  retailFromSellerCut,
  sellerCutFromRetail,
  type VoucherPriceMode,
} from "@/lib/voucher-pricing";
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
      { title: "Voucher Products — ONE WAVE Admin" },
      {
        name: "description",
        content:
          "Create, price and archive text-only voucher products for your shop. Coin price, points placeholder and promo pricing.",
      },
      { property: "og:title", content: "Voucher Products — ONE WAVE Admin" },
      {
        property: "og:description",
        content: "Manage voucher products and pricing for your own shop only.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AdminProductsGate,
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
  /** Universe only: which price field is authoritative right now. */
  price_mode: VoucherPriceMode;
  /** Universe only: the seller's cut typed in "Set seller's cut" mode. */
  seller_cut: string;
}

const emptyDraft: Draft = {
  name: "",
  description: "",
  credit_price: "",
  points_price: "",
  promo_price: "",
  promo_note: "",
  active: true,
  price_mode: "retail",
  seller_cut: "",
};

function AdminProducts() {
  const { ecosystemDbId, ecosystem } = useSession("admin");
  // Universe shops carry the price-inclusive platform fee; New Generation shops do not.
  const isUniverseShop = ecosystem?.shopKind === "universe";
  const [feePercent, setFeePercent] = useState(DEFAULT_VOUCHER_FEE_PERCENT);
  const [products, setProducts] = useState<VoucherProductRow[]>([]);
  const [counts, setCounts] = useState<Record<string, InventoryCount>>({});
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [toDelete, setToDelete] = useState<VoucherProductRow | null>(null);
  const [typed, setTyped] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [loading, setLoading] = useState(true);

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

  useEffect(() => {
    if (!isUniverseShop) return;
    void fetchVoucherPlatformFeePercent().then(setFeePercent);
  }, [isUniverseShop]);

  if (!ecosystemDbId) return null;

  // The database snapshots the fee rate on insert / re-price and backs the fee
  // out of the customer price; this only previews the same numbers.
  const showFee = isUniverseShop && feePercent > 0;
  const draftRetail = draft
    ? draft.price_mode === "seller_cut" && isUniverseShop
      ? retailFromSellerCut(Number(draft.seller_cut) || 0, feePercent)
      : Number(draft.credit_price) || 0
    : 0;
  const draftCut = sellerCutFromRetail(draftRetail, isUniverseShop ? feePercent : 0);
  const draftFee = platformFeeFromRetail(draftRetail, isUniverseShop ? feePercent : 0);

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
      // Whichever field was authoritative, the stored customer price is the
      // single source of truth (Set seller's cut derives it additively).
      credit_price: draftRetail,
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

  // WaveWallet-side deletion only: the product plus its own voucher codes.
  // Omada is never contacted and no sale or wallet record is touched.
  const confirmDelete = async () => {
    if (!toDelete || deleting) return;
    setDeleting(true);
    try {
      const result = await deleteVoucherProduct({
        productId: toDelete.id,
        confirmName: typed,
      });
      toast.success(
        result.already_deleted
          ? "That product was already deleted."
          : `“${result.name ?? toDelete.name}” deleted · ${result.codes_removed.toLocaleString()} WaveWallet code(s) removed. Omada untouched.`,
      );
      setToDelete(null);
      setTyped("");
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setDeleting(false);
    }
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
                      {showFee ? (
                        <p className="text-[11px] text-muted-foreground">
                          Your cut {peso(sellerCutFromRetail(listPrice(p), p.platform_fee_percent))} ·{" "}
                          {p.platform_fee_percent}% platform fee{" "}
                          {peso(platformFeeFromRetail(listPrice(p), p.platform_fee_percent))} inside the price
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
                          price_mode: "retail",
                          seller_cut: String(
                            sellerCutFromRetail(p.credit_price, isUniverseShop ? p.platform_fee_percent : 0),
                          ),
                        })
                      }
                    >
                      <Pencil className="size-4" /> Edit
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => void toggleArchive(p)}>
                      <Archive className="size-4" /> {p.archived ? "Restore" : "Archive"}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-destructive"
                      onClick={() => {
                        setTyped("");
                        setToDelete(p);
                      }}
                    >
                      <Trash2 className="size-4" /> Delete
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
              {isUniverseShop ? (
                <div className="space-y-1.5">
                  <Label>Price by</Label>
                  <div className="grid grid-cols-2 gap-1.5">
                    <Button
                      type="button"
                      size="sm"
                      variant={draft.price_mode === "retail" ? "default" : "outline"}
                      onClick={() =>
                        setDraft({ ...draft, price_mode: "retail", credit_price: String(draftRetail) })
                      }
                    >
                      Set retail price
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant={draft.price_mode === "seller_cut" ? "default" : "outline"}
                      onClick={() =>
                        setDraft({ ...draft, price_mode: "seller_cut", seller_cut: String(draftCut) })
                      }
                    >
                      Set seller's cut
                    </Button>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    {draft.price_mode === "retail"
                      ? `You set what the customer pays; WaveWallet backs the ${feePercent}% platform fee out of it.`
                      : `You set what you receive; WaveWallet adds the ${feePercent}% platform fee to make the customer price.`}
                  </p>
                </div>
              ) : null}
              <div className="grid grid-cols-2 gap-3">
                {isUniverseShop && draft.price_mode === "seller_cut" ? (
                  <div className="space-y-1.5">
                    <Label htmlFor="pcut">Seller's cut</Label>
                    <Input
                      id="pcut"
                      type="number"
                      value={draft.seller_cut}
                      onChange={(e) => setDraft({ ...draft, seller_cut: e.target.value })}
                      placeholder="0"
                    />
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <Label htmlFor="pcredit">{isUniverseShop ? "Retail price (customer pays)" : "Coin price"}</Label>
                    <Input
                      id="pcredit"
                      type="number"
                      value={draft.credit_price}
                      onChange={(e) => setDraft({ ...draft, credit_price: e.target.value })}
                      placeholder="0"
                    />
                  </div>
                )}
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
              {isUniverseShop ? (
                <div className="space-y-0.5 rounded-xl border border-border px-3 py-2 text-xs">
                  <p className="flex justify-between">
                    <span className="text-muted-foreground">Customer pays</span>
                    <span className="font-semibold">{peso(draftRetail)}</span>
                  </p>
                  <p className="flex justify-between">
                    <span className="text-muted-foreground">Platform fee ({feePercent}%)</span>
                    <span>{peso(draftFee)}</span>
                  </p>
                  <p className="flex justify-between">
                    <span className="text-muted-foreground">Your cut</span>
                    <span className="font-semibold text-success">{peso(draftCut)}</span>
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    Cashback for resellers is calculated separately on the full sale amount. A promo price
                    replaces the customer price for everyone; the fee follows the price actually paid.
                  </p>
                </div>
              ) : null}
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

      <Dialog
        open={!!toDelete}
        onOpenChange={(o) => {
          if (!o && !deleting) {
            setToDelete(null);
            setTyped("");
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete this voucher product?</DialogTitle>
            <DialogDescription>
              {toDelete
                ? productDeletionWarning(toDelete.name, counts[toDelete.id]?.total ?? 0)
                : null}
            </DialogDescription>
          </DialogHeader>
          {toDelete ? (
            <div className="space-y-3">
              <ul className="space-y-1 rounded-xl border border-border p-3 text-xs text-muted-foreground">
                <li>• Removes the product and its WaveWallet voucher codes.</li>
                <li>• Does NOT delete or change anything in Omada.</li>
                <li>• Past sales, Coins, Points, reports and balances stay unchanged.</li>
                <li>• Other products, their codes and their calibrations are untouched.</li>
                <li>• This cannot be undone.</li>
              </ul>
              <div className="space-y-1.5">
                <Label htmlFor="pdel">
                  Type <span className="font-medium text-foreground">{toDelete.name}</span> to
                  confirm
                </Label>
                <Input
                  id="pdel"
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  placeholder={toDelete.name}
                  autoComplete="off"
                />
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setToDelete(null);
                setTyped("");
              }}
              disabled={deleting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => void confirmDelete()}
              disabled={
                !toDelete ||
                !canSubmitProductDeletion({ name: toDelete.name, typed, busy: deleting })
              }
            >
              {deleting ? "Deleting…" : "Delete product"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageSection>
  );
}

/** Only the tools of this shop's type are offered (see Shop type in settings). */
function AdminProductsGate() {
  const { ecosystemDbId } = useSession("admin");
  return (
    <ShopTypeGate ecosystemId={ecosystemDbId} requires="voucher">
      <AdminProducts />
    </ShopTypeGate>
  );
}
