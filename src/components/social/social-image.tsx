/**
 * A post photo. Images live in a private bucket, so the URL is signed on
 * demand rather than guessable.
 */
import { useEffect, useState } from "react";
import { socialImageUrl } from "@/lib/social";

export function SocialImage({ path }: { path: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void socialImageUrl(path).then((u) => active && setUrl(u));
    return () => {
      active = false;
    };
  }, [path]);
  if (!url) return <div className="aspect-4/3 w-full animate-pulse rounded-xl bg-muted" />;
  return (
    <img
      src={url}
      alt="Post attachment"
      loading="lazy"
      className="aspect-4/3 w-full rounded-xl object-cover"
    />
  );
}
