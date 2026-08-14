/**
 * Follow and Add friend controls for a Universe member.
 *
 * Following is instant and one-way; friendship needs the other person to
 * accept. Neither relationship reveals wallets, shop balances or messages —
 * they only affect what appears in the feed and notifications.
 */
import { useEffect, useState } from "react";
import { UserPlus, UserCheck, Check, Loader2, Rss } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
  EMPTY_RELATIONSHIP,
  fetchRelationship,
  friendActionKind,
  friendActionLabel,
  followActionLabel,
  removeFriend,
  respondFriendRequest,
  sendFriendRequest,
  setFollowing,
  type Relationship,
} from "@/lib/universe-social";

export function RelationshipActions({
  userId,
  size = "sm",
  className,
  onChange,
}: {
  userId: string;
  size?: "sm" | "xs";
  className?: string;
  onChange?: (r: Relationship) => void;
}) {
  const [rel, setRel] = useState<Relationship>(EMPTY_RELATIONSHIP);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState<"follow" | "friend" | null>(null);

  const load = () =>
    fetchRelationship(userId)
      .then((r) => {
        setRel(r);
        onChange?.(r);
      })
      .catch(() => undefined)
      .finally(() => setReady(true));

  useEffect(() => {
    let active = true;
    setReady(false);
    void fetchRelationship(userId)
      .then((r) => {
        if (!active) return;
        setRel(r);
        onChange?.(r);
      })
      .catch(() => undefined)
      .finally(() => active && setReady(true));
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const run = async (which: "follow" | "friend", fn: () => Promise<void>, done: string) => {
    setBusy(which);
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

  const onFollow = () =>
    run(
      "follow",
      () => setFollowing(userId, !rel.following),
      rel.following ? "Unfollowed" : "Following",
    );

  const kind = friendActionKind(rel.friend_status);
  const onFriend = () => {
    if (kind === "none") return;
    if (kind === "send") return run("friend", () => sendFriendRequest(userId), "Request sent");
    if (kind === "accept")
      return run(
        "friend",
        () => respondFriendRequest(rel.friend_request_id ?? "", true),
        "You are now friends",
      );
    return run("friend", () => removeFriend(userId), "Friend removed");
  };

  const btnSize = size === "xs" ? "h-8 px-2.5 text-xs" : "";

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      <Button
        type="button"
        size="sm"
        variant={rel.following ? "secondary" : "default"}
        className={cn("gap-1.5", btnSize)}
        disabled={!ready || busy !== null}
        onClick={onFollow}
      >
        {busy === "follow" ? (
          <Loader2 className="size-4 animate-spin" />
        ) : rel.following ? (
          <Check className="size-4" />
        ) : (
          <Rss className="size-4" />
        )}
        {followActionLabel(rel.following)}
      </Button>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className={cn("gap-1.5", btnSize)}
        disabled={!ready || busy !== null || kind === "none"}
        onClick={onFriend}
      >
        {busy === "friend" ? (
          <Loader2 className="size-4 animate-spin" />
        ) : rel.friend_status === "friends" ? (
          <UserCheck className="size-4" />
        ) : (
          <UserPlus className="size-4" />
        )}
        {friendActionLabel(rel.friend_status)}
      </Button>
    </div>
  );
}

/**
 * Compact follow / add-friend menu for a post. The relationship is only looked
 * up when the menu is opened, so a long feed stays light.
 */
export function RelationshipMenu({ userId, name }: { userId: string; name: string }) {
  const [open, setOpen] = useState(false);
  const [rel, setRel] = useState<Relationship | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () =>
    fetchRelationship(userId)
      .then(setRel)
      .catch(() => setRel(EMPTY_RELATIONSHIP));

  const run = async (fn: () => Promise<void>, done: string) => {
    setBusy(true);
    try {
      await fn();
      await load();
      toast.success(done);
    } catch (e) {
      toast.error("That did not work", { description: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const kind = rel ? friendActionKind(rel.friend_status) : "none";

  return (
    <DropdownMenu
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o && !rel) void load();
      }}
    >
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-10"
          aria-label={`Follow or add ${name} as a friend`}
        >
          <UserPlus className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {!rel ? (
          <DropdownMenuItem disabled>Loading…</DropdownMenuItem>
        ) : (
          <>
            <DropdownMenuItem
              disabled={busy}
              onSelect={(e) => {
                e.preventDefault();
                void run(
                  () => setFollowing(userId, !rel.following),
                  rel.following ? "Unfollowed" : "Following",
                );
              }}
            >
              {rel.following ? "Unfollow" : "Follow"}
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={busy || kind === "none"}
              onSelect={(e) => {
                e.preventDefault();
                if (kind === "send") return void run(() => sendFriendRequest(userId), "Request sent");
                if (kind === "accept")
                  return void run(
                    () => respondFriendRequest(rel.friend_request_id ?? "", true),
                    "You are now friends",
                  );
                if (kind === "remove")
                  return void run(() => removeFriend(userId), "Friend removed");
              }}
            >
              {friendActionLabel(rel.friend_status)}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
