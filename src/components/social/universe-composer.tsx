/**
 * Universe inline composer.
 *
 * Collapsed, it is a single tappable line. Tapping anywhere expands it in
 * place, focuses the text field and reveals the tool list. Nothing is
 * uploaded or saved until the member presses Post; the database re-checks
 * every rule on submit and posting stays free.
 */
import {
  AtSign,
  Check,
  ChevronDown,
  Globe2,
  Hash,
  ImagePlus,
  Loader2,
  MapPin,
  Megaphone,
  MessageCircle,
  Palette,
  Send,
  SmilePlus,
  Store,
  Users,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useSession } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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
import { ImageCropper } from "@/components/image-cropper";
import { MemberAvatar } from "@/components/member-avatar";
import { MentionInput, type MentionInputHandle } from "@/components/social/mention-input";
import {
  FeelingPicker,
  LocationPicker,
  StylePicker,
  StyledPostBody,
  TagPicker,
} from "@/components/social/composer-pickers";
import {
  PROMOTION_NOTICE,
  canPostAsRegular,
  detectPromotion,
  detectionExplanation,
  promotionGate,
} from "@/lib/promotion-detection";
import type { CropRect } from "@/lib/image-optimize";
import { fetchMyProfile } from "@/lib/profile";
import {
  compactMeta,
  composerHasContent,
  composerIsDirty,
  feelingPhrase,
  postStyle,
  styleApplies,
  type PostMeta,
} from "@/lib/post-meta";
import {
  POST_MAX_CHARS,
  SOCIAL_IMAGE_ASPECT,
  audienceHelp,
  audienceLabel,
  audienceSummary,
  createPost,
  fetchTargetShops,
  tierDuration,
  uploadSocialImage,
  uploadSocialVideo,
  validateSocialImage,
  validateSocialVideo,
  type PostAudience,
  type PromotionTier,
  type SocialState,
  type TargetShop,
} from "@/lib/social";
import { cn } from "@/lib/utils";

type Picker = "location" | "feeling" | "style" | "tags" | null;

