/**
 * Post-purchase voucher delivery.
 *
 * The success screen shows the issued CODES only — no voucher pictures are
 * rendered until the buyer picks an action. Download Picture and Share render
 * images on demand (one file per code, never a combined sheet); Print opens the
 * existing 2in x 1.5in voucher template flow for this exact transaction.
 *
 * Presentation only: the codes shown here are exactly what the purchase RPC
 * returned; nothing in this component can issue, price or reprice a voucher.
 */
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Copy, Download, Printer, Share2 } from "lucide-react";
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

export function IssuedVouchersDialog({
  vouchers,
  summary,
  pointsEarned,
  saleId,
  historyTo,
  onClose,
}: {
  vouchers: VoucherImageData[];
  summary: string;
  pointsEarned: number;
  /** Voucher sale this purchase created — used only to open the print flow. */
  saleId?: string | null;
  /** Where these vouchers can be retrieved again later (existing history page). */
  historyTo?: "/universe/wallet" | "/app/history" | "/reseller/history";
  onClose: () => void;
}) {
  const [busy, setBusy] = useState<null | "download" | "share">(null);
  const open = vouchers.length > 0;
  const many = vouchers.length > 1;

  const downloadAll = async () => {
    setBusy("download");
    let saved = 0;
    let blocked = 0;
    try {
      for (const data of vouchers) {
        try {
          const blob = await renderVoucherImage(data);
          await downloadBlob(blob, voucherFileName(data));
          saved += 1;
        } catch {
          blocked += 1;
        }
        // Space the saves out; browsers throttle rapid multi-file downloads.
        if (vouchers.length > 1) await new Promise((r) => setTimeout(r, 400));
      }
    } finally {
      setBusy(null);
    }
    if (blocked === 0)
      toast.success(`Saved ${saved} voucher image${saved > 1 ? "s" : ""}`);
    else
      toast.error(`${blocked} of ${vouchers.length} downloads were blocked`, {
        description: "Try again, or use Share to send the remaining vouchers.",
      });
  };

  const shareAll = async () => {
    setBusy("share");
    let shared = 0;
    let downloaded = 0;
    try {
      for (const data of vouchers) {
        const blob = await renderVoucherImage(data);
        const outcome = await shareVoucherImage(
          blob,
          voucherFileName(data),
          data.productName,
        );
        if (outcome === "shared") shared += 1;
        else if (outcome === "downloaded") downloaded += 1;
        else break; // User dismissed the share sheet.
      }
      if (shared > 0) toast.success(`Shared ${shared} voucher${shared > 1 ? "s" : ""}`);
      else if (downloaded > 0)
        toast.success("Sharing isn't available here — image saved instead");
    } catch (e) {
      toast.error("Could not share the image", {
        description: (e as Error).message || "Try Download Picture instead.",
      });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{many ? "Vouchers issued" : "Voucher issued"}</DialogTitle>
          <DialogDescription className="break-words">{summary}</DialogDescription>
        </DialogHeader>

        {pointsEarned > 0 ? (
          <p className="rounded-lg bg-success-soft px-3 py-2 text-center text-xs font-medium text-points">
            +{pointsEarned} points earned
          </p>
        ) : null}

        <div className="space-y-2">
          {vouchers.map((v) => (
            <div
              key={v.code}
              className="flex items-start justify-between gap-2 rounded-2xl border border-border p-3"
            >
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
          ))}
        </div>

        {/* On-demand actions: nothing is rendered until one is chosen. */}
        <div className="grid gap-2 sm:grid-cols-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy !== null}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              void downloadAll();
            }}
          >
            <Download className="size-4" />
            {busy === "download" ? "Preparing…" : "Download Picture"}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy !== null}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              void shareAll();
            }}
          >
            <Share2 className="size-4" />
            {busy === "share" ? "Preparing…" : "Share"}
          </Button>
          <Button asChild variant="outline" size="sm" disabled={!saleId}>
            {saleId ? (
              <Link to="/print/vouchers/$saleId" params={{ saleId }} onClick={onClose}>
                <Printer className="size-4" /> Print
              </Link>
            ) : (
              <span>
                <Printer className="size-4" /> Print
              </span>
            )}
          </Button>
        </div>

        {historyTo ? (
          <p className="text-center text-xs text-muted-foreground">
            These codes are saved to your purchase history.{" "}
            <Link to={historyTo} onClick={onClose} className="font-medium text-primary underline">
              Open Wallet Center
            </Link>
          </p>
        ) : null}

        <DialogFooter>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
