import { Loader2, RotateCcw, ZoomIn, ZoomOut } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";
import { coverCrop, loadImage, type CropRect } from "@/lib/image-optimize";

const MIN_ZOOM = 1;
const MAX_ZOOM = 4;
const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
const clampPan = (v: number) => clamp(v, -1, 1);

/**
 * Places the real bitmap so that `crop` fills the box it is rendered in. The
 * same math drives the editing stage and the "saved result" preview, so what
 * the user sees is exactly the rectangle handed to the optimiser.
 */
export function cropPlacementStyle(
  natural: { width: number; height: number },
  crop: CropRect,
): React.CSSProperties {
  return {
    position: "absolute",
    left: `${(-crop.x / crop.width) * 100}%`,
    top: `${(-crop.y / crop.height) * 100}%`,
    width: `${(natural.width / crop.width) * 100}%`,
    height: `${(natural.height / crop.height) * 100}%`,
    maxWidth: "none",
    maxHeight: "none",
  };
}

/** A read-only rendering of `crop` in the destination shape. */
export function CropResultPreview({
  image,
  src,
  crop,
  aspect,
  circular = false,
  className,
}: {
  image: HTMLImageElement;
  /** Display URL for the bitmap (defaults to image.src). */
  src?: string;
  crop: CropRect;
  aspect: number;
  circular?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "relative overflow-hidden border border-border bg-card",
        circular ? "rounded-full" : "rounded-lg",
        className,
      )}
      style={{ aspectRatio: circular ? "1 / 1" : `${aspect}` }}
      aria-hidden
    >
      <img
        src={src ?? image.src}
        alt=""
        draggable={false}
        className="pointer-events-none select-none"
        style={cropPlacementStyle(
          { width: image.naturalWidth, height: image.naturalHeight },
          crop,
        )}
      />
    </div>
  );
}

/**
 * Touch-friendly crop / reposition surface.
 *
 * The user drags the photo, pinches, scrolls or slides to zoom; we translate
 * that into a crop rectangle on the original bitmap, which the optimiser then
 * resizes and compresses. Nothing full-resolution is ever uploaded.
 *
 * The real photo is always visible: the bright window is exactly what will be
 * saved, the dimmed area around it is the part that will be cut away.
 */
