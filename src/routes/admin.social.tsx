import { createFileRoute } from "@tanstack/react-router";
import { SOCIAL_ENABLED } from "@/lib/features";
import { SocialDisabled } from "@/components/social/social-disabled";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState, PageSection } from "@/components/ui-kit";
import { HiddenPostsCard } from "@/components/social/hidden-posts-card";
import { EcosystemSocialCard } from "@/components/social/ecosystem-social-card";
import { PromotionTiersCard } from "@/components/social/promotion-tiers-card";
import { useSession } from "@/lib/session";
import {
  deleteComment,
  deletePost,
  fetchSocialActivity,
  fetchSocialReports,
  relativeTime,
  reviewReport,
  sourceLabel,
  type SocialActivityRow,
  type SocialReportRow,
} from "@/lib/social";

export const Route = createFileRoute("/admin/social")({
  head: () => ({
    meta: [
      { title: "Community Moderation — ONE WAVE Admin" },
      {
        name: "description",
        content:
          "Review reported posts and comments, remove content and monitor social coin activity in your shop.",
      },
      { property: "og:title", content: "Community Moderation — ONE WAVE Admin" },
      {
        property: "og:description",
        content: "Moderate your shop community and audit social coin activity.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AdminSocialGate,
});

function AdminSocial() {
  const { ecosystemDbId, account } = useSession("admin");
  const [reports, setReports] = useState<SocialReportRow[]>([]);
  const [activity, setActivity] = useState<SocialActivityRow[]>([]);
  const [loading, setLoading] = useState(true);

  const accountId = account?.id ?? null;
  const load = useCallback(async () => {
    if (!accountId) return;
    try {
      const [r, a] = await Promise.all([
        fetchSocialReports(ecosystemDbId),
        fetchSocialActivity(ecosystemDbId),
      ]);
      setReports(r);
      setActivity(a);
    } catch (e) {
      toast.error("Could not load moderation data", { description: (e as Error).message });
    } finally {
      setLoading(false);
    }
  }, [accountId, ecosystemDbId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!account) return null;

  const act = async (row: SocialReportRow, remove: boolean) => {
    try {
      if (remove) {
        if (row.target_type === "post") await deletePost(row.target_id, `Report: ${row.reason}`);
        else if (row.target_type === "comment")
          await deleteComment(row.target_id, `Report: ${row.reason}`);
      }
      await reviewReport(row.id, remove ? "actioned" : "dismissed");
      toast.success(remove ? "Content removed" : "Report dismissed");
      await load();
    } catch (e) {
      toast.error("Could not complete that action", { description: (e as Error).message });
    }
  };

  const open = reports.filter((r) => r.status === "open");

  return (
    <>
      {ecosystemDbId ? (
        <>
          <EcosystemSocialCard ecosystemId={ecosystemDbId} />
          <PromotionTiersCard
            ecosystemId={ecosystemDbId}
            title="Promotion types for my shop"
            description="Members pay to highlight a post. Customise the platform levels or add your own — every promoted post is clearly labelled."
          />
        </>
      ) : null}

      <HiddenPostsCard ecosystemId={ecosystemDbId} />

      <PageSection devSlot="social.reported-content"
        title="Reported content"
        description="Members can report posts, replies and other members. Everything here is scoped to your shop only."
      >
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : open.length === 0 ? (
          <EmptyState title="Nothing to review" description="No open reports in your community." />
        ) : (
          <div className="space-y-2">
            {open.map((r) => (
              <Card key={r.id} className="shadow-[var(--shadow-card)]">
                <CardContent className="space-y-2 py-3">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <Badge variant="outline">{r.target_type}</Badge>
                    <span>Reported by {r.reporter_name}</span>
                    <span>· about {r.target_name}</span>
                    <span>· {relativeTime(r.created_at)}</span>
                  </div>
                  <p className="text-sm font-medium">{r.reason}</p>
                  {r.content ? (
                    <p className="whitespace-pre-wrap break-words rounded-xl bg-muted p-3 text-sm">
                      {r.content}
                    </p>
                  ) : null}
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="destructive" onClick={() => void act(r, true)}>
                      Remove content
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => void act(r, false)}>
                      Dismiss
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </PageSection>

      <PageSection devSlot="social.social-coin-activity"
        title="Social coin activity"
        description="Historical ledger of social coin movements in your shop. Posting, replies and promotions are free today, so new spending entries are no longer created."
      >
        {activity.length === 0 ? (
          <EmptyState title="No social coin activity yet" />
        ) : (
          <div className="space-y-2">
            {activity.map((row, i) => (
              <Card key={`${row.created_at}-${i}`} className="shadow-[var(--shadow-card)]">
                <CardContent className="flex items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{row.user_name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {sourceLabel(row.source)} · {relativeTime(row.created_at)}
                    </p>
                  </div>
                  <span
                    className={
                      row.direction === "credit"
                        ? "text-sm font-semibold text-success"
                        : "text-sm font-semibold text-destructive"
                    }
                  >
                    {row.direction === "credit" ? "+" : "−"}
                    {row.amount}
                  </span>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </PageSection>
    </>
  );
}

function AdminSocialGate() {
  if (!SOCIAL_ENABLED) return <SocialDisabled backTo="/admin" />;
  return <AdminSocial />;
}
