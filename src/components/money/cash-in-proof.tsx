/**
 * Payment screenshot pieces for Cash In.
 *
 * `CashInProofPicker` — mobile-friendly picker with preview, replace and remove.
 * `CashInProofViewer` — signed-URL thumbnail + full view for the review queue.
 *
 * Screenshots live in a private bucket; every read goes through a short-lived
 * signed URL, so nothing is ever exposed publicly.
 */
import { useEffect, useState } from "react";
import { ImageIcon, Loader2, Paperclip, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cashInProofUrl, validateCashInProof } from "@/lib/wallet-money";

export function CashInProofPicker({
  file,
  onPick,
  disabled,
  onError,
}: {
  file: File | null;
  onPick: (file: File | null) => void;
  disabled?: boolean;
  onError: (message: string) => void;
}) {
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => {
    if (!file) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  return (
    <div className="space-y-1.5">
      <Label htmlFor="ci-proof">Payment screenshot (required)</Label>
      <input
        id="ci-proof"
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        disabled={disabled}
        onChange={(e) => {
          const picked = e.target.files?.[0] ?? null;
          e.target.value = "";
          if (!picked) return;
          const problem = validateCashInProof(picked);
          if (problem) {
            onError(problem);
            return;
          }
          onPick(picked);
        }}
      />
      {preview ? (
        <div className="space-y-2 rounded-lg border border-border p-2">
          <img
            src={preview}
            alt="Selected payment screenshot preview"
            className="max-h-56 w-full rounded-md object-contain"
          />
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={disabled}
              onClick={() => document.getElementById("ci-proof")?.click()}
            >
              Replace
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={disabled}
              onClick={() => onPick(null)}
            >
              <X className="mr-1 size-3.5" /> Remove
            </Button>
          </div>
        </div>
      ) : (
        <Button
          type="button"
          variant="outline"
          className="w-full justify-start"
          disabled={disabled}
          onClick={() => document.getElementById("ci-proof")?.click()}
        >
          <Paperclip className="mr-2 size-4" /> Upload payment screenshot
        </Button>
      )}
      <p className="text-[11px] text-muted-foreground">
        JPG, PNG or WEBP up to 5 MB. Only you and the platform owner can see it.
      </p>
    </div>
  );
}

export function CashInProofViewer({ path }: { path?: string | null }) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let active = true;
    if (!path) {
      setUrl(null);
      return;
    }
    setLoading(true);
    void cashInProofUrl(path)
      .then((u) => {
        if (active) setUrl(u);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [path]);

  if (!path) return null;

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button type="button" size="sm" variant="outline" className="mt-2">
          {loading ? <Loader2 className="mr-1 size-3.5 animate-spin" /> : <ImageIcon className="mr-1 size-3.5" />}
          View payment screenshot
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Payment screenshot</DialogTitle>
        </DialogHeader>
        {url ? (
          <img src={url} alt="Payment screenshot submitted with this cash in request" className="w-full rounded-md" />
        ) : (
          <p className="text-xs text-muted-foreground">
            {loading ? "Loading the screenshot…" : "This screenshot could not be loaded."}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