export function ImageCropper({
  file,
  aspect,
  circular = false,
  onChange,
  resultLabel,
}: {
  file: File;
  /** width / height of the output. */
  aspect: number;
  circular?: boolean;
  onChange: (value: { image: HTMLImageElement; crop: CropRect } | null) => void;
  /** Caption under the "saved result" preview, e.g. "Profile photo". */
  resultLabel?: string;
}) {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  // `loadImage` revokes its object URL once decoded, so the bitmap needs its
  // own URL for as long as the editor shows it.
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const stage = useRef<HTMLDivElement | null>(null);
  const frame = useRef<HTMLDivElement | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const drag = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const pinch = useRef<{ distance: number; zoom: number } | null>(null);
  const live = useRef({ zoom, pan, image, aspect });
  live.current = { zoom, pan, image, aspect };

  useEffect(() => {
    let active = true;
    setImage(null);
    setError(null);
    setZoom(1);
    setPan({ x: 0, y: 0 });
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    void loadImage(file)
      .then((img) => {
        if (active) setImage(img);
      })
      .catch((e: Error) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
      URL.revokeObjectURL(url);
    };
  }, [file]);

  const crop = useMemo(
    () =>
      image
        ? coverCrop(image.naturalWidth, image.naturalHeight, aspect, zoom, pan.x, pan.y)
        : null,
    [image, aspect, zoom, pan.x, pan.y],
  );

  useEffect(() => {
    if (!image || !crop) {
      onChange(null);
      return;
    }
    onChange({ image, crop });
    // onChange identity is owned by the parent; crop only depends on these.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [image, crop]);

  // Scroll-wheel / trackpad-pinch zoom. React's onWheel is passive, so the
  // page would scroll behind the stage; attach a native non-passive listener.
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!live.current.image) return;
      e.preventDefault();
      const dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 100 : 1);
      setZoom((z) => clamp(z * Math.exp(-dy * 0.0015), MIN_ZOOM, MAX_ZOOM));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  /** Converts a finger movement in frame pixels into the -1..1 pan space, 1:1 with the photo. */
  const panDelta = (dxPx: number, dyPx: number) => {
    const img = live.current.image;
    const box = frame.current;
    if (!img || !box) return { x: 0, y: 0 };
    const rect = box.getBoundingClientRect();
    const c = coverCrop(
      img.naturalWidth,
      img.naturalHeight,
      live.current.aspect,
      live.current.zoom,
      0,
      0,
    );
    const freeX = img.naturalWidth - c.width;
    const freeY = img.naturalHeight - c.height;
    const scale = Math.max(rect.width, 1) / c.width; // screen px per source px
    return {
      x: freeX > 0.5 ? (dxPx / scale) / (freeX / 2) : 0,
      y: freeY > 0.5 ? (dyPx / scale) / (freeY / 2) : 0,
    };
  };

  const distance = () => {
    const [a, b] = [...pointers.current.values()];
    if (!a || !b) return 0;
    return Math.hypot(a.x - b.x, a.y - b.y);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (!image) return;
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      drag.current = null;
      pinch.current = { distance: distance(), zoom: live.current.zoom };
    } else {
      drag.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch.current && pointers.current.size >= 2) {
      const d = distance();
      if (pinch.current.distance > 0 && d > 0) {
        setZoom(clamp(pinch.current.zoom * (d / pinch.current.distance), MIN_ZOOM, MAX_ZOOM));
      }
      return;
    }
    const start = drag.current;
    if (!start) return;
    const d = panDelta(e.clientX - start.x, e.clientY - start.y);
    setPan({ x: clampPan(start.panX - d.x), y: clampPan(start.panY - d.y) });
  };

  const endPointer = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    if (pointers.current.size === 1) {
      const [rest] = [...pointers.current.values()];
      drag.current = rest ? { x: rest.x, y: rest.y, panX: pan.x, panY: pan.y } : null;
    } else {
      drag.current = null;
    }
  };

  const reset = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  const natural = image ? { width: image.naturalWidth, height: image.naturalHeight } : null;
  const shapeLabel = circular ? "circle" : "frame";

  return (
    <div className="space-y-3">
      <div
        ref={stage}
        role="img"
        aria-label={
          image
            ? `Crop editor. Drag to reposition, pinch or scroll to zoom. The bright ${shapeLabel} is what will be saved.`
            : "Loading photo"
        }
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
        className={cn(
          "relative w-full touch-none select-none overflow-hidden rounded-2xl border border-border",
          "bg-[radial-gradient(ellipse_at_top,color-mix(in_oklch,var(--primary)_28%,var(--foreground))_0%,var(--foreground)_70%)]",
          circular ? "px-8 py-5 sm:py-6" : "px-5 py-4 sm:px-7 sm:py-5",
          image ? "cursor-grab active:cursor-grabbing" : "",
        )}
      >
        {image && crop && natural ? (
          <div
            ref={frame}
            className={cn("relative mx-auto w-full", circular ? "max-w-56 sm:max-w-64" : "")}
            style={{ aspectRatio: circular ? "1 / 1" : `${aspect}` }}
          >
            {/* The real photo, placed so the crop rectangle fills this frame. */}
            <img
              src={previewUrl ?? image.src}
              alt="Your photo in the crop editor"
              draggable={false}
              className="pointer-events-none select-none"
              style={cropPlacementStyle(natural, crop)}
            />
            {/* Dim everything outside the saved region and outline the boundary. */}
            <div
              aria-hidden
              className={cn(
                "pointer-events-none absolute inset-0 ring-2 ring-primary-foreground/90",
                "shadow-[0_0_0_200vmax_color-mix(in_oklch,var(--foreground)_62%,transparent)]",
                circular ? "rounded-full" : "rounded-md",
              )}
            />
            {!circular ? (
              <div aria-hidden className="pointer-events-none absolute inset-0 opacity-50">
                <div className="absolute inset-y-0 left-1/3 w-px bg-primary-foreground/70" />
                <div className="absolute inset-y-0 left-2/3 w-px bg-primary-foreground/70" />
                <div className="absolute inset-x-0 top-1/3 h-px bg-primary-foreground/70" />
                <div className="absolute inset-x-0 top-2/3 h-px bg-primary-foreground/70" />
              </div>
            ) : null}
          </div>
        ) : (
          <div
            className="flex w-full items-center justify-center"
            style={{ aspectRatio: circular ? "16 / 9" : `${aspect}` }}
          >
            {error ? (
              <span className="px-4 text-center text-xs text-destructive-foreground">{error}</span>
            ) : (
              <Loader2 className="size-5 animate-spin text-primary-foreground/80" />
            )}
          </div>
        )}
        {image ? (
          <span className="pointer-events-none absolute bottom-2 right-3 rounded-full bg-foreground/60 px-2 py-0.5 text-[10px] font-medium text-primary-foreground">
            {zoom.toFixed(1)}×
          </span>
        ) : null}
      </div>

      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="icon"
          variant="outline"
          className="size-9 shrink-0"
          aria-label="Zoom out"
          disabled={!image || zoom <= MIN_ZOOM}
          onClick={() => setZoom((z) => clamp(z - 0.25, MIN_ZOOM, MAX_ZOOM))}
        >
          <ZoomOut className="size-4" />
        </Button>
        <Slider
          value={[zoom]}
          min={MIN_ZOOM}
          max={MAX_ZOOM}
          step={0.05}
          onValueChange={([v]) => setZoom(v ?? 1)}
          aria-label="Zoom"
          disabled={!image}
        />
        <Button
          type="button"
          size="icon"
          variant="outline"
          className="size-9 shrink-0"
          aria-label="Zoom in"
          disabled={!image || zoom >= MAX_ZOOM}
          onClick={() => setZoom((z) => clamp(z + 0.25, MIN_ZOOM, MAX_ZOOM))}
        >
          <ZoomIn className="size-4" />
        </Button>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="size-9 shrink-0"
          aria-label="Reset crop"
          disabled={!image || (zoom === 1 && pan.x === 0 && pan.y === 0)}
          onClick={reset}
        >
          <RotateCcw className="size-4" />
        </Button>
      </div>

      {image && crop ? (
        <div className="flex items-center gap-3 rounded-xl border border-border bg-muted/40 p-2.5">
          <CropResultPreview
            image={image}
            src={previewUrl ?? image.src}
            crop={crop}
            aspect={aspect}
            circular={circular}
            className={cn("shrink-0", circular ? "size-14" : "w-28")}
          />
          {circular ? (
            <CropResultPreview
              image={image}
              src={previewUrl ?? image.src}
              crop={crop}
              aspect={aspect}
              circular
              className="size-8 shrink-0"
            />
          ) : null}
          <div className="min-w-0 text-xs text-muted-foreground">
            <p className="font-medium text-foreground">
              {resultLabel ?? "Saved result"}
            </p>
            <p>Drag to reposition · pinch, scroll or slide to zoom.</p>
          </div>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Drag to reposition · pinch, scroll or slide to zoom.</p>
      )}
    </div>
  );
}
