import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui-kit";
import { MemberAvatar } from "@/components/member-avatar";
import { UniverseShell } from "@/components/universe/universe-shell";
import { displayHandle } from "@/lib/profile";
import { fetchUniverseProfile, type UniverseProfile } from "@/lib/social";

export const Route = createFileRoute("/universe/u/$handle")({
  head: () => ({
    meta: [
      { title: "Universe Profile — WaveWallet" },
      {
        name: "description",
        content:
          "Public WaveWallet Universe profile: display name, unique @handle, photo and bio. No wallet or transaction details are shown.",
      },
      { property: "og:title", content: "Universe Profile — WaveWallet" },
      {
        property: "og:description",
        content: "A member's public WaveWallet Universe identity.",
      },
      { property: "og:type", content: "profile" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: UniverseMemberProfile,
});

/**
 * Public Universe profile. Identity only — the database function returns just
 * name, handle, photo, bio and join date, never wallets, balances, earnings,
 * shop history or private messages.
 */
function UniverseMemberProfile() {
  const { handle } = useParams({ from: "/universe/u/$handle" });
  const [profile, setProfile] = useState<UniverseProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    void fetchUniverseProfile(handle)
      .then((p) => active && setProfile(p))
      .catch((e: Error) => toast.error("Could not open that profile", { description: e.message }))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [handle]);

  return (
    <UniverseShell title={displayHandle(handle) ?? "Profile"} subtitle="Universe profile">
      <div className="space-y-4 px-4 sm:px-0">
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading profile…</p>
        ) : !profile ? (
          <EmptyState
            title="No such member"
            description={`Nobody in the Universe uses ${displayHandle(handle)}.`}
          />
        ) : (
          <Card className="shadow-[var(--shadow-card)]">
            <CardContent className="space-y-3 py-5">
              <div className="flex items-center gap-3">
                <MemberAvatar
                  path={profile.avatar_path}
                  name={profile.full_name}
                  className="size-16"
                />
                <div className="min-w-0">
                  <h1 className="truncate text-lg font-semibold">{profile.full_name}</h1>
                  <p className="truncate text-sm text-primary">{displayHandle(profile.handle)}</p>
                  <p className="text-xs text-muted-foreground">
                    Joined {new Date(profile.joined_at).toLocaleDateString()}
                  </p>
                </div>
              </div>
              {profile.bio ? <p className="text-sm">{profile.bio}</p> : null}
              <p className="text-xs text-muted-foreground">
                Public profiles show identity only. Wallets, credits, earnings, shop history and
                private messages are never shown here.
              </p>
              <Button asChild variant="outline" size="sm">
                <Link to="/universe">Back to the feed</Link>
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </UniverseShell>
  );
}
