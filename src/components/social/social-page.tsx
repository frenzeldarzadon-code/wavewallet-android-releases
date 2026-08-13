import {
  Coins,
  Flag,
  Heart,
  ImagePlus,
  Loader2,
  MessageCircle,
  Megaphone,
  Send,
  ShieldOff,
  Trash2,
  X,
} from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState, PageSection } from "@/components/ui-kit";
import { ImageCropper } from "@/components/image-cropper";
import { MemberAvatar } from "@/components/member-avatar";
import { displayHandle } from "@/lib/profile";
import { useSession } from "@/lib/session";
import type { CropRect } from "@/lib/image-optimize";
import {
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
  exchangeForSocialCredits,
  exchangeGain,
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
  type PostAudience,
  type PromotionTier,
  type SocialCurrency,
  type SocialState,
} from "@/lib/social";
import { sendMessage } from "@/lib/social";


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

export function SocialPage() {
  const session = useSession();
  const account = session.account;
  const [state, setState] = useState<SocialState | null>(null);
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [loading, setLoading] = useState(true);

  // composer
  const [body, setBody] = useState("");
  const [promote, setPromote] = useState(false);
  const [audience, setAudience] = useState<PostAudience>("ecosystem");

  const [tierId, setTierId] = useState<string>("");
  const [payWith, setPayWith] = useState<SocialCurrency>("social");
  const [file, setFile] = useState<File | null>(null);
  const [crop, setCrop] = useState<{ image: HTMLImageElement; crop: CropRect } | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [posting, setPosting] = useState(false);

  // exchange
  const [exchangeOpen, setExchangeOpen] = useState(false);
  const [exchangeKind, setExchangeKind] = useState<"credit" | "points">("credit");
  const [exchangeAmount, setExchangeAmount] = useState("1");
  const [exchanging, setExchanging] = useState(false);

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
    () => (state ? availableTiers({ promotion_tiers: state.promotion_tiers, role: account?.role ?? null }) : []),
    [state, account?.role],
  );
  const tier = useMemo(() => tiers.find((t) => t.id === tierId) ?? null, [tiers, tierId]);
  const charge = useMemo(
    () =>
      state
        ? postCharge(state, promote, tier, payWith)
        : { amount: 0, currency: "social" as SocialCurrency },
    [state, promote, tier, payWith],
  );

  useEffect(() => {
    if (promote && !tierId && tiers.length > 0) setTierId(tiers[0]!.id);
  }, [promote, tierId, tiers]);

  if (!account) return null;

  const pickFile = (f: File | null) => {
    if (!f) {
      setFile(null);
      setCrop(null);
      return;
    }
    const problem = validateSocialImage(f);
    if (problem) {
      toast.error(problem);
      return;
    }
    setFile(f);
  };

  const submitPost = async () => {
    if (!state) return;
    const problem = validatePostBody(body);
    if (problem) {
      toast.error(problem);
      return;
    }
    setPosting(true);
    try {
      let imagePath: string | null = null;
      if (file && crop) {
        imagePath = await uploadSocialImage({
          ecosystemId: state.ecosystem_id,
          userId: account.id,
          file,
          crop: crop.crop,
          preloaded: crop.image,
        });
      }
      const res = await createPost({
        body,
        imagePath,
        promote,
        tierId: promote ? (tier?.id ?? null) : null,
        ...(promote ? { currency: charge.currency } : {}),
        audience,
      });
      const deducted =
        res.charged > 0
          ? `${res.charged} ${res.currency === "points" ? "points" : "social credits"} deducted.`
          : "Nothing was deducted.";
      toast.success(promote ? "Promoted post published" : "Posted", {
        description:
          audience === "general"
            ? `${deducted} Sent to ${res.pending_shops} other shop${res.pending_shops === 1 ? "" : "s"} for admin approval.`
            : deducted,
      });
      setBody("");
      setPromote(false);
      setAudience("ecosystem");

      setTierId("");
      setFile(null);
      setCrop(null);
      setConfirmOpen(false);
      await refresh();
    } catch (e) {
      toast.error("Could not publish", { description: (e as Error).message });
    } finally {
      setPosting(false);
    }
  };

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
      toast.success(`${name} is blocked`, { description: "You will not see each other's content." });
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

  const runExchange = async () => {
    const amount = Number(exchangeAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error("Enter how much you want to exchange");
      return;
    }
    setExchanging(true);
    try {
      const res = await exchangeForSocialCredits(exchangeKind, Math.trunc(amount));
      toast.success(`+${res.granted} social credits`, {
        description: "Social credits cannot be exchanged back.",
      });
      setExchangeOpen(false);
      session.reload();
      await refresh();
    } catch (e) {
      toast.error("Exchange failed", { description: (e as Error).message });
    } finally {
      setExchanging(false);
    }
  };

  const affordable = state
    ? canAfford(state, charge, account.pointsBalance ?? 0)
    : false;

  return (
    <>
      <PageSection
        title="Community"
        description={`Share updates and promote your products with other ${session.ecosystem?.name ?? "shop"} members.`}
      >
        <Card className="shadow-[var(--shadow-card)]">
          <CardContent className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm">
                <Coins className="size-4 text-success" aria-hidden />
                <span className="font-semibold">{state?.balance ?? "—"} social credits</span>
                <span className="text-muted-foreground">
                  · {state?.daily_allowance ?? 5} free daily
                </span>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9"
                  onClick={() => setExchangeOpen(true)}
                >
                  Get more
                </Button>
              </div>
            </div>

            <Textarea
              value={body}
              onChange={(e) => setBody(e.target.value.slice(0, POST_MAX_CHARS))}
              rows={3}
              placeholder="Share something with your shop…"
              className="min-h-24 text-base"
            />

            {file ? (
              <div className="space-y-2">
                <ImageCropper file={file} aspect={SOCIAL_IMAGE_ASPECT} onChange={setCrop} />
                <Button variant="ghost" size="sm" onClick={() => pickFile(null)}>
                  <X className="size-4" /> Remove photo
                </Button>
              </div>
            ) : null}

            <div className="flex flex-wrap items-center gap-2">
              <Label
                htmlFor="socialPhoto"
                className="inline-flex h-11 cursor-pointer items-center gap-2 rounded-xl border border-border px-3 text-sm font-medium"
              >
                <ImagePlus className="size-4" /> Photo
              </Label>
              <Input
                id="socialPhoto"
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
              />

              {state?.promotion_enabled && tiers.length > 0 ? (
                <label className="inline-flex h-11 items-center gap-2 rounded-xl border border-border px-3 text-sm font-medium">
                  <Megaphone className="size-4 text-primary" aria-hidden />
                  Promote
                  <Switch checked={promote} onCheckedChange={setPromote} aria-label="Promote this post" />
                </label>
              ) : null}

              <Button
                className="ml-auto h-11"
                disabled={!body.trim() || posting}
                onClick={() => setConfirmOpen(true)}
              >
                <Send className="size-4" /> Post
              </Button>
            </div>

            {promote && tiers.length > 0 ? (
              <div className="grid gap-2 rounded-xl border border-primary/40 bg-primary/5 p-3 sm:grid-cols-2">
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="promoTier">Promotion type</Label>
                  <Select value={tierId} onValueChange={setTierId}>
                    <SelectTrigger id="promoTier" className="h-11">
                      <SelectValue placeholder="Choose a promotion" />
                    </SelectTrigger>
                    <SelectContent>
                      {tiers.map((t) => (
                        <SelectItem key={t.id} value={t.id}>
                          {t.name} · {tierDuration(t.duration_hours)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {tier?.description ? (
                    <p className="text-xs text-muted-foreground">{tier.description}</p>
                  ) : null}
                </div>
                {tier?.currency === "both" ? (
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label>Pay with</Label>
                    <div className="grid grid-cols-2 gap-2">
                      <Button
                        type="button"
                        variant={payWith === "social" ? "default" : "outline"}
                        className="h-11"
                        onClick={() => setPayWith("social")}
                      >
                        {tier.price_social} social credits
                      </Button>
                      <Button
                        type="button"
                        variant={payWith === "points" ? "default" : "outline"}
                        className="h-11"
                        onClick={() => setPayWith("points")}
                      >
                        {tier.price_points} points
                      </Button>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}

            <p className="text-xs text-muted-foreground">
              {promote
                ? `${tier?.name ?? "Promotion"} costs ${charge.amount} ${charge.currency === "points" ? "points" : "social credits"} and stays highlighted for ${tierDuration(tier?.duration_hours ?? 24)}. Replies to a promoted post are free for everyone — only you pay.`
                : `A normal post costs ${state?.post_cost ?? 1} social credit. Likes are always free; replies cost ${state?.comment_cost ?? 1} social credit unless the post is promoted.`}
            </p>
          </CardContent>
        </Card>
      </PageSection>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading the feed…</p>
      ) : posts.length === 0 ? (
        <EmptyState
          title="No posts yet"
          description="Be the first to share something with your shop community."
        />
      ) : (
        <div className="space-y-3">
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

      {/* Post confirmation — always states exactly what will be deducted. */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{promote ? "Publish a promoted post?" : "Publish this post?"}</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>{chargeSummary(charge.amount, charge.currency)}</p>
                <p>
                  Balance: {state?.balance ?? 0} social credits
                  {charge.currency === "points" ? ` · ${account.pointsBalance ?? 0} points` : ""}
                </p>
                {promote ? (
                  <>
                    <p>
                      Promotion: <strong>{tier?.name ?? "Promoted"}</strong> ·{" "}
                      {tierDuration(tier?.duration_hours ?? 24)} · paid in{" "}
                      {charge.currency === "points" ? "points" : "social credits"}.
                    </p>
                    <p>
                      Your post will be labelled <strong>Promoted</strong>. Only you pay this fee —
                      replies and comments on a promoted post do not consume social credits from the
                      members replying.
                    </p>
                  </>
                ) : (
                  <p>Likes are free. Replies to this post cost {state?.comment_cost ?? 1} social credit.</p>
                )}
                {!affordable ? (
                  <p className="font-medium text-destructive">
                    You do not have enough {charge.currency === "points" ? "points" : "social credits"}.
                  </p>
                ) : null}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Don't post</AlertDialogCancel>
            <AlertDialogAction
              disabled={posting || !affordable}
              onClick={(e) => {
                e.preventDefault();
                void submitPost();
              }}
            >
              {posting ? <Loader2 className="size-4 animate-spin" /> : null}
              {promote ? "Promote & publish" : "Publish"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Exchange */}
      <Dialog open={exchangeOpen} onOpenChange={setExchangeOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Get more social credits</DialogTitle>
            <DialogDescription>
              Exchange wallet credits or points for social credits. This is one-way — social credits
              can never be converted back into credits or points.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <Button
                variant={exchangeKind === "credit" ? "default" : "outline"}
                className="h-11"
                onClick={() => setExchangeKind("credit")}
              >
                Wallet credits
              </Button>
              <Button
                variant={exchangeKind === "points" ? "default" : "outline"}
                className="h-11"
                onClick={() => setExchangeKind("points")}
              >
                Points
              </Button>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="exchangeAmount">
                {exchangeKind === "credit" ? "Wallet credits to spend" : "Points to spend"}
              </Label>
              <Input
                id="exchangeAmount"
                inputMode="numeric"
                value={exchangeAmount}
                onChange={(e) => setExchangeAmount(e.target.value.replace(/[^0-9]/g, ""))}
                className="h-11"
              />
            </div>
            <p className="text-sm text-muted-foreground">
              You will receive{" "}
              <strong className="text-success">
                {state ? exchangeGain(state, exchangeKind, Number(exchangeAmount || 0)) : 0}
              </strong>{" "}
              social credits. Available:{" "}
              {exchangeKind === "credit"
                ? `${account.creditBalance ?? 0} credits`
                : `${account.pointsBalance ?? 0} points`}
              .
            </p>
            {state?.ads_enabled ? (
              <p className="text-xs text-muted-foreground">
                Rewarded ads grant {state.ad_reward_amount} social credits after a verified completed
                ad ({state.ads_claimed_today}/{state.ad_daily_limit} claimed today).
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Watch-an-ad rewards are not available yet — the platform owner has not enabled a
                verified rewarded-ad provider.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setExchangeOpen(false)}>
              Cancel
            </Button>
            <Button disabled={exchanging} onClick={() => void runExchange()}>
              {exchanging ? <Loader2 className="size-4 animate-spin" /> : null} Exchange
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
  const [confirmReply, setConfirmReply] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dm, setDm] = useState("");
  const [dmOpen, setDmOpen] = useState(false);

  const cost = state ? commentCharge(state, post.promoted) : 1;

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
      const res = await createComment(post.id, reply);
      setReply("");
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
          <MemberAvatar path={post.author_avatar} name={post.author_name} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="truncate text-sm font-semibold">{post.author_name}</span>
              {post.author_handle ? (
                <span className="truncate text-xs text-muted-foreground">
                  {displayHandle(post.author_handle)}
                </span>
              ) : null}
              <span className="text-xs text-muted-foreground">· {relativeTime(post.created_at)}</span>
              {post.promoted ? (
                <Badge className="bg-primary text-primary-foreground">
                  {post.promotion_tier_name ? `${post.promotion_tier_name} · Promoted` : "Promoted"}
                </Badge>
              ) : null}
            </div>
            <p className="mt-1 whitespace-pre-wrap break-words text-sm">{post.body}</p>
          </div>
        </div>

        {post.image_path ? <PostImage path={post.image_path} /> : null}

        <div className="flex flex-wrap items-center gap-1">
          <Button variant="ghost" size="sm" className="h-10 gap-1.5" onClick={onLike}>
            <Heart className={post.liked_by_me ? "size-4 fill-destructive text-destructive" : "size-4"} />
            {post.like_count}
          </Button>
          <Button variant="ghost" size="sm" className="h-10 gap-1.5" onClick={() => void openComments()}>
            <MessageCircle className="size-4" />
            {post.comment_count}
          </Button>
          {post.author_id !== meId ? (
            <>
              <Button variant="ghost" size="sm" className="h-10" onClick={() => setDmOpen(true)}>
                <Send className="size-4" />
              </Button>
              <Button variant="ghost" size="sm" className="h-10" onClick={onReport}>
                <Flag className="size-4" />
              </Button>
              <Button variant="ghost" size="sm" className="h-10" onClick={onBlock}>
                <ShieldOff className="size-4" />
              </Button>
            </>
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
            {comments.map((c) => (
              <div key={c.id} className="flex items-start gap-2">
                <MemberAvatar path={c.author_avatar} name={c.author_name} className="size-8" />
                <div className="min-w-0 flex-1 rounded-xl bg-muted px-3 py-2">
                  <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                    <span className="font-semibold text-foreground">{c.author_name}</span>
                    {c.author_handle ? <span>{displayHandle(c.author_handle)}</span> : null}
                    <span>· {relativeTime(c.created_at)}</span>
                  </div>
                  <p className="whitespace-pre-wrap break-words text-sm">{c.body}</p>
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

            <div className="flex items-end gap-2">
              <Textarea
                rows={1}
                value={reply}
                onChange={(e) => setReply(e.target.value.slice(0, COMMENT_MAX_CHARS))}
                placeholder={cost > 0 ? `Reply (costs ${cost} social credit)` : "Reply (free)"}
                className="min-h-11"
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
            <AlertDialogDescription>
              {chargeSummary(cost, "social")} You have {state?.balance ?? 0} social credits.
            </AlertDialogDescription>
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
