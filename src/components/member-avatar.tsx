import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { avatarUrl, initialsOf } from "@/lib/profile";

/**
 * Square member avatar. Falls back to initials whenever there is no photo or
 * the signed URL cannot be issued, so lists never show broken images.
 */
export function MemberAvatar({
  path,
  name,
  className,
}: {
  path?: string | null;
  name: string;
  className?: string;
}) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    if (!path) {
      setUrl(null);
      return;
    }
    void avatarUrl(path).then((u) => {
      if (active) setUrl(u);
    });
    return () => {
      active = false;
    };
  }, [path]);

  return (
    <span
      className={cn(
        "flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-accent text-xs font-semibold text-accent-foreground",
        className,
      )}
    >
      {url ? (
        <img
          src={url}
          alt={name}
          loading="lazy"
          className="size-full object-cover"
          onError={() => setUrl(null)}
        />
      ) : (
        initialsOf(name)
      )}
    </span>
  );
}
