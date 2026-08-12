import { ImageIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { rewardImageUrl } from "@/lib/reward-images";

/**
 * Shows a reward's optional image. Falls back to a clean branded placeholder
 * whenever there is no image, the signed URL cannot be issued, or it fails to load.
 */
export function RewardImage({
  path,
  className,
  alt,
}: {
  path?: string | null;
  className?: string;
  alt: string;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "ready" | "error">("idle");

  useEffect(() => {
    let active = true;
    if (!path) {
      setUrl(null);
      setState("idle");
      return;
    }
    setState("loading");
    void rewardImageUrl(path).then((u) => {
      if (!active) return;
      setUrl(u);
      setState(u ? "ready" : "error");
    });
    return () => {
      active = false;
    };
  }, [path]);

  const base = cn(
    "relative flex aspect-[16/10] w-full items-center justify-center overflow-hidden rounded-lg border border-border bg-muted",
    className,
  );

  if (state === "ready" && url) {
    return (
      <div className={base}>
        <img
          src={url}
          alt={alt}
          loading="lazy"
          className="size-full object-cover"
          onError={() => setState("error")}
        />
      </div>
    );
  }

  return (
    <div className={base}>
      {state === "loading" ? (
        <div className="size-full animate-pulse bg-muted" />
      ) : (
        <ImageIcon className="size-6 text-muted-foreground" aria-hidden />
      )}
    </div>
  );
}
