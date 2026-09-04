import {
  Globe2,
  Heart,
  Loader2,
  MapPin,
  MessageCircle,
  Reply,
  Send,
  Trash2,
  X,
} from "lucide-react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { UniverseComposer } from "@/components/social/universe-composer";
import { StyledPostBody } from "@/components/social/composer-pickers";
import { PostLinkCard } from "@/components/social/post-link-card";
import {
  feelingPhrase,
  postLinkKey,
  readPostMeta,
  styleApplies,
  type PostLink,
} from "@/lib/post-meta";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui-kit";
import { MemberAvatar } from "@/components/member-avatar";
import { displayHandle } from "@/lib/profile";
import { useSession } from "@/lib/session";
import {
  COMMENT_MAX_CHARS,
  availableTiers,
  createComment,
  deleteComment,
  deletePost,
  distributionSummary,
  fetchComments,
  fetchDistributionStatus,
  fetchFeed,
  fetchLinkCards,
  fetchSocialState,
  openThread,
  relativeTime,
  reportContent,
  setBlocked,
  socialImageUrl,
  toggleLike,
  validateCommentBody,
  type FeedComment,
  type FeedPost,
  type LinkCard,
  type DistributionStatus,
  type PromotionTier,
  type SocialState,
} from "@/lib/social";
import { canReplyTo, hidePostForShop, sendMessage, threadComments } from "@/lib/social";
import { PostMemberMenu } from "@/components/social/post-member-menu";
import { PostImageLightbox } from "@/components/social/post-image-lightbox";
import { UniverseSendCoinsSheet } from "@/components/wallet/universe-send-coins-sheet";
import { fetchWalletView } from "@/lib/wallet";
import type { UniverseRecipient } from "@/lib/universe-transfer";
import { MentionText } from "@/components/social/mention-text";
import { RoleBadge } from "@/components/role-badge";
import { MentionInput } from "@/components/social/mention-input";