export function UniverseComposer({
  state,
  tiers,
  userId,
  ownShopName,
  onPosted,
}: {
  state: SocialState;
  tiers: PromotionTier[];
  userId: string;
  ownShopName: string;
  onPosted: () => Promise<void> | void;
}) {
  const session = useSession();
  const authorName = session.account?.name ?? "You";
  const input = useRef<MentionInputHandle>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const [expanded, setExpanded] = useState(false);
  const [body, setBody] = useState("");
  const [image, setImage] = useState<File | null>(null);
  const [crop, setCrop] = useState<{ image: HTMLImageElement; crop: CropRect } | null>(null);
  const [video, setVideo] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [meta, setMeta] = useState<PostMeta>({});
  const [audience, setAudience] = useState<PostAudience>("ecosystem");
  const [shops, setShops] = useState<TargetShop[]>([]);
  const [shopIds, setShopIds] = useState<string[]>([]);
  const [audienceOpen, setAudienceOpen] = useState(false);
  const [promote, setPromote] = useState(false);
  const [tierId, setTierId] = useState("");
  const [ackRegular, setAckRegular] = useState(false);
  const [picker, setPicker] = useState<Picker>(null);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [posting, setPosting] = useState(false);
  const [areaSuggestion, setAreaSuggestion] = useState<string | null>(null);

  const promotionAvailable = state.promotion_enabled && tiers.length > 0;
  const tier = useMemo(() => tiers.find((t) => t.id === tierId) ?? null, [tiers, tierId]);
  const hasImage = image !== null;
  const hasVideo = video !== null;
  const hasMedia = hasImage || hasVideo;
  const hasContent = composerHasContent({ body, hasImage, hasVideo });
  const dirty = composerIsDirty({ body, hasImage, hasVideo, meta });
  const styled = styleApplies({ style: meta.style, body, hasMedia });

  const detection = useMemo(
    () => detectPromotion(body, { hasImage: hasMedia }),
    [body, hasMedia],
  );
  const promotionBlocker = promotionGate({
    detection,
    promote,
    acknowledgedRegular: ackRegular,
    packagesAvailable: promotionAvailable,
  });
  const blocker = !hasContent
    ? "Write something or add a photo or video"
    : body.trim().length > POST_MAX_CHARS
      ? `Posts can be at most ${POST_MAX_CHARS} characters`
      : audience === "shops" && shopIds.length === 0
        ? "Choose at least one shop to share with"
        : promote && !tier
          ? "Choose a promotion type"
          : promotionBlocker;

  useEffect(() => {
    setAckRegular(false);
  }, [body, hasMedia]);

  useEffect(() => {
    if (promote && !tierId && tiers.length > 0) setTierId(tiers[0]!.id);
  }, [promote, tierId, tiers]);

  // Load shops + the member's own area lazily, only once the composer opens.
  useEffect(() => {
    if (!expanded) return;
    void fetchTargetShops()
      .then(setShops)
      .catch((e: Error) => toast.error("Could not load your shops", { description: e.message }));
    void fetchMyProfile(userId)
      .then((p) => {
        const parts = [p?.city_municipality, p?.province].filter(Boolean);
        setAreaSuggestion(parts.length ? parts.join(", ") : null);
      })
      .catch(() => setAreaSuggestion(null));
  }, [expanded, userId]);

  // Object URL for the local video preview; revoked when replaced.
  useEffect(() => {
    if (!video) {
      setVideoUrl(null);
      return;
    }
    const url = URL.createObjectURL(video);
    setVideoUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [video]);

  const reset = () => {
    setExpanded(false);
    setBody("");
    setImage(null);
    setCrop(null);
    setVideo(null);
    setMeta({});
    setAudience("ecosystem");
    setShopIds([]);
    setPromote(false);
    setTierId("");
    setAckRegular(false);
    setPicker(null);
  };

  const requestClose = () => {
    if (dirty) setDiscardOpen(true);
    else reset();
  };

  const pickMedia = (f: File | null) => {
    if (!f) return;
    if (f.type.startsWith("video/")) {
      const problem = validateSocialVideo(f);
      if (problem) {
        toast.error(problem);
        return;
      }
      setImage(null);
      setCrop(null);
      setVideo(f);
      return;
    }
    const problem = validateSocialImage(f);
    if (problem) {
      toast.error(problem);
      return;
    }
    setVideo(null);
    setImage(f);
  };

  const clearMedia = () => {
    setImage(null);
    setCrop(null);
    setVideo(null);
    if (fileInput.current) fileInput.current.value = "";
  };

  const toggleShop = (id: string) =>
    setShopIds((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]));

  const submit = async () => {
    if (blocker) {
      toast.error(blocker);
      return;
    }
    if (image && !crop) {
      toast.error("Your photo is still loading — one moment");
      return;
    }
    setPosting(true);
    try {
      let imagePath: string | null = null;
      let videoPath: string | null = null;
      if (image && crop) {
        imagePath = await uploadSocialImage({
          ecosystemId: state.ecosystem_id,
          userId,
          file: image,
          crop: crop.crop,
          preloaded: crop.image,
        });
      } else if (video) {
        videoPath = await uploadSocialVideo({ ecosystemId: state.ecosystem_id, userId, file: video });
      }
      const cleanMeta = compactMeta({ ...meta, ...(hasMedia ? { style: undefined } : {}) });
      const res = await createPost({
        body,
        imagePath,
        videoPath,
        meta: cleanMeta,
        promote,
        tierId: promote ? (tier?.id ?? null) : null,
        audience,
        ...(audience === "shops" ? { shopIds } : {}),
      });
      toast.success(promote ? "Promoted post published" : "Posted", {
        description:
          audience === "general"
            ? `Free — published across the Universe (${res.live_shops} shop${res.live_shops === 1 ? "" : "s"}).`
            : "Free — nothing was deducted.",
      });
      reset();
      await onPosted();
    } catch (e) {
      toast.error("Could not publish", { description: (e as Error).message });
    } finally {
      setPosting(false);
    }
  };

  const AudienceIcon = audience === "general" ? Globe2 : audience === "shops" ? Store : Users;

  // ------------------------------------------------------------ collapsed
  if (!expanded) {
    return (
      <div className="px-4 sm:px-0">
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="flex w-full items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3 text-left shadow-[var(--shadow-card)] transition-colors hover:bg-accent/40"
          aria-label="Write a post"
        >
          <MemberAvatar name={authorName} className="size-10" />
          <span className="flex h-11 min-w-0 flex-1 items-center rounded-full bg-muted px-4 text-sm text-muted-foreground">
            What&apos;s happening?
          </span>
          <span className="hidden size-10 shrink-0 items-center justify-center rounded-full bg-brand-soft text-primary sm:flex">
            <ImagePlus className="size-5" />
          </span>
        </button>
      </div>
    );
  }

  // ------------------------------------------------------------- expanded
  return (
    <div className="px-4 sm:px-0">
      <section
        className="rounded-2xl border border-border bg-card shadow-[var(--shadow-card)]"
        onKeyDown={(e) => {
          if (e.key === "Escape" && !picker && !audienceOpen) {
            e.stopPropagation();
            requestClose();
          }
        }}
      >
        {/* Header: who + where */}
        <div className="flex items-center gap-3 px-4 pt-4">
          <MemberAvatar name={authorName} className="size-10" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">
              {authorName}
              {meta.feeling ? (
                <span className="font-normal text-muted-foreground">
                  {" "}
                  {feelingPhrase(meta.feeling)} {meta.feeling.emoji}
                </span>
              ) : null}
              {meta.location ? (
                <span className="font-normal text-muted-foreground"> · at {meta.location.label}</span>
              ) : null}
            </p>
            <Popover open={audienceOpen} onOpenChange={setAudienceOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="mt-0.5 inline-flex h-7 max-w-full items-center gap-1.5 rounded-full border border-border bg-muted/60 px-2.5 text-xs font-medium text-muted-foreground"
                >
                  <AudienceIcon className="size-3.5" aria-hidden />
                  <span className="truncate">
                    {audienceSummary(audience, shops, shopIds, ownShopName)}
                  </span>
                  <ChevronDown className="size-3.5" aria-hidden />
                </button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-80 space-y-2 rounded-2xl p-2">
                {(["general", "shops", "ecosystem"] as PostAudience[]).map((a) => {
                  const Icon = a === "general" ? Globe2 : a === "shops" ? Store : Users;
                  return (
                    <button
                      key={a}
                      type="button"
                      onClick={() => {
                        setAudience(a);
                        if (a !== "shops") setAudienceOpen(false);
                      }}
                      aria-pressed={audience === a}
                      className={cn(
                        "w-full rounded-xl border p-3 text-left",
                        audience === a ? "border-primary bg-primary/5" : "border-border",
                      )}
                    >
                      <span className="flex items-center gap-2 text-sm font-semibold">
                        <Icon className="size-4 text-primary" aria-hidden />
                        {a === "ecosystem" ? ownShopName : audienceLabel(a)}
                        {audience === a ? <Check className="ml-auto size-4 text-primary" /> : null}
                      </span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {audienceHelp(a)}
                      </span>
                    </button>
                  );
                })}
                {audience === "shops" ? (
                  <div className="space-y-1 rounded-xl border border-border p-2">
                    {shops.length === 0 ? (
                      <p className="px-1 text-xs text-muted-foreground">
                        You are not an approved member of any shop yet.
                      </p>
                    ) : (
                      shops.map((s) => (
                        <button
                          key={s.ecosystem_id}
                          type="button"
                          onClick={() => toggleShop(s.ecosystem_id)}
                          aria-pressed={shopIds.includes(s.ecosystem_id)}
                          className={cn(
                            "flex h-10 w-full items-center gap-2 rounded-lg px-2 text-left text-sm",
                            shopIds.includes(s.ecosystem_id) ? "bg-primary/5 font-medium" : "",
                          )}
                        >
                          <Store className="size-4 text-muted-foreground" aria-hidden />
                          <span className="truncate">{s.ecosystem_name}</span>
                          {s.is_current ? (
                            <Badge variant="outline" className="ml-1">
                              Current
                            </Badge>
                          ) : null}
                          {shopIds.includes(s.ecosystem_id) ? (
                            <Check className="ml-auto size-4 text-primary" />
                          ) : null}
                        </button>
                      ))
                    )}
                  </div>
                ) : null}
              </PopoverContent>
            </Popover>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="size-9 shrink-0"
            aria-label="Close composer"
            onClick={requestClose}
          >
            <X className="size-4" />
          </Button>
        </div>

        {/* Writing area */}
        <div className="px-4 pt-3">
          {styled && meta.style ? (
            <div className="relative">
              <StyledPostBody body={body} styleId={meta.style} />
              <MentionInput
                value={body}
                onChange={setBody}
                maxLength={POST_MAX_CHARS}
                rows={4}
                autoFocus
                handleRef={input}
                placeholder="What's happening?"
                className="absolute inset-0"
                textareaClassName="h-full min-h-44 resize-none border-0 bg-transparent text-center text-transparent caret-foreground shadow-none focus-visible:ring-0"
              />
            </div>
          ) : (
            <MentionInput
              value={body}
              onChange={setBody}
              maxLength={POST_MAX_CHARS}
              rows={4}
              autoFocus
              handleRef={input}
              placeholder="What's happening?"
              textareaClassName="min-h-28 resize-none border-0 bg-transparent px-0 text-lg shadow-none focus-visible:ring-0"
            />
          )}
          <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
            <span>
              {postStyle(meta.style) && !styled
                ? hasMedia
                  ? "Style is paused while media is attached"
                  : "Style applies to short text only"
                : " "}
            </span>
            <span>
              {body.length}/{POST_MAX_CHARS}
            </span>
          </div>
        </div>

        {/* Attachments */}
        {image ? (
          <div className="space-y-2 px-4 pt-2">
            <ImageCropper file={image} aspect={SOCIAL_IMAGE_ASPECT} onChange={setCrop} />
            <Button variant="ghost" size="sm" onClick={clearMedia}>
              <X className="size-4" /> Remove photo
            </Button>
          </div>
        ) : null}
        {video && videoUrl ? (
          <div className="space-y-2 px-4 pt-2">
            <video
              src={videoUrl}
              controls
              playsInline
              preload="metadata"
              className="aspect-video w-full rounded-2xl bg-image-scrim object-contain"
            />
            <div className="flex items-center justify-between">
              <p className="truncate text-xs text-muted-foreground">
                {video.name} · {(video.size / (1024 * 1024)).toFixed(1)} MB
              </p>
              <Button variant="ghost" size="sm" onClick={clearMedia}>
                <X className="size-4" /> Remove video
              </Button>
            </div>
          </div>
        ) : null}

        {/* Extras chips */}
        {meta.location || meta.feeling || meta.dm_invite ? (
          <div className="flex flex-wrap gap-1.5 px-4 pt-3">
            {meta.location ? (
              <Chip onRemove={() => setMeta((m) => ({ ...m, location: undefined }))}>
                <MapPin className="size-3.5 text-primary" /> {meta.location.label}
              </Chip>
            ) : null}
            {meta.feeling ? (
              <Chip onRemove={() => setMeta((m) => ({ ...m, feeling: undefined }))}>
                <span aria-hidden>{meta.feeling.emoji}</span> {meta.feeling.label}
              </Chip>
            ) : null}
            {meta.dm_invite ? (
              <Chip onRemove={() => setMeta((m) => ({ ...m, dm_invite: undefined }))}>
                <MessageCircle className="size-3.5 text-primary" /> Message me
              </Chip>
            ) : null}
          </div>
        ) : null}

        {/* Tools */}
        <div className="mx-4 mt-3 rounded-2xl border border-border">
          <p className="px-3 pt-2.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Add to your post
          </p>
          <div className="grid grid-cols-3 gap-1 p-2 sm:grid-cols-6">
            <Tool
              icon={<ImagePlus className="size-5 text-success" />}
              label="Photo / Video"
              active={hasMedia}
              onClick={() => fileInput.current?.click()}
            />
            <Tool
              icon={<MapPin className="size-5 text-destructive" />}
              label="Location"
              active={!!meta.location}
              onClick={() => setPicker("location")}
            />
            <Tool
              icon={<SmilePlus className="size-5 text-warning" />}
              label="Feeling"
              active={!!meta.feeling}
              onClick={() => setPicker("feeling")}
            />
            <Tool
              icon={<MessageCircle className="size-5 text-primary" />}
              label="Direct Message"
              active={!!meta.dm_invite}
              onClick={() => setMeta((m) => ({ ...m, dm_invite: !m.dm_invite }))}
            />
            <Tool
              icon={<Palette className="size-5 text-accent-foreground" />}
              label="Aa Style"
              active={!!postStyle(meta.style)}
              disabled={hasMedia}
              onClick={() => setPicker("style")}
            />
            <Tool
              icon={
                <span className="flex items-center text-primary">
                  <AtSign className="size-4" />
                  <Hash className="size-4" />
                </span>
              }
              label="Tag"
              onClick={() => setPicker("tags")}
            />
          </div>
          <Input
            ref={fileInput}
            type="file"
            accept="image/*,video/mp4,video/webm,video/quicktime"
            className="hidden"
            onChange={(e) => pickMedia(e.target.files?.[0] ?? null)}
          />
        </div>

        {/* Promotion */}
        {promotionAvailable ? (
          <div className="mx-4 mt-3 rounded-2xl border border-border p-3">
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="promoteInline" className="flex items-center gap-2 text-sm">
                <Megaphone className="size-4 text-primary" aria-hidden /> Promote this post
                <span className="text-xs font-normal text-muted-foreground">Free</span>
              </Label>
              <Switch id="promoteInline" checked={promote} onCheckedChange={setPromote} />
            </div>
            {promote ? (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {tiers.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    aria-pressed={tierId === t.id}
                    onClick={() => setTierId(t.id)}
                    className={cn(
                      "rounded-full border px-3 py-1.5 text-xs font-medium",
                      tierId === t.id ? "border-primary bg-primary/5 text-primary" : "border-border",
                    )}
                  >
                    {t.name} · {tierDuration(t.duration_hours)}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        {/* Promotion detection — same rule as before, now inline */}
        {!promote && detection.level !== "none" && promotionAvailable && hasContent ? (
          <div className="mx-4 mt-3 space-y-2 rounded-2xl border-2 border-warning/60 bg-warning/5 p-3">
            <div className="flex items-start gap-2">
              <Megaphone className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
              <div>
                <p className="text-sm font-semibold">{PROMOTION_NOTICE}</p>
                <p className="text-xs text-muted-foreground">{detectionExplanation(detection)}</p>
              </div>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <Button type="button" className="h-10" onClick={() => setPromote(true)}>
                Promote (free)
              </Button>
              {canPostAsRegular(detection) ? (
                <Button
                  type="button"
                  variant={ackRegular ? "default" : "outline"}
                  className="h-10"
                  onClick={() => setAckRegular(true)}
                >
                  {ackRegular ? (
                    <>
                      <Check className="size-4" /> Posting as regular content
                    </>
                  ) : (
                    "Post as regular content"
                  )}
                </Button>
              ) : (
                <p className="self-center text-xs text-muted-foreground">
                  This reads as a clear commercial offer, so it needs a promotion package.
                </p>
              )}
            </div>
          </div>
        ) : null}

        {/* Footer */}
        <div className="mt-3 flex items-center gap-2 border-t border-border px-4 py-3">
          <span className="text-xs text-muted-foreground">Free to post</span>
          <Button variant="ghost" className="ml-auto h-10" onClick={requestClose}>
            Cancel
          </Button>
          <Button
            className="h-10 min-w-24"
            disabled={posting || blocker !== null}
            onClick={() => void submit()}
          >
            {posting ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            {promote ? "Promote" : "Post"}
          </Button>
        </div>
      </section>

      <LocationPicker
        open={picker === "location"}
        onOpenChange={(o) => setPicker(o ? "location" : null)}
        value={meta.location ?? null}
        suggestion={areaSuggestion}
        onChange={(loc) => setMeta((m) => ({ ...m, location: loc ?? undefined }))}
      />
      <FeelingPicker
        open={picker === "feeling"}
        onOpenChange={(o) => setPicker(o ? "feeling" : null)}
        value={meta.feeling ?? null}
        onChange={(f) => setMeta((m) => ({ ...m, feeling: f ?? undefined }))}
      />
      <StylePicker
        open={picker === "style"}
        onOpenChange={(o) => setPicker(o ? "style" : null)}
        body={body}
        value={meta.style ?? "plain"}
        onChange={(s) => setMeta((m) => ({ ...m, style: s === "plain" ? undefined : s }))}
      />
      <TagPicker
        open={picker === "tags"}
        onOpenChange={(o) => setPicker(o ? "tags" : null)}
        onMention={(h) => input.current?.insert(`@${h} `)}
        onHashtag={(t) => input.current?.insert(`#${t} `)}
      />

      <AlertDialog open={discardOpen} onOpenChange={setDiscardOpen}>
        <AlertDialogContent className="rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Discard this post?</AlertDialogTitle>
            <AlertDialogDescription>
              Your text and attachments will be lost. Posts you already published are not affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                setDiscardOpen(false);
                reset();
              }}
            >
              Discard
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Tool({
  icon,
  label,
  active,
  disabled,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={cn(
        "flex h-16 flex-col items-center justify-center gap-1 rounded-xl px-1 text-center text-[11px] font-medium leading-tight transition-colors hover:bg-accent disabled:opacity-40",
        active ? "bg-primary/5 text-primary ring-1 ring-primary/30" : "text-foreground",
      )}
    >
      {icon}
      <span className="line-clamp-1">{label}</span>
    </button>
  );
}

function Chip({ children, onRemove }: { children: React.ReactNode; onRemove: () => void }) {
  return (
    <span className="inline-flex h-8 items-center gap-1.5 rounded-full border border-border bg-muted/60 pl-2.5 pr-1 text-xs font-medium">
      {children}
      <button
        type="button"
        onClick={onRemove}
        aria-label="Remove"
        className="flex size-6 items-center justify-center rounded-full hover:bg-accent"
      >
        <X className="size-3.5" />
      </button>
    </span>
  );
}
