import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { EmptyState, PageSection } from "@/components/ui-kit";
import { MemberAvatar } from "@/components/member-avatar";
import {
  fetchGeneralQueue,
  relativeTime,
  reviewDistribution,
  type DistributionRow,
} from "@/lib/social";

/**
 * Per-shop moderation queue for General posts shared from other shops.
 * Each shop decides independently; the decision is audited server-side.
 */
export function GeneralQueueCard({ ecosystemId }: { ecosystemId?: string | null }) {
  const [tab, setTab] = useState<"pending" | "all">("pending");
  const [rows, setRows] = useState<DistributionRow[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setRows(await fetchGeneralQueue(ecosystemId ?? null, tab));
    } catch (e) {
      toast.error("Could not load shared posts", { description: (e as Error).message });
    } finally {
      setLoading(false);
    }
  }, [ecosystemId, tab]);

  useEffect(() => {
    void load();
  }, [load]);

  const decide = async (row: DistributionRow, status: "approved" | "rejected") => {
    try {
      await reviewDistribution(row.id, status, notes[row.id]);
      toast.success(status === "approved" ? "Published in your shop" : "Kept hidden in your shop");
      await load();
    } catch (e) {
      toast.error("Could not save that decision", { description: (e as Error).message });
    }
  };

  return (
    <PageSection
      title="Shared posts awaiting your approval"
      description="Members of other shops can share a General post with the whole network. It only appears in your community if you approve it here."
      action={
        <Button variant="outline" size="sm" onClick={() => setTab(tab === "pending" ? "all" : "pending")}>
          {tab === "pending" ? "Show all" : "Show pending"}
        </Button>
      }
    >
      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? (
        <EmptyState
          title="Nothing to review"
          description="No General posts are waiting for your shop."
        />
      ) : (
        <div className="space-y-2">
          {rows.map((r) => (
            <Card key={r.id} className="shadow-[var(--shadow-card)]">
              <CardContent className="space-y-2 py-3">
                <div className="flex items-start gap-3">
                  <MemberAvatar path={r.author_avatar} name={r.author_name} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span className="font-semibold text-foreground">{r.author_name}</span>
                      <Badge variant="outline">from {r.origin_ecosystem_name}</Badge>
                      <span>· {relativeTime(r.post_created_at)}</span>
                      {r.status !== "pending" ? (
                        <Badge
                          className={
                            r.status === "approved"
                              ? "bg-success text-success-foreground"
                              : "bg-destructive text-destructive-foreground"
                          }
                        >
                          {r.status === "approved" ? "Approved" : "Rejected"}
                        </Badge>
                      ) : null}
                    </div>
                    <p className="mt-1 whitespace-pre-wrap break-words text-sm">{r.body}</p>
                    {r.status !== "pending" && r.reviewed_by_name ? (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {r.status === "approved" ? "Approved" : "Rejected"} by {r.reviewed_by_name}
                        {r.reviewed_at ? ` · ${relativeTime(r.reviewed_at)}` : ""}
                        {r.note ? ` · note: ${r.note}` : ""}
                      </p>
                    ) : null}
                  </div>
                </div>

                {r.status === "pending" ? (
                  <div className="space-y-2">
                    <Input
                      className="h-11"
                      placeholder="Private note (admins only, optional)"
                      value={notes[r.id] ?? ""}
                      onChange={(e) => setNotes((n) => ({ ...n, [r.id]: e.target.value }))}
                    />
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" onClick={() => void decide(r, "approved")}>
                        Approve for my shop
                      </Button>
                      <Button size="sm" variant="destructive" onClick={() => void decide(r, "rejected")}>
                        Reject
                      </Button>
                    </div>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </PageSection>
  );
}
