import { createFileRoute } from "@tanstack/react-router";
import { Archive, Check, Gift, ImagePlus, Pencil, Plus, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState, PageSection, StatusBadge } from "@/components/ui-kit";
import { RewardImage } from "@/components/reward-image";
import { ImageCropper } from "@/components/image-cropper";
import type { CropRect } from "@/lib/image-optimize";
import {
  deleteRewardImage,
  uploadRewardImage,
  validateRewardImage,
} from "@/lib/reward-images";
import { useSession } from "@/lib/session";
import { shortDateTime } from "@/lib/wavewallet";
import {
  fetchEcosystemRedemptions,
  fetchRewardProducts,
  redemptionTone,
  reviewRedemption,
  saveRewardProduct,
  setRewardArchived,
  statusLabel,
  type RedemptionRow,
  type RewardProductRow,
} from "@/lib/rewards";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/rewards")({
  head: () => ({
    meta: [
      { title: "Physical Rewards — WaveWallet Admin" },
      {
        name: "description",
        content:
          "Manage points-priced physical rewards, track reserved stock and approve or reject redemptions by code.",
      },
      { property: "og:title", content: "Physical Rewards — WaveWallet Admin" },
      {
        property: "og:description",
        content: "Reward inventory and redemption queue for your shop, verified by code.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AdminRewards,
});

const emptyForm = {
  id: "",
  name: "",
  description: "",
  pointsPrice: "",
  stock: "",
  active: true,
  imagePath: null as string | null,
};

function AdminRewards() {
  const { ecosystemDbId } = useSession("admin");
  const [rewards, setRewards] = useState<RewardProductRow[]>([]);
  const [reds, setReds] = useState<RedemptionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [busy, setBusy] = useState(false);
  const [verify, setVerify] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imageCrop, setImageCrop] = useState<{ image: HTMLImageElement; crop: CropRect } | null>(
    null,
  );
  const [imageCleared, setImageCleared] = useState(false);

  const resetImageState = () => {
    setImageFile(null);
    setImageCrop(null);
    setImageCleared(false);
  };

  const pickImage = (file: File | null) => {
    if (!file) return;
    const problem = validateRewardImage(file);
    if (problem) {
      toast.error(problem);
      return;
    }
    setImageFile(file);
    setImageCrop(null);
    setImageCleared(false);
  };

  const load = useCallback(async () => {
    if (!ecosystemDbId) return;
    setLoading(true);
    try {
      const [r, d] = await Promise.all([
        fetchRewardProducts(ecosystemDbId),
        fetchEcosystemRedemptions(ecosystemDbId),
      ]);
      setRewards(r);
      setReds(d);
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

  const openNew = () => {
    resetImageState();
    setForm(emptyForm);
    setOpen(true);
  };

  const openEdit = (r: RewardProductRow) => {
    setForm({
      id: r.id,
      name: r.name,
      description: r.description,
      pointsPrice: String(r.points_price),
      stock: String(r.stock),
      active: r.active,
      imagePath: r.image_path,
    });
    resetImageState();
    setOpen(true);
  };

  const save = async () => {
    if (!form.name.trim()) {
      toast.error("A reward needs a name");
      return;
    }
    const pts = Number(form.pointsPrice);
    if (!pts || pts <= 0) {
      toast.error("Set a points price greater than zero");
      return;
    }
    setBusy(true);
    try {
      let imagePath: string | null | undefined = undefined;
      if (imageFile) {
        imagePath = await uploadRewardImage(
          ecosystemDbId,
          imageFile,
          imageCrop?.crop,
          imageCrop?.image,
        );
      } else if (imageCleared) {
        imagePath = null;
      }
      await saveRewardProduct({
        ...(form.id ? { id: form.id } : {}),
        ecosystemId: ecosystemDbId,
        name: form.name,
        description: form.description,
        pointsPrice: pts,
        stock: Number(form.stock) || 0,
        active: form.active,
        ...(imagePath === undefined ? {} : { imagePath }),
      });
      // Avoid orphaned files once the new path is safely persisted.
      if (imagePath !== undefined && form.imagePath && form.imagePath !== imagePath) {
        await deleteRewardImage(form.imagePath);
      }
      toast.success(form.id ? "Reward updated" : "Reward created");
      resetImageState();
      setOpen(false);
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const decide = async (r: RedemptionRow, decision: "approve" | "reject") => {
    try {
      await reviewRedemption(r.id, decision);
      toast.success(
        decision === "approve"
          ? "Approved — points deducted and stock decremented"
          : "Rejected — held points released",
      );
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const pending = reds.filter((r) => r.status === "pending");
  const shown = statusFilter === "all" ? reds : reds.filter((r) => r.status === statusFilter);

  return (
    <Tabs defaultValue="catalog">
      <TabsList className="mb-4">
        <TabsTrigger value="catalog">Catalog</TabsTrigger>
        <TabsTrigger value="redemptions">
          Redemptions
          {pending.length ? (
            <span className="ml-1.5 rounded-full bg-destructive px-1.5 text-[10px] text-destructive-foreground">
              {pending.length}
            </span>
          ) : null}
        </TabsTrigger>
      </TabsList>

      <TabsContent value="catalog">
        <PageSection devSlot="rewards.physical-rewards"
          title="Physical rewards"
          description="Name, description, points price, stock and an optional image."
          action={
            <Button size="sm" onClick={openNew}>
              <Plus className="size-4" /> New reward
            </Button>
          }
        >
          {loading ? (
            <EmptyState title="Loading rewards…" />
          ) : rewards.length === 0 ? (
            <EmptyState title="No rewards yet" description="Create your first points-priced reward." />
          ) : (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {rewards.map((r) => (
                <Card key={r.id} className="shadow-[var(--shadow-card)]">
                  <CardContent className="space-y-3">
                    <RewardImage path={r.image_path} alt={r.name} />
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-medium">{r.name}</p>
                        <p className="text-xs text-muted-foreground">{r.description}</p>
                      </div>
                      <Gift className="size-4 shrink-0 text-primary" />
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <StatusBadge tone="points">{r.points_price} pts</StatusBadge>
                      <StatusBadge
                        tone={r.stock === 0 ? "danger" : r.stock <= 5 ? "warning" : "success"}
                      >
                        {r.stock === 0 ? "Out of stock" : `${r.stock} in stock`}
                      </StatusBadge>
                      {r.reserved > 0 ? (
                        <StatusBadge tone="warning">{r.reserved} reserved</StatusBadge>
                      ) : null}
                      {r.archived ? (
                        <StatusBadge tone="muted">archived</StatusBadge>
                      ) : (
                        <StatusBadge tone={r.active ? "brand" : "muted"}>
                          {r.active ? "active" : "hidden"}
                        </StatusBadge>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" className="flex-1" onClick={() => openEdit(r)}>
                        <Pencil className="size-4" /> Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="flex-1"
                        onClick={async () => {
                          try {
                            await setRewardArchived(r.id, !r.archived);
                            await load();
                          } catch (e) {
                            toast.error((e as Error).message);
                          }
                        }}
                      >
                        <Archive className="size-4" /> {r.archived ? "Restore" : "Archive"}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </PageSection>
      </TabsContent>

      <TabsContent value="redemptions">
        <PageSection devSlot="rewards.verify-a-redemption"
          title="Verify a redemption"
          description="Enter or scan the redemption code presented by the customer."
        >
          <Card className="shadow-[var(--shadow-card)]">
            <CardContent className="flex flex-col gap-3 sm:flex-row">
              <Input
                value={verify}
                onChange={(e) => setVerify(e.target.value)}
                placeholder="RDM-0000AAAA"
                className="font-mono"
              />
              <Button
                onClick={() => {
                  const found = reds.find(
                    (r) => r.code.toLowerCase() === verify.trim().toLowerCase(),
                  );
                  if (!found) toast.error("Redemption code not found in this shop");
                  else if (found.status !== "pending")
                    toast.error(`Already ${statusLabel(found.status)} — cannot be claimed twice`);
                  else
                    toast.success(`Valid: ${found.reward_name} for ${found.user_name}`, {
                      description: `${found.points_price} pts held · ${shortDateTime(found.created_at)}`,
                    });
                }}
              >
                Verify
              </Button>
            </CardContent>
          </Card>
        </PageSection>

        <PageSection devSlot="rewards.redemption-history"
          title="Redemption history"
          description="Points stay on hold until approval; rejection releases them."
          action={
            <div className="flex flex-wrap gap-1.5">
              {["all", "pending", "claimed", "rejected", "cancelled"].map((s) => (
                <Button
                  key={s}
                  size="sm"
                  variant={statusFilter === s ? "default" : "outline"}
                  onClick={() => setStatusFilter(s)}
                >
                  {s}
                </Button>
              ))}
            </div>
          }
        >
          {shown.length === 0 ? (
            <EmptyState title="No redemptions here" />
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {shown.map((r) => (
                <Card key={r.id} className="shadow-[var(--shadow-card)]">
                  <CardContent className="space-y-3">
                    {r.reward_image_path ? (
                      <RewardImage path={r.reward_image_path} alt={r.reward_name} />
                    ) : null}
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{r.reward_name}</p>
                        <p className="text-xs text-muted-foreground">
                          {r.user_name} · {shortDateTime(r.created_at)}
                        </p>
                      </div>
                      <StatusBadge tone={redemptionTone(r.status)}>{statusLabel(r.status)}</StatusBadge>
                    </div>
                    <div className="flex items-center justify-between rounded-lg bg-muted px-3 py-2">
                      <span className="font-mono text-xs">{r.code}</span>
                      <StatusBadge tone="points">{r.points_price} pts</StatusBadge>
                    </div>
                    {r.status === "pending" ? (
                      <div className="flex gap-2">
                        <Button size="sm" className="flex-1" onClick={() => void decide(r, "approve")}>
                          <Check className="size-4" /> Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="flex-1 text-destructive"
                          onClick={() => void decide(r, "reject")}
                        >
                          <X className="size-4" /> Reject
                        </Button>
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        {statusLabel(r.status)} by {r.handled_by_name || "—"} ·{" "}
                        {r.handled_at ? shortDateTime(r.handled_at) : "—"}
                      </p>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </PageSection>
      </TabsContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{form.id ? "Edit reward" : "New physical reward"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="rname">Name</Label>
              <Input
                id="rname"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. Branded Cap"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rdesc">Description</Label>
              <Textarea
                id="rdesc"
                rows={2}
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Claim instructions"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="rpts">Points price</Label>
                <Input
                  id="rpts"
                  type="number"
                  value={form.pointsPrice}
                  onChange={(e) => setForm({ ...form, pointsPrice: e.target.value })}
                  placeholder="0"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rstock">Stock</Label>
                <Input
                  id="rstock"
                  type="number"
                  value={form.stock}
                  onChange={(e) => setForm({ ...form, stock: e.target.value })}
                  placeholder="0"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Image (optional)</Label>
              {imageFile ? (
                <ImageCropper file={imageFile} aspect={16 / 10} onChange={setImageCrop} />
              ) : (
                <RewardImage
                  path={imageCleared ? null : form.imagePath}
                  alt={form.name || "Reward"}
                />
              )}
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-10 flex-1"
                  onClick={() => document.getElementById("rimage")?.click()}
                >
                  <ImagePlus className="size-4" />
                  {imageFile || (form.imagePath && !imageCleared) ? "Replace" : "Upload"}
                </Button>
                {imageFile || (form.imagePath && !imageCleared) ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-10 flex-1 text-destructive"
                    onClick={() => {
                      resetImageState();
                      setImageCleared(true);
                    }}
                  >
                    <Trash2 className="size-4" /> Remove
                  </Button>
                ) : null}
              </div>
              <input
                id="rimage"
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                className="hidden"
                onChange={(e) => {
                  pickImage(e.target.files?.[0] ?? null);
                  e.target.value = "";
                }}
              />
              <p className="text-[11px] text-muted-foreground">
                JPG, PNG, WEBP or GIF · up to 8 MB. Saved as a uniform, compressed thumbnail.
              </p>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
              <Label htmlFor="ractive" className="text-sm font-normal">
                Visible to customers
              </Label>
              <Switch
                id="ractive"
                checked={form.active}
                onCheckedChange={(v) => setForm({ ...form, active: v })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void save()} disabled={busy}>
              {busy ? "Saving…" : form.id ? "Save changes" : "Create reward"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Tabs>
  );
}
