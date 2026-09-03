import { Camera, ImageIcon, Loader2, Store, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  ImageUploadCropDialog,
  type ConfirmedImageCrop,
} from "@/components/image-upload-crop-dialog";
import { RetailImage } from "@/components/retail/retail-image";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PageSection } from "@/components/ui-kit";
import {
  DEFAULT_STORE_SETTINGS,
  fetchStoreSettings,
  removeRetailImages,
  saveShopBranding,
  uploadStorefrontImage,
  type StorefrontSettings,
} from "@/lib/retail";

type ImageKind = "logo" | "cover";
type PendingCrop = { kind: ImageKind; file: File } | null;

const branding = (settings = DEFAULT_STORE_SETTINGS): StorefrontSettings => ({
  logoPath: settings.logoPath,
  coverPath: settings.coverPath,
  acceptingOrders: settings.acceptingOrders,
  pausedNote: settings.pausedNote,
  theme: settings.theme,
});

export function ShopBrandingCard({
  ecosystemId,
  shopName,
}: {
  ecosystemId: string | null;
  shopName: string;
}) {
  const [saved, setSaved] = useState<StorefrontSettings>(branding());
  const [form, setForm] = useState<StorefrontSettings>(branding());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [pendingCrop, setPendingCrop] = useState<PendingCrop>(null);
  const [pendingUploads, setPendingUploads] = useState<string[]>([]);
  const logoInput = useRef<HTMLInputElement>(null);
  const coverInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    if (!ecosystemId) return;
    setLoading(true);
    try {
      const next = branding(await fetchStoreSettings(ecosystemId));
      setSaved(next);
      setForm(next);
    } catch (error) {
      toast.error("Could not load shop images", { description: (error as Error).message });
    } finally {
      setLoading(false);
    }
  }, [ecosystemId]);

  useEffect(() => void load(), [load]);
  if (!ecosystemId) return null;

  const dirty = form.logoPath !== saved.logoPath || form.coverPath !== saved.coverPath;

  const choose = (kind: ImageKind, file?: File) => {
    if (file) setPendingCrop({ kind, file });
  };

  const confirmCrop = async ({ file, crop, image }: ConfirmedImageCrop) => {
    if (!pendingCrop) return;
    const kind = pendingCrop.kind;
    setBusy(true);
    try {
      const path = await uploadStorefrontImage(ecosystemId, kind, file, crop, image);
      const replacedPending = kind === "logo" ? form.logoPath : form.coverPath;
      if (replacedPending && pendingUploads.includes(replacedPending)) {
        await removeRetailImages(ecosystemId, [replacedPending]);
        setPendingUploads((paths) => paths.filter((candidate) => candidate !== replacedPending));
      }
      setPendingUploads((paths) => [...paths, path]);
      setForm((current) =>
        kind === "logo" ? { ...current, logoPath: path } : { ...current, coverPath: path },
      );
      setPendingCrop(null);
      toast.success(`${kind === "logo" ? "Logo" : "Cover"} crop ready — save to apply.`);
    } catch (error) {
      toast.error("Could not prepare image", { description: (error as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const discard = async () => {
    setBusy(true);
    try {
      await removeRetailImages(ecosystemId, pendingUploads);
      setPendingUploads([]);
      setForm(saved);
    } catch (error) {
      toast.error("Could not discard image changes", { description: (error as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    setBusy(true);
    try {
      await saveShopBranding(ecosystemId, form, saved);
      setSaved(form);
      setPendingUploads([]);
      toast.success("Shop images saved", {
        description: "Your branding is now available across Universe discovery and storefronts.",
      });
    } catch (error) {
      toast.error("Could not save shop images", { description: (error as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const remove = async (kind: ImageKind) => {
    const path = kind === "logo" ? form.logoPath : form.coverPath;
    if (path && pendingUploads.includes(path)) {
      try {
        await removeRetailImages(ecosystemId, [path]);
        setPendingUploads((paths) => paths.filter((candidate) => candidate !== path));
      } catch (error) {
        toast.error("Could not remove pending image", { description: (error as Error).message });
        return;
      }
    }
    setForm((current) =>
      kind === "logo" ? { ...current, logoPath: null } : { ...current, coverPath: null },
    );
  };

  return (
    <PageSection
      devSlot="settings.shop-branding"
      title="Shop images & branding"
      description="Your real shop images appear in Featured Shops, Top Selling Shops, shop profiles and storefronts."
    >
      <Card className="overflow-hidden shadow-[var(--shadow-card)]">
        <CardContent className="space-y-4 p-4 sm:p-5">
          {loading ? (
            <div className="flex min-h-40 items-center justify-center text-sm text-muted-foreground">
              <Loader2 className="mr-2 size-4 animate-spin" /> Loading shop images…
            </div>
          ) : (
            <>
              <div className="overflow-hidden rounded-xl border border-border bg-card">
                <div className="relative">
                  <RetailImage path={form.coverPath} alt={`${shopName} cover`} className="aspect-[16/7]" />
                  <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 bg-image-scrim p-3">
                    <div className="min-w-0 text-primary-foreground">
                      <p className="text-sm font-semibold">Shop cover</p>
                      <p className="text-[11px] opacity-90">Wide header and marketplace discovery image</p>
                    </div>
                    <Button size="sm" variant="secondary" onClick={() => coverInput.current?.click()}>
                      <Camera className="size-4" /> {form.coverPath ? "Change" : "Add cover"}
                    </Button>
                  </div>
                </div>
                <div className="flex items-center gap-3 p-3 sm:p-4">
                  <RetailImage path={form.logoPath} alt={`${shopName} logo`} className="size-20 shrink-0 rounded-xl aspect-square" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{shopName}</p>
                    <p className="text-[11px] text-muted-foreground">Square logo used for shop identity and compact cards</p>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => logoInput.current?.click()}>
                    <Camera className="size-4" /> {form.logoPath ? "Change" : "Add logo"}
                  </Button>
                </div>
              </div>

              <input ref={logoInput} type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="hidden" onChange={(event) => { choose("logo", event.target.files?.[0]); event.target.value = ""; }} />
              <input ref={coverInput} type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="hidden" onChange={(event) => { choose("cover", event.target.files?.[0]); event.target.value = ""; }} />

              <div className="grid gap-2 sm:grid-cols-2">
                <Button variant="outline" disabled={!form.logoPath || busy} onClick={() => void remove("logo")}>
                  <Trash2 className="size-4" /> Remove logo
                </Button>
                <Button variant="outline" disabled={!form.coverPath || busy} onClick={() => void remove("cover")}>
                  <Trash2 className="size-4" /> Remove cover
                </Button>
              </div>
              {!form.logoPath && !form.coverPath ? (
                <div className="flex items-center gap-3 rounded-xl border border-dashed border-border bg-muted/40 p-3 text-sm text-muted-foreground">
                  <ImageIcon className="size-5 text-primary" /> Designed fallbacks remain visible until you add real shop images.
                </div>
              ) : null}
              <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                <Button variant="ghost" disabled={!dirty || busy} onClick={() => void discard()}>Cancel changes</Button>
                <Button disabled={!dirty || busy} onClick={() => void save()}>
                  {busy ? <Loader2 className="size-4 animate-spin" /> : <Store className="size-4" />} Save shop images
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <ImageUploadCropDialog
        file={pendingCrop?.file ?? null}
        aspect={pendingCrop?.kind === "logo" ? 1 : 2}
        circular={pendingCrop?.kind === "logo"}
        title={pendingCrop?.kind === "logo" ? "Crop shop logo" : "Crop shop cover"}
        description="Drag to reposition and zoom. The result preview is exactly what will be saved."
        resultLabel={pendingCrop?.kind === "logo" ? "Final shop logo" : "Final shop cover"}
        busy={busy}
        onCancel={() => setPendingCrop(null)}
        onConfirm={(value) => void confirmCrop(value)}
      />
    </PageSection>
  );
}