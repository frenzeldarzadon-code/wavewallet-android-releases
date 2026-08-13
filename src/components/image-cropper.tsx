import { Loader2, ZoomIn } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";
import { coverCrop, loadImage, type CropRect } from "@/lib/image-optimize";

/**
 * Touch-friendly crop / reposition surface.
 *
 * The user drags the photo and pinches the zoom slider; we translate that into
 * a crop rectangle on the original bitmap, which the optimiser then resizes and
 * compresses. Nothing full-resolution is ever uploaded.
 */
export function ImageCropper({
  file,
  aspect,
  circular = false,
  onChange,
}: {
  file: File;
  /** width / height of the output. */
  aspect: number;
  circular?: boolean;
  onChange: (value: { image: HTMLImageElement; crop: CropRect } | null) => void;
}) {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const frame = useRef<HTMLDivElement | null>(null);
  const drag = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);

  useEffect(() => {
    let active = true;
    setImage(null);
    setError(null);
    setZoom(1);
    setPan({ x: 0, y: 0 });
    void loadImage(file)
      .then((img) => {
        if (active) setImage(img);
      })
      .catch((e: Error) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [file]);

  useEffect(() => {
    if (!image) {
      onChange(null);
      return;
    }
    onChange({
      image,
      crop: coverCrop(image.naturalWidth, image.naturalHeight, aspect, zoom, pan.x, pan.y),
    });
    // onChange identity is owned by the parent; crop only depends on these.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [image, aspect, zoom, pan.x, pan.y]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (!image) return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const start = drag.current;
    const box = frame.current;
    if (!start || !box) return;
    const rect = box.getBoundingClientRect();
    const dx = (e.clientX - start.x) / Math.max(rect.width, 1);
    const dy = (e.clientY - start.y) / Math.max(rect.height, 1);
    const clamp = (v: number) => Math.min(Math.max(v, -1), 1);
    setPan({ x: clamp(start.panX - dx * 2), y: clamp(start.panY - dy * 2) });
  };

  const endDrag = () => {
    drag.current = null;
  };

  const previewShift = (value: number) => `${(-value * (zoom - 1) * 50) / zoom}%`;

  return (
    <div className="space-y-3">
      <div
        ref={frame}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        className={cn(
          "relative w-full touch-none select-none overflow-hidden border border-border bg-muted",
          circular ? "mx-auto aspect-square max-w-56 rounded-full" : "aspect-16/10 rounded-lg",
          image ? "cursor-grab active:cursor-grabbing" : "",
        )}
        style={{ aspectRatio: circular ? "1 / 1" : `${aspect}` }}
      >
        {image ? (
          <img
            src={image.src}
            alt="Crop preview"
            draggable={false}
            className="pointer-events-none absolute inset-0 size-full object-cover"
            style={{
              transform: `scale(${zoom}) translate(${previewShift(pan.x)}, ${previewShift(pan.y)})`,
            }}
          />
        ) : (
          <div className="flex size-full items-center justify-center">
            {error ? (
              <span className="px-4 text-center text-xs text-destructive">{error}</span>
            ) : (
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            )}
          </div>
        )}
      </div>

      <div className="flex items-center gap-3">
        <ZoomIn className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <Slider
          value={[zoom]}
          min={1}
          max={4}
          step={0.05}
          onValueChange={([v]) => setZoom(v ?? 1)}
          aria-label="Zoom"
          disabled={!image}
        />
      </div>
      <p className="text-xs text-muted-foreground">Drag the photo to reposition, slide to zoom.</p>
    </div>
  );
}
