/**
 * Public identity summary on the Universe profile page: how other members see
 * you, plus a direct path to your public profile and (when authorized to
 * sell) your seller storefront. Read-only; editing lives in ProfilePage.
 */
import { Link } from "@tanstack/react-router";
import { ExternalLink, Store } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { MemberAvatar } from "@/components/member-avatar";
import { avatarUrl, fetchMyProfile, type MyProfile } from "@/lib/profile";
import { fetchSellerStorefront, hasStorefront } from "@/lib/seller-storefront";

export function PublicIdentityCard({ userId }: { userId: string }) {
  const [profile, setProfile] = useState<MyProfile | null>(null);
  const [storeName, setStoreName] = useState<string | null>(null);
  const [coverUrl, setCoverUrl] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void fetchMyProfile(userId)
      .then(async (p) => {
        if (!alive || !p) return;
        setProfile(p);
        void avatarUrl(p.cover_path).then((url) => alive && setCoverUrl(url));
        if (p.handle) {
          const store = await fetchSellerStorefront(p.handle).catch(() => null);
          if (alive) setStoreName(hasStorefront(store) ? store.storeName : null);
        }
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [userId]);

  if (!profile) return null;

  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-[var(--shadow-card)]">
      <div className="aspect-[3/1] w-full bg-brand-soft bg-cover bg-center" style={coverUrl ? { backgroundImage: `url(${coverUrl})` } : undefined} />
      <div className="relative grid grid-cols-[auto_minmax(0,1fr)] items-start gap-3 bg-card px-4 pt-3">
        <MemberAvatar
          path={profile.avatar_path}
          name={profile.full_name}
          className="-mt-10 size-20 border-4 border-card text-base shadow-[var(--shadow-card)]"
        />
        <div className="min-w-0 pb-1">
          <p className="break-words text-base font-bold leading-snug">{profile.full_name}</p>
          <p className="mt-0.5 break-all text-xs text-muted-foreground">
            {profile.handle ? `@${profile.handle}` : "No @handle yet"}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Joined {new Date(profile.joined_at).toLocaleDateString()}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2 px-4 py-3">
        {profile.handle ? (
          <Button asChild size="sm" variant="outline" className="rounded-full">
            <Link to="/universe/u/$handle" params={{ handle: profile.handle }}>
              <ExternalLink className="size-4" /> View public profile
            </Link>
          </Button>
        ) : null}
        {profile.handle && storeName ? (
          <Button asChild size="sm" className="rounded-full">
            <Link to="/universe/u/$handle" params={{ handle: profile.handle }}>
              <Store className="size-4" /> {storeName}
            </Link>
          </Button>
        ) : null}
      </div>
    </section>
  );
}
