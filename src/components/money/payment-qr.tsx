/**
 * Receiving-account QR code: view large, or download to the phone.
 *
 * The image lives in a private bucket; every read goes through a short-lived
 * signed URL, so a shop's QR codes are never publicly addressable.
 */
import { useEffect, useState } from "react";
import { Download, Loader2, QrCode } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { downloadPaymentQr, paymentQrUrl } from "@/lib/payment-accounts";

export function PaymentQrPreview({
  path,
  name,
  compact,
}: {
  path?: string | null;
  name: string;
  compact?: boolean;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    if (!path) {
      setUrl(null);
      return;
    }
    void paymentQrUrl(path).then((u) => {
      if (alive) setUrl(u);
    });
    return () => {
      alive = false;
    };
  }, [path]);

  if (!path) return null;

  const save = async () => {
    setBusy(true);
    try {
      await downloadPaymentQr(path, name);
      toast.success("QR code saved to your device.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not download that QR code.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-2">
      {url ? (
        <img
          src={url}
          alt={`${name} payment QR code`}
          className={compact ? "mx-auto h-28 w-28 rounded-md object-contain" : "mx-auto max-h-48 w-full rounded-md object-contain"}
        />
      ) : (
        <div className="flex h-28 items-center justify-center text-muted-foreground">
          <QrCode className="size-6" />
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Dialog>
          <DialogTrigger asChild>
            <Button type="button" size="sm" variant="outline" className="flex-1">
              <QrCode className="size-4" /> View QR
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{name} — scan to pay</DialogTitle>
            </DialogHeader>
            {url ? (
              <img src={url} alt={`${name} payment QR code`} className="w-full rounded-lg object-contain" />
            ) : (
              <p className="text-sm text-muted-foreground">Loading QR code…</p>
            )}
            <Button type="button" onClick={() => void save()} disabled={busy}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />} Download QR
            </Button>
          </DialogContent>
        </Dialog>
        <Button type="button" size="sm" className="flex-1" onClick={() => void save()} disabled={busy}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />} Download QR
        </Button>
      </div>
    </div>
  );
}