/** Signed-image thumbnail for a post; tapping it opens the full-size viewer. */
function PostImage({ path }: { path: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [viewerOpen, setViewerOpen] = useState(false);
  useEffect(() => {
    let active = true;
    void socialImageUrl(path).then((u) => active && setUrl(u));
    return () => {
      active = false;
    };
  }, [path]);
  if (!url) return <div className="aspect-4/3 w-full animate-pulse rounded-xl bg-muted" />;
  return (
    <>
      <button
        type="button"
        className="block w-full cursor-zoom-in overflow-hidden rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label="View full photo"
        onClick={() => setViewerOpen(true)}
      >
        <img
          src={url}
          alt="Post attachment"
          loading="lazy"
          className="aspect-4/3 w-full object-cover"
        />
      </button>
      <PostImageLightbox url={url} open={viewerOpen} onOpenChange={setViewerOpen} />
    </>
  );
}

/** Signed-url video for a post; metadata only until the member presses play. */
function PostVideo({ path }: { path: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void socialImageUrl(path).then((u) => active && setUrl(u));
    return () => {
      active = false;
    };
  }, [path]);
  if (!url) return <div className="aspect-video w-full animate-pulse rounded-xl bg-muted" />;
  return (
    <video
      src={url}
      controls
      playsInline
      preload="metadata"
      className="aspect-video w-full rounded-xl bg-image-scrim object-contain"
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

/**
 * Universe feed. Without `hashtag` it is the Home feed with the composer on
 * top; with `hashtag` it lists only posts carrying that tag (no composer).
 */
export function SocialPage({ hashtag }: { hashtag?: string } = {}) {
  const session = useSession();
  const account = session.account;
  const [state, setState] = useState<SocialState | null>(null);
  const [posts, setPosts] = useState<FeedPost[]>([]);
  // Linked shops/products resolved to current storefront data, keyed by reference.
  const [linkCards, setLinkCards] = useState<Map<string, LinkCard>>(new Map());
  const [loading, setLoading] = useState(true);

  // reporting
  const [report, setReport] = useState<{ type: "post" | "comment"; id: string } | null>(null);
  const [reportReason, setReportReason] = useState("");

  const refresh = useCallback(async () => {
    try {
      const [s, f] = await Promise.all([fetchSocialState(), fetchFeed(undefined, hashtag ?? null)]);
      setState(s);
      setPosts(f);
      const links = f
        .map((p) => readPostMeta(p.meta).link)
        .filter((l): l is PostLink => Boolean(l));
      if (links.length > 0) {
        // Cards are a nice-to-have: a lookup failure never blocks the feed.
        fetchLinkCards(links)
          .then(setLinkCards)
          .catch(() => setLinkCards(new Map()));
      } else {
        setLinkCards(new Map());
      }
    } catch (e) {
      toast.error("Could not load the community feed", { description: (e as Error).message });
    } finally {
      setLoading(false);
    }
  }, [hashtag]);

  // Keyed on the member id, never the account object: a fresh object per
  // render would re-run this after every state update refresh() itself makes.
  const accountId = account?.id ?? null;
  useEffect(() => {
    if (!accountId) return;
    setLoading(true);
    void refresh();
  }, [accountId, refresh]);

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
      {state && !hashtag ? (
        <UniverseComposer
          state={state}
          tiers={tiers}
          userId={account.id}
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
              linkCards={linkCards}
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
  linkCards,
  onLike,
  onDelete,
  onBlock,
  onReport,
  onChanged,
}: {
  post: FeedPost;
  state: SocialState | null;
  meId: string;
  linkCards?: Map<string, LinkCard>;
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
  const [busy, setBusy] = useState(false);
  const [dm, setDm] = useState("");
  const [dmOpen, setDmOpen] = useState(false);
  const [hideOpen, setHideOpen] = useState(false);
  const [hideReason, setHideReason] = useState("");
  const [dmOpening, setDmOpening] = useState(false);
  // "Gift Social Credit": the EXISTING global Universe Wallet coin transfer,
  // pre-addressed to the poster. No shop, no upline, no cashback — a
  // wallet-to-wallet move.
  const [coinsOpen, setCoinsOpen] = useState(false);
  const [coinsBalance, setCoinsBalance] = useState(0);
  const navigate = useNavigate();

  const coinsRecipient: UniverseRecipient | null = post.author_id
    ? {
        id: post.author_id,
        full_name: post.author_name,
        handle: post.author_handle,
        avatar_path: post.author_avatar,
      }
    : null;

  const loadCoinsBalance = async () => {
    const view = await fetchWalletView(meId, null).catch(() => null);
    setCoinsBalance(view?.balance ?? 0);
  };

  const openSendCoins = async () => {
    if (!coinsRecipient) return;
    await loadCoinsBalance();
    setCoinsOpen(true);
  };

  const thread = threadComments(comments);
  const meta = readPostMeta(post.meta);
  const linkCard = meta.link ? (linkCards?.get(postLinkKey(meta.link)) ?? null) : null;
  const styled = styleApplies({
    style: meta.style,
    body: post.body,
    hasMedia: Boolean(post.image_path || post.video_path),
  });

  /** "Message me" invite: opens (or creates) the existing private thread and jumps to Messages. */
  const openDm = async () => {
    setDmOpening(true);
    try {
      const threadId = await openThread(post.author_id);
      await navigate({ to: "/universe/messages", search: { thread: threadId } });
    } catch (e) {
      toast.error("Could not open the conversation", { description: (e as Error).message });
    } finally {
      setDmOpening(false);
    }
  };

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
      toast.success("Reply posted");
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
            {meta.feeling || meta.location ? (
              <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
                {meta.feeling ? (
                  <span>
                    {feelingPhrase(meta.feeling)} <span aria-hidden>{meta.feeling.emoji}</span>
                  </span>
                ) : null}
                {meta.location ? (
                  <span className="inline-flex items-center gap-1">
                    {meta.feeling ? "·" : null}
                    <MapPin className="size-3.5 text-primary" aria-hidden />
                    {typeof meta.location.lat === "number" &&
                    typeof meta.location.lng === "number" ? (
                      <a
                        href={`https://www.openstreetmap.org/?mlat=${meta.location.lat}&mlon=${meta.location.lng}#map=13/${meta.location.lat}/${meta.location.lng}`}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="hover:underline"
                      >
                        {meta.location.label}
                      </a>
                    ) : (
                      <span>{meta.location.label}</span>
                    )}
                  </span>
                ) : null}
              </p>
            ) : null}
            {styled && meta.style ? null : post.body.trim() ? (
              <MentionText body={post.body} className="mt-1" />
            ) : null}

            {post.audience === "general" && post.author_id === meId ? (
              <GeneralStatus postId={post.id} />
            ) : null}
          </div>
        </div>

        {styled && meta.style ? <StyledPostBody body={post.body} styleId={meta.style} /> : null}
        {post.image_path ? <PostImage path={post.image_path} /> : null}
        {post.video_path ? <PostVideo path={post.video_path} /> : null}
        {linkCard ? <PostLinkCard card={linkCard} /> : null}

        {meta.dm_invite && post.author_id !== meId ? (
          <Button
            variant="outline"
            className="h-11 w-full gap-2 rounded-xl border-primary/40 text-primary"
            disabled={dmOpening}
            onClick={() => void openDm()}
          >
            {dmOpening ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <MessageCircle className="size-4" />
            )}
            Message {post.author_name.split(" ")[0]} privately
          </Button>
        ) : null}

        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-10 gap-1.5"
            aria-label={post.liked_by_me ? "Unlike" : "Like"}
            onClick={onLike}
          >
            <Heart
              className={post.liked_by_me ? "size-4 fill-destructive text-destructive" : "size-4"}
            />
            {post.like_count}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-10 gap-1.5"
            aria-label="Replies"
            onClick={() => void openComments()}
          >
            <MessageCircle className="size-4" />
            {post.comment_count}
          </Button>
          <div className="ml-auto">
            <PostMemberMenu
              authorId={post.author_id}
              authorName={post.author_name}
              authorHandle={post.author_handle}
              isSelf={post.author_id === meId}
              onMessage={() => void openDm()}
              onQuickMessage={() => setDmOpen(true)}
              onSendCoins={() => void openSendCoins()}
              onGift={() => setGiftOpen(true)}
              giftDisabledReason={
                canGift(state, false)
                  ? null
                  : "You have no purchased social credits. Free promotional credits cannot be gifted."
              }
              onReport={onReport}
              onBlock={onBlock}
              {...(post.can_hide ? { onHideForShop: () => setHideOpen(true) } : {})}
              {...(post.can_delete ? { onDelete } : {})}
            />
          </div>
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
                onClick={() => void submitReply()}
              >
                <Send className="size-4" />
              </Button>
            </div>
          </div>
        ) : null}
      </CardContent>

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

      {coinsRecipient ? (
        <UniverseSendCoinsSheet
          open={coinsOpen}
          onOpenChange={setCoinsOpen}
          senderId={meId}
          balance={coinsBalance}
          initialRecipient={coinsRecipient}
          onSent={loadCoinsBalance}
        />
      ) : null}

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
