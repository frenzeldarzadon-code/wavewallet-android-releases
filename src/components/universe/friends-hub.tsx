/**
 * Universe → Friends: three tabs on top of the EXISTING social graph.
 *
 *   Friends       – accepted friendships (+ pending requests you must answer)
 *   Find Friends  – Universe-wide search + who is online, with Add friend /
 *                   Accept / Friends and Follow controls
 *   Following     – people you follow (same follow_member RPC as the feed)
 *
 * Single source of truth: social_friendships / social_follows through
 * my_social_graph, universe_relationship_batch, send_friend_request,
 * respond_friend_request, remove_friend and follow_member. No shop is
 * involved anywhere — a member with zero shops has the full experience.
 */
import { Link, useNavigate } from "@tanstack/react-router";
import {
  Check,
  Loader2,
  MessageCircle,
  Rss,
  Search,
  UserCheck,
  UserMinus,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MemberAvatar } from "@/components/member-avatar";
import { EmptyState } from "@/components/ui-kit";
import { displayHandle } from "@/lib/profile";
import { openThread } from "@/lib/social";
import {
  fetchRelationshipBatch,
  fetchSocialGraph,
  friendActionKind,
  friendActionLabel,
  removeFriend,
  respondFriendRequest,
  sendFriendRequest,
  setFollowing,
  type GraphEntry,
  type RelationshipLite,
} from "@/lib/universe-social";
import {
  PersonListItem,
  useOnlineMembers,
  usePeopleSearch,
  useTicker,
  type PersonRow,
} from "@/components/universe/people-sheet";

export type FriendsTab = "friends" | "find" | "following";

