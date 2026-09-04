/**
 * Full-image viewer for a community post photo.
 *
 * Opens the signed image at its natural aspect ratio, fitted to the screen.
 * Tapping the image toggles a 2x zoom (scrollable); tapping the dark backdrop
 * or the close button returns to the feed.
 */
import { useEffect, useState } from "react";
import { X, ZoomIn, ZoomOut } from "lucide-react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { cn } from "@/lib/utils";

export function PostImageLightbox({
  url,
  open,
  onOpenChange,
  alt = "Post attachment",
}: {
  url: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  alt?: string;
}) {
  const [zoomed, setZoomed] = useState(false);

  useEffect(() => {
    if (!open) setZoomed(false);
  }, [open]);

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-image-scrim/95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0" />
        <DialogPrimitive.Content
          className="fixed inset-0 z-50 flex items-center justify-center outline-none"
          onClick={() => onOpenChange(false)}
        >
          <DialogPrimitive.Title className="sr-only">Photo</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            Full-size view of the post photo. Tap the photo to zoom, tap outside to close.
          </DialogPrimitive.Description>

          <div
            className={cn(
              "flex max-h-dvh max-w-dvw items-center justify-center",
              zoomed ? "overflow-auto overscroll-contain" : "overflow-hidden",
            )}
            style={{ width: "100dvw", height: "100dvh" }}
          >
            {url ? (
              <img
                src={url}
                alt={alt}
                draggable={false}
                onClick={(e) => {
                  e.stopPropagation();
                  setZoomed((z) => !z);
                }}
                className={cn(
                  "select-none transition-transform duration-200",
                  zoomed
                    ? "max-h-none max-w-none cursor-zoom-out scale-[2] origin-center"
                    : "max-h-[calc(100dvh-2rem)] max-w-[calc(100dvw-1rem)] cursor-zoom-in object-contain",
                )}
              />
            ) : (
              <div className="size-40 animate-pulse rounded-xl bg-muted" />
            )}
          </div>

          <div
            className="absolute right-3 top-3 flex items-center gap-2"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              aria-label={zoomed ? "Fit to screen" : "Zoom in"}
              className="flex size-10 items-center justify-center rounded-full bg-background/80 text-foreground shadow backdrop-blur hover:bg-background"
              onClick={() => setZoomed((z) => !z)}
            >
              {zoomed ? <ZoomOut className="size-5" /> : <ZoomIn className="size-5" />}
            </button>
            <DialogPrimitive.Close
              aria-label="Close photo"
              className="flex size-10 items-center justify-center rounded-full bg-background/80 text-foreground shadow backdrop-blur hover:bg-background"
            >
              <X className="size-5" />
            </DialogPrimitive.Close>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
