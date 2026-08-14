/**
 * Manage the people you follow and your friends.
 *
 * Everything here is a plain social link: removing a friend or unfollowing
 * changes nothing about shops, wallets, credits or past transactions.
 */
import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Loader2, UserMinus, UserPlus, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MemberAvatar } from "@/components/member-avatar";
import { EmptyState } from "@/components/ui-kit";
import { displayHandle } from "@/lib/profile";
import {
  fetchSocialGraph,
  removeFriend,
  respondFriendRequest,
  setFollowing,
  type GraphEntry,
} from "@/lib/universe-social";

export function RelationshipsCard() {
  const [rows, setRows] = useState<GraphEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = () =>
    fetchSocialGraph()
      .then(setRows)
      .catch((e: Error) => toast.error("Could not load your connections", { description: e.message }))
      .finally(() => setLoading(false));

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const act = async (id: string, fn: () => Promise<void>, done: string) => {
    setBusy(id);
    try {
      await fn();
      await load();
      toast.success(done);
    } catch (e) {
      toast.error("That did not work", { description: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const friends = rows.filter((r) => r.kind === "friend" && r.status === "friends");
  const requests = rows.filter((r) => r.kind === "friend" && r.status !== "friends");
  const following = rows.filter((r) => r.kind === "following");
  const followers = rows.filter((r) => r.kind === "follower");

  const person = (r: GraphEntry, actions: React.ReactNode) => (
    <div key={`${r.kind}-${r.relation_id}`} className="flex items-center gap-3 py-2">
      <MemberAvatar path={r.avatar_path} name={r.full_name} className="size-9" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{r.full_name}</p>
        {r.handle ? (
          <Link
            to="/universe/u/$handle"
            params={{ handle: r.handle }}
            className="truncate text-xs text-primary"
          >
            {displayHandle(r.handle)}
          </Link>
        ) : null}
      </div>
      {busy === r.relation_id ? <Loader2 className="size-4 animate-spin" /> : actions}
    </div>
  );

  return (
    <Card className="shadow-[var(--shadow-card)]">
      <CardHeader>
        <CardTitle className="text-base">Friends and following</CardTitle>
        <CardDescription>
          Social links only — they never share your wallet, shop balances or private messages.
        </CardDescription>
      </CardHeader>
      <CardContent className="pb-5">
        {loading ? (
          <p className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Loading…
          </p>
        ) : (
          <Tabs defaultValue="friends">
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="friends">Friends</TabsTrigger>
              <TabsTrigger value="requests">Requests</TabsTrigger>
              <TabsTrigger value="following">Following</TabsTrigger>
              <TabsTrigger value="followers">Followers</TabsTrigger>
            </TabsList>

            <TabsContent value="friends" className="divide-y divide-border">
              {friends.length === 0 ? (
                <EmptyState title="No friends yet" description="Send a request from a profile." />
              ) : (
                friends.map((r) =>
                  person(
                    r,
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1.5"
                      onClick={() =>
                        void act(r.relation_id, () => removeFriend(r.user_id), "Friend removed")
                      }
                    >
                      <UserMinus className="size-4" /> Remove
                    </Button>,
                  ),
                )
              )}
            </TabsContent>

            <TabsContent value="requests" className="divide-y divide-border">
              {requests.length === 0 ? (
                <EmptyState title="No pending requests" description="You are all caught up." />
              ) : (
                requests.map((r) =>
                  person(
                    r,
                    r.status === "incoming" ? (
                      <div className="flex gap-1.5">
                        <Button
                          size="sm"
                          className="gap-1.5"
                          onClick={() =>
                            void act(
                              r.relation_id,
                              () => respondFriendRequest(r.relation_id, true),
                              "You are now friends",
                            )
                          }
                        >
                          <UserPlus className="size-4" /> Accept
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            void act(
                              r.relation_id,
                              () => respondFriendRequest(r.relation_id, false),
                              "Request declined",
                            )
                          }
                        >
                          <X className="size-4" />
                        </Button>
                      </div>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          void act(
                            r.relation_id,
                            () => respondFriendRequest(r.relation_id, false),
                            "Request withdrawn",
                          )
                        }
                      >
                        Cancel request
                      </Button>
                    ),
                  ),
                )
              )}
            </TabsContent>

            <TabsContent value="following" className="divide-y divide-border">
              {following.length === 0 ? (
                <EmptyState title="Not following anyone" description="Follow people from the feed." />
              ) : (
                following.map((r) =>
                  person(
                    r,
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        void act(
                          r.relation_id,
                          () => setFollowing(r.user_id, false),
                          "Unfollowed",
                        )
                      }
                    >
                      Unfollow
                    </Button>,
                  ),
                )
              )}
            </TabsContent>

            <TabsContent value="followers" className="divide-y divide-border">
              {followers.length === 0 ? (
                <EmptyState title="No followers yet" description="Post something in the Universe." />
              ) : (
                followers.map((r) => person(r, null))
              )}
            </TabsContent>
          </Tabs>
        )}
      </CardContent>
    </Card>
  );
}
