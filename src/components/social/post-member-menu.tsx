/**
 * Compact "more" menu for a community post.
 *
 * Every entry reuses an existing Universe feature — nothing here is a new
 * system: the public profile route, the follow/friend graph
 * (`universe-social`), the private messenger thread, the global Universe
 * Wallet coin transfer, social-credit gifts, report and block. The
 * relationship is only looked up when the menu opens, so a long feed stays
 * light. Admin-only controls (hide for shop, delete) are passed in by the
 * caller and only render when the caller says the viewer may use them.
 */
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  Check,
  EyeOff,
  Flag,
  Gift,
  Loader2,
  MessageCircle,
  MoreHorizontal,
  Rss,
  Send,
  ShieldOff,
  Trash2,
  UserCheck,
  UserPlus,
  UserRound,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  EMPTY_RELATIONSHIP,
  fetchRelationship,
  friendActionKind,
  friendActionLabel,
  removeFriend,
  respondFriendRequest,
  sendFriendRequest,
  type Relationship,
} from "@/lib/universe-social";

export interface PostMemberMenuProps {
  /** Poster identity. `null` when the author is masked (platform owner). */
  authorId: string | null;
  authorName: string;
  authorHandle: string | null;
  /** True when the viewer wrote this post — member actions are hidden. */
  isSelf: boolean;
  /** Opens the EXISTING private Universe chat thread with the poster. */
  onMessage?: () => void;
  /** Quick one-line message dialog (also the existing messenger). */
  onQuickMessage?: () => void;
  /** Opens the EXISTING global Universe Wallet social-credit/coin gifting flow. */
  onGiftSocialCredit?: () => void;
  following?: boolean;
  onToggleFollow?: () => void;
  onReport?: () => void;
  onBlock?: () => void;
  /** Moderation — only passed when the viewer is allowed. */
  onHideForShop?: () => void;
  onDelete?: () => void;
}

export function PostMemberMenu({
  authorId,
  authorName,
  authorHandle,
  isSelf,
  onMessage,
  onQuickMessage,
  onGiftSocialCredit,
  following = false,
  onToggleFollow,
  onReport,
  onBlock,
  onHideForShop,
  onDelete,
}: PostMemberMenuProps) {
  const [open, setOpen] = useState(false);
  const [rel, setRel] = useState<Relationship | null>(null);
  const [busy, setBusy] = useState(false);

  const canRelate = Boolean(authorId) && !isSelf;

  const load = () => {
    if (!authorId) return;
    void fetchRelationship(authorId)
      .then(setRel)
      .catch(() => setRel(EMPTY_RELATIONSHIP));
  };

  const run = async (fn: () => Promise<void>, done: string) => {
    setBusy(true);
    try {
      await fn();
      load();
      toast.success(done);
    } catch (e) {
      toast.error("That did not work", { description: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const kind = rel ? friendActionKind(rel.friend_status) : "none";
  const friendIcon =
    rel?.friend_status === "friends" ? (
      <UserCheck className="size-4" />
    ) : rel?.friend_status === "requested" ? (
      <Check className="size-4" />
    ) : (
      <UserPlus className="size-4" />
    );

  const hasAnything =
    Boolean(authorHandle) || canRelate || onHideForShop || onDelete || onReport || onBlock;
  if (!hasAnything) return null;

  return (
    <div className="flex min-w-0 items-center gap-1">
      {canRelate && onToggleFollow ? (
        <Button variant="ghost" size="sm" className="h-10 gap-1.5 px-2" onClick={onToggleFollow}>
          {following ? <UserCheck className="size-4" /> : <Rss className="size-4" />}
          <span className="text-xs">{following ? "Unfollow" : "Follow"}</span>
        </Button>
      ) : null}
      {canRelate && onMessage ? (
        <Button variant="ghost" size="sm" className="h-10 gap-1.5 px-2" onClick={onMessage}>
          <MessageCircle className="size-4" />
          <span className="hidden text-xs min-[360px]:inline">Message</span>
        </Button>
      ) : null}
      {canRelate && onGiftSocialCredit ? (
        <Button
          variant="ghost"
          size="sm"
          className="h-10 gap-1.5 px-2"
          onClick={onGiftSocialCredit}
        >
          <Gift className="size-4" />
          <span className="text-xs">Gift</span>
        </Button>
      ) : null}
      <DropdownMenu
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (o && !rel && canRelate) load();
        }}
      >
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-10 w-10 shrink-0 px-0"
            aria-label={`More actions for ${authorName}'s post`}
          >
            <MoreHorizontal className="size-5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="truncate text-xs font-medium text-muted-foreground">
          {isSelf ? "Your post" : authorName}
        </DropdownMenuLabel>

        {authorHandle ? (
          <DropdownMenuItem asChild>
            <Link to="/universe/u/$handle" params={{ handle: authorHandle }} className="gap-2">
              <UserRound className="size-4" /> View profile
            </Link>
          </DropdownMenuItem>
        ) : null}

        {canRelate ? (
          <>
            {!rel ? (
              <DropdownMenuItem disabled className="gap-2">
                <Loader2 className="size-4 animate-spin" /> Checking connection…
              </DropdownMenuItem>
            ) : (
              <>
                <DropdownMenuItem
                  disabled={busy || kind === "none"}
                  className="gap-2"
                  onSelect={(e) => {
                    e.preventDefault();
                    if (!authorId) return;
                    if (kind === "send")
                      return void run(() => sendFriendRequest(authorId), "Request sent");
                    if (kind === "accept")
                      return void run(
                        () => respondFriendRequest(rel.friend_request_id ?? "", true),
                        "You are now friends",
                      );
                    if (kind === "remove")
                      return void run(() => removeFriend(authorId), "Friend removed");
                  }}
                >
                  {friendIcon}
                  {friendActionLabel(rel.friend_status)}
                </DropdownMenuItem>
              </>
            )}
            <DropdownMenuSeparator />
            {onQuickMessage ? (
              <DropdownMenuItem className="gap-2" onSelect={onQuickMessage}>
                <Send className="size-4" /> Send a quick message
              </DropdownMenuItem>
            ) : null}
          </>
        ) : null}

        {(canRelate && (onReport || onBlock)) || onHideForShop || onDelete ? (
          <DropdownMenuSeparator />
        ) : null}
        {canRelate && onReport ? (
          <DropdownMenuItem className="gap-2" onSelect={onReport}>
            <Flag className="size-4" /> Report
          </DropdownMenuItem>
        ) : null}
        {canRelate && onBlock ? (
          <DropdownMenuItem className="gap-2" onSelect={onBlock}>
            <ShieldOff className="size-4" /> Block {authorName.split(" ")[0]}
          </DropdownMenuItem>
        ) : null}
        {onHideForShop ? (
          <DropdownMenuItem className="gap-2" onSelect={onHideForShop}>
            <EyeOff className="size-4" /> Hide from my shop
          </DropdownMenuItem>
        ) : null}
        {onDelete ? (
          <DropdownMenuItem className="gap-2 text-destructive" onSelect={onDelete}>
            <Trash2 className="size-4" /> Delete post
          </DropdownMenuItem>
        ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