export function FriendsHub({
  tab,
  onTabChange,
}: {
  tab: FriendsTab;
  onTabChange: (t: FriendsTab) => void;
}) {
  const navigate = useNavigate();
  const [rows, setRows] = useState<GraphEntry[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(
    () =>
      fetchSocialGraph()
        .then(setRows)
        .catch((e: Error) => {
          setRows([]);
          toast.error("Could not load your connections", { description: e.message });
        }),
    [],
  );
  useEffect(() => {
    void load();
  }, [load]);

  const act = async (key: string, fn: () => Promise<void>, done: string) => {
    setBusy(key);
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

  const message = async (userId: string) => {
    try {
      const threadId = await openThread(userId);
      await navigate({ to: "/universe/messages", search: { thread: threadId } });
    } catch (e) {
      toast.error("Could not open the conversation", { description: (e as Error).message });
    }
  };

  const friends = (rows ?? []).filter((r) => r.kind === "friend" && r.status === "friends");
  const incoming = (rows ?? []).filter((r) => r.kind === "friend" && r.status === "incoming");
  const sent = (rows ?? []).filter((r) => r.kind === "friend" && r.status === "requested");
  const following = (rows ?? []).filter((r) => r.kind === "following");

  const person = (r: GraphEntry, actions: React.ReactNode) => (
    <li key={`${r.kind}-${r.relation_id}`} className="flex items-center gap-3 px-4 py-2.5">
      <Link
        to="/universe/u/$handle"
        params={{ handle: r.handle ?? "" }}
        disabled={!r.handle}
        className="flex min-w-0 flex-1 items-center gap-3"
      >
        <MemberAvatar path={r.avatar_path} name={r.full_name} className="size-10" />
        <span className="min-w-0 flex-1 leading-tight">
          <span className="block truncate text-sm font-semibold">{r.full_name}</span>
          <span className="block truncate text-xs text-muted-foreground">
            {displayHandle(r.handle) ?? "Member"}
          </span>
        </span>
      </Link>
      {busy === r.relation_id ? <Loader2 className="size-4 animate-spin" /> : actions}
    </li>
  );

  const loading = rows === null;

  return (
    <Tabs value={tab} onValueChange={(v) => onTabChange(v as FriendsTab)} className="space-y-3">
      <TabsList className="sticky top-[57px] z-20 grid h-11 w-full grid-cols-3 lg:top-[65px]">
        <TabsTrigger value="friends" className="h-9">
          Friends{friends.length ? ` · ${friends.length}` : ""}
          {incoming.length ? (
            <span className="ml-1.5 inline-flex min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold leading-4 text-destructive-foreground">
              {incoming.length}
            </span>
          ) : null}
        </TabsTrigger>
        <TabsTrigger value="find" className="h-9">
          Find Friends
        </TabsTrigger>
        <TabsTrigger value="following" className="h-9">
          Following{following.length ? ` · ${following.length}` : ""}
        </TabsTrigger>
      </TabsList>

      {/* ── Friends ─────────────────────────────────────────── */}
      <TabsContent value="friends" className="space-y-3">
        {loading ? (
          <Spinner />
        ) : (
          <>
            {incoming.length > 0 ? (
              <Panel title="Friend requests" hint="They asked to be your friend.">
                {incoming.map((r) =>
                  person(
                    r,
                    <div className="flex gap-1.5">
                      <Button
                        size="sm"
                        className="h-9 gap-1.5"
                        onClick={() =>
                          void act(
                            r.relation_id,
                            () => respondFriendRequest(r.relation_id, true),
                            "You are now friends",
                          )
                        }
                      >
                        <Check className="size-4" /> Accept
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-9 w-9 px-0"
                        aria-label="Decline"
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
                    </div>,
                  ),
                )}
              </Panel>
            ) : null}

            <Panel title="Your friends" hint="Social links only — never your wallet or shop data.">
              {friends.length === 0 ? (
                <EmptyState
                  title="No friends yet"
                  description="Use Find Friends to search anyone in the Universe."
                />
              ) : (
                friends.map((r) =>
                  person(
                    r,
                    <div className="flex gap-1">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-9 w-9 px-0"
                        aria-label={`Message ${r.full_name}`}
                        onClick={() => void message(r.user_id)}
                      >
                        <MessageCircle className="size-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-9 w-9 px-0 text-muted-foreground"
                        aria-label={`Remove ${r.full_name} from friends`}
                        onClick={() =>
                          void act(r.relation_id, () => removeFriend(r.user_id), "Friend removed")
                        }
                      >
                        <UserMinus className="size-4" />
                      </Button>
                    </div>,
                  ),
                )
              )}
            </Panel>

            {sent.length > 0 ? (
              <Panel title="Sent requests" hint="Waiting for their answer.">
                {sent.map((r) =>
                  person(
                    r,
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-9"
                      onClick={() =>
                        void act(
                          r.relation_id,
                          () => respondFriendRequest(r.relation_id, false),
                          "Request withdrawn",
                        )
                      }
                    >
                      Cancel
                    </Button>,
                  ),
                )}
              </Panel>
            ) : null}
          </>
        )}
      </TabsContent>

      {/* ── Find Friends ────────────────────────────────────── */}
      <TabsContent value="find">
        <FindFriends active={tab === "find"} onChanged={load} onMessage={message} />
      </TabsContent>

      {/* ── Following ───────────────────────────────────────── */}
      <TabsContent value="following">
        {loading ? (
          <Spinner />
        ) : (
          <Panel title="People you follow" hint="Their posts show up in your feed.">
            {following.length === 0 ? (
              <EmptyState
                title="Not following anyone"
                description="Tap Follow on a post or in Find Friends."
              />
            ) : (
              following.map((r) =>
                person(
                  r,
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-9 gap-1.5"
                    onClick={() =>
                      void act(r.relation_id, () => setFollowing(r.user_id, false), "Unfollowed")
                    }
                  >
                    <UserCheck className="size-4" /> Unfollow
                  </Button>,
                ),
              )
            )}
          </Panel>
        )}
      </TabsContent>
    </Tabs>
  );
}

function Spinner() {
  return (
    <p className="flex items-center gap-2 px-4 py-6 text-sm text-muted-foreground">
      <Loader2 className="size-4 animate-spin" /> Loading…
    </p>
  );
}

function Panel({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card shadow-[var(--shadow-card)]">
      <header className="border-b border-border px-4 py-2.5">
        <p className="text-sm font-bold tracking-tight">{title}</p>
        {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      </header>
      <ul className="divide-y divide-border">{children}</ul>
    </section>
  );
}

/**
 * Search anyone + see who is online, with relationship controls per row.
 * Relationship state comes from ONE batch RPC per result page.
 */
function FindFriends({
  active,
  onChanged,
  onMessage,
}: {
  active: boolean;
  onChanged: () => Promise<void>;
  onMessage: (userId: string) => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const now = useTicker(active);
  const online = useOnlineMembers(active);
  const search = usePeopleSearch(query);
  const [rel, setRel] = useState<Map<string, RelationshipLite>>(new Map());
  const [busy, setBusy] = useState<string | null>(null);

  const list: PersonRow[] = useMemo(() => {
    if (query.trim().length >= 2) {
      const presence = new Map((online ?? []).map((m) => [m.id, m]));
      return (search.rows ?? []).map((p) => {
        const k = presence.get(p.id);
        return k ? { ...p, online: k.online, lastSeenAt: k.lastSeenAt } : p;
      });
    }
    return online ?? [];
  }, [query, search.rows, online]);

  const ids = list.map((p) => p.id).join(",");
  const refreshRel = useCallback(() => {
    const arr = ids ? ids.split(",") : [];
    if (arr.length === 0) return Promise.resolve();
    return fetchRelationshipBatch(arr)
      .then((m) => setRel((prev) => new Map([...prev, ...m])))
      .catch(() => undefined);
  }, [ids]);
  useEffect(() => {
    void refreshRel();
  }, [refreshRel]);

  const run = async (id: string, fn: () => Promise<void>, done: string) => {
    setBusy(id);
    try {
      await fn();
      await Promise.all([refreshRel(), onChanged()]);
      toast.success(done);
    } catch (e) {
      toast.error("That did not work", { description: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const controls = (p: PersonRow) => {
    const r = rel.get(p.id) ?? { following: false, friend_status: "none", friend_request_id: null };
    const kind = friendActionKind(r.friend_status);
    if (busy === p.id) return <Loader2 className="size-4 animate-spin" />;
    return (
      <div className="flex shrink-0 items-center gap-1">
        <Button
          size="sm"
          variant={r.following ? "outline" : "ghost"}
          className="h-9 w-9 px-0"
          aria-label={r.following ? `Unfollow ${p.full_name}` : `Follow ${p.full_name}`}
          title={r.following ? "Unfollow" : "Follow"}
          onClick={() =>
            void run(
              p.id,
              () => setFollowing(p.id, !r.following),
              r.following ? `Unfollowed ${p.full_name}` : `Following ${p.full_name}`,
            )
          }
        >
          {r.following ? <UserCheck className="size-4" /> : <Rss className="size-4" />}
        </Button>
        <Button
          size="sm"
          variant={r.friend_status === "friends" ? "outline" : "default"}
          className="h-9 gap-1.5 px-2.5"
          disabled={kind === "none"}
          onClick={() => {
            if (kind === "send")
              return void run(p.id, () => sendFriendRequest(p.id), "Friend request sent");
            if (kind === "accept")
              return void run(
                p.id,
                () => respondFriendRequest(r.friend_request_id ?? "", true),
                "You are now friends",
              );
            if (kind === "remove")
              return void run(p.id, () => removeFriend(p.id), "Friend removed");
          }}
        >
          {r.friend_status === "friends" ? (
            <Users className="size-4" />
          ) : r.friend_status === "requested" ? (
            <Check className="size-4" />
          ) : (
            <UserPlus className="size-4" />
          )}
          <span className="text-xs">{friendActionLabel(r.friend_status)}</span>
        </Button>
        {r.friend_status === "friends" ? (
          <Button
            size="sm"
            variant="ghost"
            className="h-9 w-9 px-0"
            aria-label={`Message ${p.full_name}`}
            onClick={() => void onMessage(p.id)}
          >
            <MessageCircle className="size-4" />
          </Button>
        ) : null}
      </div>
    );
  };

  const searching = query.trim().length >= 2;
  const onlineNow = list.filter((p) => p.online);
  const recent = list.filter((p) => !p.online);

  const section = (heading: string, items: PersonRow[]) =>
    items.length === 0 ? null : (
      <Panel title={heading}>
        {items.map((p) => (
          <li key={p.id}>
            <PersonListItem person={p} now={now} trailing={controls(p)} />
          </li>
        ))}
      </Panel>
    );

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search anyone by name or @handle"
          className="h-12 rounded-xl pl-9 text-base"
          autoCapitalize="none"
          autoCorrect="off"
          aria-label="Find friends"
        />
      </div>
      <p className="text-xs text-muted-foreground">
        {searching
          ? "Everyone in the Universe who matches — no shop needed."
          : "Members active recently, online first. Type to search everyone."}
      </p>

      {searching ? (
        search.busy && !search.rows ? (
          <Spinner />
        ) : list.length === 0 ? (
          <EmptyState title="No matches" description={`Nobody named “${query.trim()}” yet.`} />
        ) : (
          section("Results", list)
        )
      ) : online === null ? (
        <Spinner />
      ) : list.length === 0 ? (
        <EmptyState
          title="Nobody active recently"
          description="Search by name or @handle to find anyone."
        />
      ) : (
        <>
          {section("Online now", onlineNow)}
          {section("Recently active", recent)}
        </>
      )}
    </div>
  );
}
