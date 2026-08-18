/**
 * Post-purchase voucher delivery.
 *
 * Each issued code is rendered as its OWN premium image, with its own download
 * and share action. "Download all" saves separate files — never one combined
 * sheet. Copy code stays available as a plain-text fallback.
 *
 * Presentation only: the codes shown here are exactly what the purchase RPC
 * returned; nothing in this component can issue, price or reprice a voucher.
 */
import { useEffect, useState } from "react";
import { Copy, Download, Share2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  downloadBlob,
  renderVoucherImage,
  shareVoucherImage,
  voucherFileName,
  type VoucherImageData,
} from "@/lib/voucher-image";

interface Rendered {
  data: VoucherImageData;
  blob: Blob;
  url: string;
  fileName: string;
}

export function IssuedVouchersDialog({
  vouchers,
  summary,
  pointsEarned,
  onClose,
}: {
  vouchers: VoucherImageData[];
  summary: string;
  pointsEarned: number;
  onClose: () => void;
}) {
  const [images, setImages] = useState<Rendered[]>([]);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const urls: string[] = [];
    setImages([]);
    setFailed(false);
    if (vouchers.length === 0) return;
    void (async () => {
      try {
        const out: Rendered[] = [];
        for (const data of vouchers) {
          const blob = await renderVoucherImage(data);
          const url = URL.createObjectURL(blob);
          urls.push(url);
          out.push({ data, blob, url, fileName: voucherFileName(data) });
        }
        if (!cancelled) setImages(out);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
      urls.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [vouchers]);

  const open = vouchers.length > 0;
  const many = vouchers.length > 1;

  const downloadAll = () => {
    // Separate files, saved one after another — never merged.
    images.forEach((img, i) => setTimeout(() => downloadBlob(img.blob, img.fileName), i * 350));
    toast.success(`Saving ${images.length} voucher image${many ? "s" : ""}`);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{many ? "Vouchers issued" : "Voucher issued"}</DialogTitle>
          <DialogDescription className="break-words">{summary}</DialogDescription>
        </DialogHeader>

        {pointsEarned > 0 ? (
          <p className="rounded-lg bg-points-soft px-3 py-2 text-center text-xs font-medium text-points">
            +{pointsEarned} points earned
          </p>
        ) : null}

        <div className="space-y-4">
          {vouchers.map((v, i) => {
            const img = images[i];
            return (
              <div key={v.code} className="space-y-2 rounded-2xl border border-border p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Voucher {v.index} of {v.total}
                    </p>
                    <p className="break-all font-mono text-lg font-semibold tracking-widest text-success">
                      {v.code}
                    </p>
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={`Copy code ${v.code}`}
                    onClick={() => {
                      void navigator.clipboard?.writeText(v.code);
                      toast.success("Code copied");
                    }}
                  >
                    <Copy className="size-4" />
                  </Button>
                </div>

                {img ? (
                  <img
                    src={img.url}
                    alt={`${v.productName} voucher ${v.index} of ${v.total}`}
                    className="w-full rounded-xl border border-border"
                    loading="lazy"
                  />
                ) : (
                  <div className="flex h-40 items-center justify-center rounded-xl border border-dashed border-border text-xs text-muted-foreground">
                    {failed ? "Image preview unavailable" : "Preparing voucher image…"}
                  </div>
                )}

                <div className="grid grid-cols-2 gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!img}
                    onClick={() => img && downloadBlob(img.blob, img.fileName)}
                  >
                    <Download className="size-4" /> Download
                  </Button>
                  <Button
                    size="sm"
                    disabled={!img}
                    onClick={() => {
                      if (!img) return;
                      void shareVoucherImage(img.blob, img.fileName, v.productName).catch(
                        () => undefined,
                      );
                    }}
                  >
                    <Share2 className="size-4" /> Share
                  </Button>
                </div>
              </div>
            );
          })}
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          {many ? (
            <Button variant="outline" disabled={images.length === 0} onClick={downloadAll}>
              <Download className="size-4" /> Download all ({vouchers.length} files)
            </Button>
          ) : (
            <span />
          )}
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
