import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { ImageCropper } from "@/components/image-cropper";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { CropRect } from "@/lib/image-optimize";

export interface ConfirmedImageCrop {
  file: File;
  image: HTMLImageElement;
  crop: CropRect;
}

/** Shared confirmation step used by shop branding and Retail product photos. */
export function ImageUploadCropDialog({
  file,
  aspect,
  circular = false,
  title,
  description,
  resultLabel,
  busy = false,
  onCancel,
  onConfirm,
}: {
  file: File | null;
  aspect: number;
  circular?: boolean;
  title: string;
  description: string;
  resultLabel: string;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: (value: ConfirmedImageCrop) => void;
}) {
  const [selection, setSelection] = useState<{
    image: HTMLImageElement;
    crop: CropRect;
  } | null>(null);

  useEffect(() => setSelection(null), [file]);

  return (
    <Dialog open={file !== null} onOpenChange={(open) => !open && !busy && onCancel()}>
      <DialogContent className="max-h-[92dvh] w-[calc(100%-1.5rem)] max-w-xl overflow-y-auto rounded-2xl p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {file ? (
          <ImageCropper
            file={file}
            aspect={aspect}
            circular={circular}
            resultLabel={resultLabel}
            onChange={setSelection}
          />
        ) : null}
        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" disabled={busy} onClick={onCancel}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={busy || !selection || !file}
            onClick={() => {
              if (!selection || !file) return;
              onConfirm({ file, ...selection });
            }}
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : null}
            Use this crop
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}