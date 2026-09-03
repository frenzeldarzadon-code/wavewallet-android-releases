/**
 * Retail product photo. Objects live in a private bucket and are shown through
 * short-lived signed URLs; a missing photo degrades to a neutral placeholder
 * so cards keep the same shape as the voucher shop.
 */
import { ImageIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { retailImageUrl } from "@/lib/retail";

export function RetailImage({
  path,
  alt,
  className,
}: {
  path?: string | null;
  alt: string;
  className?: string;
}) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void retailImageUrl(path).then((u) => alive && setUrl(u));
    return () => {
      alive = false;
    };
  }, [path]);

  return (
    <div className={cn("aspect-[16/10] w-full overflow-hidden bg-muted", className)}>
      {url ? (
        <img src={url} alt={alt} loading="lazy" className="size-full object-cover" />
      ) : (
        <div className="surface-gradient flex size-full items-center justify-center">
          <ImageIcon className="size-6 text-primary-foreground/80" aria-hidden />
        </div>
      )}
    </div>
  );
}
