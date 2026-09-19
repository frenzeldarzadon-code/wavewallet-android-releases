/**
 * Valid ID pieces for customer loan requests.
 *
 * `LoanIdPicker` — pick or take a photo, preview it, replace it before sending.
 * `LoanIdViewer` — the reviewer's view: a complete, uncropped ID that opens
 *                  full screen.
 *
 * IDs live in a private bucket and are only ever read through a short-lived
 * signed URL, so they are never publicly reachable and never shown anywhere
 * outside the loan request and its review.
 */
import { useEffect, useState } from "react";
import { IdCard, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { loanIdDocumentUrl, validateLoanIdFile } from "@/lib/coin-loans";

const INPUT_ID = "loan-id-file";

export function LoanIdPicker({
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
      <Label htmlFor={INPUT_ID} className="text-sm font-bold text-primary">
        Valid ID (Required)
      </Label>
      <input
        id={INPUT_ID}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        capture="environment"
        className="hidden"
        disabled={disabled}
        onChange={(e) => {
          const picked = e.target.files?.[0] ?? null;
          e.target.value = "";
          if (!picked) return;
          const problem = validateLoanIdFile(picked);
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
            alt="The valid ID you selected"
            className="max-h-64 w-full rounded-md object-contain"
          />
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={disabled}
              onClick={() => document.getElementById(INPUT_ID)?.click()}
            >
              Replace ID
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
          className="h-12 w-full justify-center text-sm font-bold"
          disabled={disabled}
          onClick={() => document.getElementById(INPUT_ID)?.click()}
        >
          <IdCard className="mr-2 size-4" /> Upload or take a photo of your ID
        </Button>
      )}
      <p className="text-[11px] text-muted-foreground">
        JPG, PNG or WEBP up to 5 MB. Only you and the platform owner reviewing your request can see
        it.
      </p>
    </div>
  );
}

export function LoanIdViewer({
  path,
  who,
  label = "View valid ID",
}: {
  path?: string | null;
  who?: string;
  label?: string;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let active = true;
    if (!path) {
      setUrl(null);
      return;
    }
    setLoading(true);
    void loanIdDocumentUrl(path)
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
    <div className="mt-2 space-y-2 rounded-lg border p-2">
      {url ? (
        <img
          src={url}
          alt={who ? `Valid ID submitted by ${who}` : "Valid ID submitted with this loan request"}
          className="max-h-72 w-full rounded-md object-contain"
        />
      ) : (
        <p className="text-xs text-muted-foreground">
          {loading ? "Loading the ID…" : "This ID could not be loaded."}
        </p>
      )}
      <Dialog>
        <DialogTrigger asChild>
          <Button type="button" size="sm" variant="outline">
            {loading ? (
              <Loader2 className="mr-1 size-3.5 animate-spin" />
            ) : (
              <IdCard className="mr-1 size-3.5" />
            )}
            {label}
          </Button>
        </DialogTrigger>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{who ? `Valid ID — ${who}` : "Valid ID"}</DialogTitle>
          </DialogHeader>
          {url ? (
            <img
              src={url}
              alt={who ? `Full valid ID submitted by ${who}` : "Full valid ID"}
              className="max-h-[80vh] w-full object-contain"
            />
          ) : (
            <p className="text-xs text-muted-foreground">This ID could not be loaded.</p>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
