import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState, PageSection } from "@/components/ui-kit";
import { MemberAvatar } from "@/components/member-avatar";
import { MentionText } from "@/components/social/mention-text";
import { displayHandle } from "@/lib/profile";
import { fetchHiddenPosts, hidePostForShop, relativeTime, type HiddenPostRow } from "@/lib/social";

/**
 * Posts this shop admin hid from their own members. Hiding never deletes and is
 * never global: the post stays public in the Universe and visible to every
 * other shop that has not hidden it separately.
 */
export function HiddenPostsCard({ ecosystemId }: { ecosystemId?: string | null }) {
  const [rows, setRows] = useState<HiddenPostRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setRows(await fetchHiddenPosts(ecosystemId ?? null));
    } catch (e) {
      toast.error("Could not load hidden posts", { description: (e as Error).message });
    } finally {
      setLoading(false);
    }
  }, [ecosystemId]);

  useEffect(() => {
    void load();
  }, [load]);

  const restore = async (row: HiddenPostRow) => {
    try {
      await hidePostForShop(row.post_id, false, undefined, ecosystemId ?? null);
      toast.success("Visible again in your shop");
      await load();
    } catch (e) {
      toast.error("Could not restore that post", { description: (e as Error).message });
    }
  };

  return (
    <PageSection
      devSlot="hidden-posts-card.posts-hidden-from-my-shop"
      title="Posts hidden from my shop"
      description="Universe posts publish immediately — no approval needed. You can hide one from your own members; it stays public elsewhere, and only the platform owner can delete it for everyone."
    >
      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? (
        <EmptyState
          title="Nothing hidden"
          description="Your members currently see every Universe post."
        />
      ) : (
        <div className="space-y-2">
          {rows.map((r) => (
            <Card key={r.post_id} className="shadow-[var(--shadow-card)]">
              <CardContent className="space-y-2 py-3">
                <div className="flex items-start gap-3">
                  <MemberAvatar path={r.author_avatar} name={r.author_name} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                      <span className="font-semibold text-foreground">{r.author_name}</span>
                      {r.author_handle ? (
                        <span className="text-primary">{displayHandle(r.author_handle)}</span>
                      ) : null}
                      <span>· {relativeTime(r.post_created_at)}</span>
                    </div>
                    <MentionText body={r.body} className="mt-1" />
                    <p className="mt-1 text-xs text-muted-foreground">
                      Hidden by {r.hidden_by_name} · {relativeTime(r.hidden_at)}
                      {r.reason ? ` · reason: ${r.reason}` : ""}
                    </p>
                  </div>
                </div>
                <Button size="sm" variant="outline" onClick={() => void restore(r)}>
                  Show again in my shop
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </PageSection>
  );
}
