import {
  EyeOff,
  Flag,
  Gift,
  Globe2,
  Heart,
  ImagePlus,
  Loader2,
  MessageCircle,
  Megaphone,
  Reply,
  Send,
  ShieldOff,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui-kit";
import { ImageCropper } from "@/components/image-cropper";
import { MemberAvatar } from "@/components/member-avatar";
import { displayHandle } from "@/lib/profile";
import { useSession } from "@/lib/session";
import type { CropRect } from "@/lib/image-optimize";
import {
  canGift,
  giftIssue,
  giftSocialCredits,
  COMMENT_MAX_CHARS,
  POST_MAX_CHARS,
  SOCIAL_IMAGE_ASPECT,
  audienceHelp,
  audienceLabel,
  availableTiers,
  canAfford,
  chargeSummary,
  commentCharge,
  createComment,
  createPost,
  deleteComment,
  deletePost,
  distributionSummary,
  fetchComments,
  fetchDistributionStatus,
  fetchFeed,
  fetchSocialState,
  postCharge,
  relativeTime,
  reportContent,
  setBlocked,
  socialImageUrl,
  tierDuration,
  toggleLike,
  uploadSocialImage,
  validateCommentBody,
  validatePostBody,
  validateSocialImage,
  type FeedComment,
  type FeedPost,
  type DistributionStatus,
  type PostAudience,
  type PromotionTier,
  type SocialCurrency,
  type SocialState,
} from "@/lib/social";
import { canReplyTo, hidePostForShop, sendMessage, threadComments } from "@/lib/social";
import { PostComposer } from "@/components/social/post-composer";
import { RelationshipMenu } from "@/components/universe/relationship-actions";
import { MentionText } from "@/components/social/mention-text";
import { RoleBadge } from "@/components/role-badge";
import { MentionInput } from "@/components/social/mention-input";

/** Signed-image thumbnail for a post. */
function PostImage({ path }: { path: string }) {
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

/**
 * Wraps an avatar or name so it opens the author's public Universe profile.
 * Members without a handle are not linkable (the database gives everyone one,
 * so this is only a safety net for legacy rows).
 */
function AuthorLink({ handle, children }: { handle: string | null; children: React.ReactNode }) {
  if (!handle) return <>{children}</>;
  return (
    <Link to="/universe/u/$handle" params={{ handle }} className="min-w-0">
      {children}
    </Link>
  );
}

export function SocialPage() {
  const session = useSession();
  const account = session.account;
  const [state, setState] = useState<SocialState | null>(null);
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [loading, setLoading] = useState(true);

  // composer
  const [composerOpen, setComposerOpen] = useState(false);

  // reporting
  const [report, setReport] = useState<{ type: "post" | "comment"; id: string } | null>(null);
  const [reportReason, setReportReason] = useState("");

  const refresh = useCallback(async () => {
    try {
      const [s, f] = await Promise.all([fetchSocialState(), fetchFeed()]);
      setState(s);
      setPosts(f);
    } catch (e) {
      toast.error("Could not load the community feed", { description: (e as Error).message });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!account) return;
    void refresh();
  }, [account, refresh]);

  const tiers = useMemo<PromotionTier[]>(
    () =>
      state
        ? availableTiers({ promotion_tiers: state.promotion_tiers, role: account?.role ?? null })
        : [],
    [state, account?.role],
  );

  if (!account) return null;

  const like = async (post: FeedPost) => {
    // Optimistic: likes are always free.
    setPosts((prev) =>
      prev.map((p) =>
        p.id === post.id
          ? {
              ...p,
              liked_by_me: !p.liked_by_me,
              like_count: p.like_count + (p.liked_by_me ? -1 : 1),
            }
          : p,
      ),
    );
    try {
      const res = await toggleLike(post.id);
      setPosts((prev) =>
        prev.map((p) =>
          p.id === post.id ? { ...p, liked_by_me: res.liked, like_count: res.likes } : p,
        ),
      );
    } catch (e) {
      toast.error("Could not update your like", { description: (e as Error).message });
      await refresh();
    }
  };

  const remove = async (postId: string) => {
    try {
      await deletePost(postId);
      setPosts((prev) => prev.filter((p) => p.id !== postId));
      toast.success("Post removed");
    } catch (e) {
      toast.error("Could not remove that post", { description: (e as Error).message });
    }
  };

  const block = async (memberId: string, name: string) => {
    try {
      await setBlocked(memberId, true);
      toast.success(`${name} is blocked`, {
        description: "You will not see each other's content.",
      });
      await refresh();
    } catch (e) {
      toast.error("Could not block", { description: (e as Error).message });
    }
  };

  const submitReport = async () => {
    if (!report) return;
    try {
      await reportContent(report.type, report.id, reportReason);
      toast.success("Reported", { description: "Your shop admin will review this." });
      setReport(null);
      setReportReason("");
    } catch (e) {
      toast.error("Could not report", { description: (e as Error).message });
    }
  };

  return (
    <>
      <div className="px-4 sm:px-0">
        <button
          type="button"
          disabled={!state}
          onClick={() => setComposerOpen(true)}
          className="flex w-full items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3 text-left shadow-[var(--shadow-card)] transition-colors hover:bg-muted/40 disabled:opacity-60"
          aria-label="Create a post"
        >
          <MemberAvatar name={account.name} className="size-10" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-base text-muted-foreground">
              What's happening in your area?
            </span>
            <span className="block text-xs text-muted-foreground/80">
              Free to post · photos, @mentions and promotions included
            </span>
          </span>
          <span className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground">
            <Send className="size-4" /> Post
          </span>
        </button>
      </div>

      {state ? (
        <PostComposer
          open={composerOpen}
          onOpenChange={setComposerOpen}
          state={state}
          tiers={tiers}
          userId={account.id}
          pointsBalance={account.pointsBalance ?? 0}
          ownShopName={session.ecosystem?.name ?? "My shop"}
          onPosted={refresh}
        />
      ) : null}

      {loading ? (
        <p className="px-4 text-sm text-muted-foreground sm:px-0">Loading the feed…</p>
      ) : posts.length === 0 ? (
        <div className="px-4 sm:px-0">
          <EmptyState
            title="No posts yet"
            description="Be the first to share something with the Universe — it's free."
          />
        </div>
      ) : (
        <div className="space-y-3 px-4 sm:px-0">
          {posts.map((post) => (
            <PostCard
              key={post.id}
              post={post}
              state={state}
              meId={account.id}
              onLike={() => void like(post)}
              onDelete={() => void remove(post.id)}
              onBlock={() => void block(post.author_id, post.author_name)}
              onReport={() => setReport({ type: "post", id: post.id })}
              onChanged={refresh}
            />
          ))}
        </div>
      )}

      {/* Report */}
      <Dialog open={report !== null} onOpenChange={(o) => !o && setReport(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Report content</DialogTitle>
            <DialogDescription>
              Your shop admin will review this. Reports are private.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            rows={3}
            value={reportReason}
            onChange={(e) => setReportReason(e.target.value)}
            placeholder="What is wrong with this content?"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setReport(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => void submitReport()}>
              Send report
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function PostCard({
  post,
  state,
  meId,
  onLike,
  onDelete,
  onBlock,
  onReport,
  onChanged,
}: {
  post: FeedPost;
  state: SocialState | null;
  meId: string;
  onLike: () => void;
  onDelete: () => void;
  onBlock: () => void;
  onReport: () => void;
  onChanged: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [comments, setComments] = useState<FeedComment[]>([]);
  const [reply, setReply] = useState("");
  const [replyTo, setReplyTo] = useState<FeedComment | null>(null);
  const [confirmReply, setConfirmReply] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dm, setDm] = useState("");
  const [dmOpen, setDmOpen] = useState(false);
  const [hideOpen, setHideOpen] = useState(false);
  const [giftOpen, setGiftOpen] = useState(false);
  const [giftAmount, setGiftAmount] = useState("5");
  const [gifting, setGifting] = useState(false);
  const [hideReason, setHideReason] = useState("");

  const cost = commentCharge();
  const thread = threadComments(comments);

  const loadComments = async () => {
    try {
      setComments(await fetchComments(post.id));
    } catch (e) {
      toast.error("Could not load replies", { description: (e as Error).message });
    }
  };

  const openComments = async () => {
    const next = !open;
    setOpen(next);
    if (next) await loadComments();
  };

  const submitReply = async () => {
    const problem = validateCommentBody(reply);
    if (problem) {
      toast.error(problem);
      return;
    }
    setBusy(true);
    try {
      const res = await createComment(post.id, reply, replyTo?.id ?? null);
      setReply("");
      setReplyTo(null);
      setConfirmReply(false);
      toast.success("Reply posted", {
        description: res.charged > 0 ? `${res.charged} social credit deducted.` : "Free reply.",
      });
      await loadComments();
      await onChanged();
    } catch (e) {
      toast.error("Could not reply", { description: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const hideForShop = async () => {
    try {
      await hidePostForShop(post.id, true, hideReason);
      setHideOpen(false);
      setHideReason("");
      toast.success("Hidden from your shop", {
        description: "It stays public in the Universe and visible to other shops.",
      });
      await onChanged();
    } catch (e) {
      toast.error("Could not hide that post", { description: (e as Error).message });
    }
  };

  const sendDm = async () => {
    try {
      await sendMessage(post.author_id, dm);
      setDm("");
      setDmOpen(false);
      toast.success("Message sent", { description: "Continue in Messages." });
    } catch (e) {
      toast.error("Could not send", { description: (e as Error).message });
    }
  };

  /**
   * Gifts are refused client-side and server-side alike; the button is also
   * locked while a gift is in flight so a double tap cannot double-spend.
   */
  const sendGift = async () => {
    const amount = Number(giftAmount);
    const issue = giftIssue({
      purchased_balance: state?.purchased_balance ?? 0,
      amount,
      isSelf: post.author_id === meId,
    });
    if (issue) {
      toast.error(issue);
      return;
    }
    setGifting(true);
    try {
      const res = await giftSocialCredits({ postId: post.id, amount });
      setGiftOpen(false);
      toast.success(`Gifted ${res.amount} social credits to ${post.author_name}`, {
        description: `You have ${res.purchased_balance} purchased social credits left.`,
      });
      await onChanged();
    } catch (e) {
      toast.error("Could not send the gift", { description: (e as Error).message });
    } finally {
      setGifting(false);
    }
  };

  return (
    <Card className="shadow-[var(--shadow-card)]">
      <CardContent className="space-y-3">
        <div className="flex items-start gap-3">
          <AuthorLink handle={post.author_handle}>
            <MemberAvatar path={post.author_avatar} name={post.author_name} />
          </AuthorLink>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <AuthorLink handle={post.author_handle}>
                <span className="truncate text-sm font-semibold hover:underline">
                  {post.author_name}
                </span>
              </AuthorLink>
              {post.author_handle ? (
                <AuthorLink handle={post.author_handle}>
                  <span className="truncate text-xs font-medium text-primary hover:underline">
                    {displayHandle(post.author_handle)}
                  </span>
                </AuthorLink>
              ) : null}
              <span className="text-xs text-muted-foreground">
                · {relativeTime(post.created_at)}
              </span>
              {post.promoted ? (
                <Badge className="bg-primary text-primary-foreground">
                  {post.promotion_tier_name ? `${post.promotion_tier_name} · Promoted` : "Promoted"}
                </Badge>
              ) : null}
              {post.audience === "general" ? (
                <Badge variant="outline" className="gap-1">
                  <Globe2 className="size-3" aria-hidden /> General
                  {post.origin_ecosystem_name ? ` · from ${post.origin_ecosystem_name}` : ""}
                </Badge>
              ) : post.origin_ecosystem_name ? (
                <Badge variant="outline">{post.origin_ecosystem_name}</Badge>
              ) : null}
              <RoleBadge role={post.author_role} />
            </div>
            <MentionText body={post.body} className="mt-1" />

            {post.audience === "general" && post.author_id === meId ? (
              <GeneralStatus postId={post.id} />
            ) : null}
          </div>
        </div>

        {post.image_path ? <PostImage path={post.image_path} /> : null}

        <div className="flex flex-wrap items-center gap-1">
          <Button variant="ghost" size="sm" className="h-10 gap-1.5" onClick={onLike}>
            <Heart
              className={post.liked_by_me ? "size-4 fill-destructive text-destructive" : "size-4"}
            />
            {post.like_count}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-10 gap-1.5"
            onClick={() => void openComments()}
          >
            <MessageCircle className="size-4" />
            {post.comment_count}
          </Button>
          {post.author_id !== meId ? (
            <>
              <Button variant="ghost" size="sm" className="h-10" onClick={() => setDmOpen(true)}>
                <Send className="size-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-10 gap-1.5"
                disabled={!canGift(state, false)}
                title={
                  canGift(state, false)
                    ? `Gift paid social credits to ${post.author_name}`
                    : "You have no purchased social credits. Free promotional credits cannot be gifted."
                }
                onClick={() => setGiftOpen(true)}
              >
                <Gift className="size-4" />
              </Button>
              <RelationshipMenu userId={post.author_id} name={post.author_name} />
              <Button variant="ghost" size="sm" className="h-10" onClick={onReport}>
                <Flag className="size-4" />
              </Button>
              <Button variant="ghost" size="sm" className="h-10" onClick={onBlock}>
                <ShieldOff className="size-4" />
              </Button>
            </>
          ) : null}
          {post.can_hide ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-10 gap-1.5 text-xs"
              onClick={() => setHideOpen(true)}
            >
              <EyeOff className="size-4" /> Hide from my shop
            </Button>
          ) : null}
          {post.can_delete ? (
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto h-10 text-destructive"
              onClick={onDelete}
            >
              <Trash2 className="size-4" />
            </Button>
          ) : null}
        </div>

        {open ? (
          <div className="space-y-3 border-t border-border pt-3">
            {thread.map((c) => (
              <div
                key={c.id}
                className="flex items-start gap-2"
                style={{ marginLeft: `${(c.depth - 1) * 16}px` }}
              >
                <AuthorLink handle={c.author_handle}>
                  <MemberAvatar path={c.author_avatar} name={c.author_name} className="size-8" />
                </AuthorLink>
                <div className="min-w-0 flex-1">
                  <div className="rounded-xl bg-muted px-3 py-2">
                    <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                      <AuthorLink handle={c.author_handle}>
                        <span className="font-semibold text-foreground hover:underline">
                          {c.author_name}
                        </span>
                      </AuthorLink>
                      {c.author_handle ? (
                        <AuthorLink handle={c.author_handle}>
                          <span className="text-primary hover:underline">
                            {displayHandle(c.author_handle)}
                          </span>
                        </AuthorLink>
                      ) : null}
                      <span>· {relativeTime(c.created_at)}</span>
                    </div>
                    <MentionText body={c.body} />
                  </div>
                  {canReplyTo(c.depth) ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 gap-1 px-2 text-xs"
                      onClick={() => setReplyTo(c)}
                    >
                      <Reply className="size-3.5" /> Reply
                    </Button>
                  ) : (
                    <p className="px-2 py-1 text-xs text-muted-foreground">
                      Replies stop at three levels
                    </p>
                  )}
                </div>
                {c.can_delete ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 text-destructive"
                    onClick={() => {
                      void deleteComment(c.id)
                        .then(loadComments)
                        .catch((e: Error) => toast.error(e.message));
                    }}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                ) : null}
              </div>
            ))}

            {replyTo ? (
              <div className="flex items-center justify-between rounded-lg bg-accent px-3 py-1.5 text-xs">
                <span className="truncate">Replying to {replyTo.author_name}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2"
                  onClick={() => setReplyTo(null)}
                >
                  <X className="size-3.5" />
                </Button>
              </div>
            ) : null}

            <div className="flex items-end gap-2">
              <MentionInput
                className="flex-1"
                rows={1}
                value={reply}
                onChange={setReply}
                maxLength={COMMENT_MAX_CHARS}
                placeholder="Reply (free) — type @ to mention"
              />
              <Button
                className="h-11"
                disabled={!reply.trim() || busy}
                onClick={() => (cost > 0 ? setConfirmReply(true) : void submitReply())}
              >
                <Send className="size-4" />
              </Button>
            </div>
          </div>
        ) : null}
      </CardContent>

      <AlertDialog open={confirmReply} onOpenChange={setConfirmReply}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Post this reply?</AlertDialogTitle>
            <AlertDialogDescription>{chargeSummary(cost, "social")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(e) => {
                e.preventDefault();
                void submitReply();
              }}
            >
              Reply
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={hideOpen} onOpenChange={setHideOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Hide this post from your shop?</DialogTitle>
            <DialogDescription>
              Your members will no longer see it. The post stays published in the Universe and
              visible to other shops — only the platform owner can delete it for everyone. Your name
              and reason are recorded.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor={`hide-${post.id}`}>Reason (optional)</Label>
            <Textarea
              id={`hide-${post.id}`}
              rows={2}
              value={hideReason}
              onChange={(e) => setHideReason(e.target.value)}
              placeholder="Why is this not suitable for your members?"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setHideOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void hideForShop()}>Hide for my shop</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={giftOpen} onOpenChange={setGiftOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Gift social credits to {post.author_name}</DialogTitle>
            <DialogDescription>
              Only purchased social credits can be gifted. Free promotional credits can never be
              sent to anyone. This does not touch any shop wallet, cashback or earnings.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor={`gift-${post.id}`}>Amount</Label>
            <Input
              id={`gift-${post.id}`}
              inputMode="numeric"
              value={giftAmount}
              onChange={(e) => setGiftAmount(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              You have {state?.purchased_balance ?? 0} purchased social credits.
            </p>
            {giftIssue({
              purchased_balance: state?.purchased_balance ?? 0,
              amount: Number(giftAmount),
              isSelf: false,
            }) ? (
              <p className="text-xs font-medium text-destructive">
                {giftIssue({
                  purchased_balance: state?.purchased_balance ?? 0,
                  amount: Number(giftAmount),
                  isSelf: false,
                })}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setGiftOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={
                gifting ||
                giftIssue({
                  purchased_balance: state?.purchased_balance ?? 0,
                  amount: Number(giftAmount),
                  isSelf: false,
                }) !== null
              }
              onClick={() => void sendGift()}
            >
              {gifting ? <Loader2 className="size-4 animate-spin" /> : <Gift className="size-4" />}
              Send gift
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dmOpen} onOpenChange={setDmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Message {post.author_name}</DialogTitle>
            <DialogDescription>
              Private one-to-one message inside your shop. Direct messages are free.
            </DialogDescription>
          </DialogHeader>
          <Textarea rows={3} value={dm} onChange={(e) => setDm(e.target.value)} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setDmOpen(false)}>
              Cancel
            </Button>
            <Button disabled={!dm.trim()} onClick={() => void sendDm()}>
              Send
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

/**
 * Author-facing distribution status of their own General post.
 * Shows shop names and decisions only — private admin notes are never returned.
 */
function GeneralStatus({ postId }: { postId: string }) {
  const [rows, setRows] = useState<DistributionStatus[] | null>(null);
  const [open, setOpen] = useState(false);

  const load = async () => {
    setOpen(true);
    if (rows) return;
    try {
      setRows(await fetchDistributionStatus(postId));
    } catch (e) {
      toast.error("Could not load sharing status", { description: (e as Error).message });
    }
  };

  if (!open) {
    return (
      <Button
        variant="ghost"
        size="sm"
        className="mt-1 h-8 px-0 text-xs"
        onClick={() => void load()}
      >
        Where is this shared?
      </Button>
    );
  }

  return (
    <div className="mt-2 rounded-xl bg-muted p-2 text-xs">
      {rows === null ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : (
        <>
          <p className="font-medium">{distributionSummary(rows)}</p>
          <ul className="mt-1 space-y-0.5 text-muted-foreground">
            {rows.map((r) => (
              <li key={r.ecosystem_name}>
                {r.ecosystem_name} —{" "}
                {r.status === "approved"
                  ? "approved"
                  : r.status === "rejected"
                    ? "not approved"
                    : "waiting for approval"}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
