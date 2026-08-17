/**
 * Universe post composer.
 *
 * Deliberate order: write first, then decide where it belongs, then decide
 * whether it is worth promoting, then review. Promotion is off by default and
 * nothing is ever deducted before the member confirms the review step — the
 * database re-checks every rule again on submit.
 */
import {
  ArrowLeft,
  Check,
  Coins,
  Globe2,
  ImagePlus,
  Loader2,
  Megaphone,
  Send,
  Store,
  Users,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { MentionInput } from "@/components/social/mention-input";
import { MentionText } from "@/components/social/mention-text";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ImageCropper } from "@/components/image-cropper";
import {
  PROMOTION_NOTICE,
  canPostAsRegular,
  detectPromotion,
  detectionExplanation,
  promotionGate,
} from "@/lib/promotion-detection";
import type { CropRect } from "@/lib/image-optimize";
import {
  POST_MAX_CHARS,
  SOCIAL_IMAGE_ASPECT,
  audienceHelp,
  audienceLabel,
  audienceSummary,
  canAfford,
  createPost,
  fetchTargetShops,
  postCharge,
  freePostDisclosure,
  postReadiness,
  tierDuration,
  uploadSocialImage,
  validateSocialImage,
  type PostAudience,
  type PromotionTier,
  type SocialCurrency,
  type SocialState,
  type TargetShop,
} from "@/lib/social";

type Step = "write" | "audience" | "promote" | "review";

const STEPS: { key: Step; label: string }[] = [
  { key: "write", label: "Write" },
  { key: "audience", label: "Share with" },
  { key: "promote", label: "Promote" },
  { key: "review", label: "Review" },
];

export function PostComposer({
  open,
  onOpenChange,
  state,
  tiers,
  userId,
  pointsBalance,
  ownShopName,
  onPosted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  state: SocialState;
  tiers: PromotionTier[];
  userId: string;
  pointsBalance: number;
  ownShopName: string;
  onPosted: () => Promise<void> | void;
}) {
  const [step, setStep] = useState<Step>("write");
  const [body, setBody] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [crop, setCrop] = useState<{ image: HTMLImageElement; crop: CropRect } | null>(null);
  const [audience, setAudience] = useState<PostAudience>("ecosystem");
  const [shops, setShops] = useState<TargetShop[]>([]);
  const [shopIds, setShopIds] = useState<string[]>([]);
  const [promote, setPromote] = useState(false);
  const [tierId, setTierId] = useState<string>("");
  const [payWith, setPayWith] = useState<SocialCurrency>("social");
  const [posting, setPosting] = useState(false);
  const [ackRegular, setAckRegular] = useState(false);

  useEffect(() => {
    if (!open) return;
    void fetchTargetShops()
      .then(setShops)
      .catch((e: Error) => toast.error("Could not load your shops", { description: e.message }));
  }, [open]);

  const promotionAvailable = state.promotion_enabled && tiers.length > 0;
  const tier = useMemo(() => tiers.find((t) => t.id === tierId) ?? null, [tiers, tierId]);
  const charge = useMemo(
    () => postCharge(state, promote, tier, payWith),
    [state, promote, tier, payWith],
  );
  const affordable = canAfford(state, charge, pointsBalance);
  // Detection is free and local: it never touches the network and never
  // deducts anything. It only decides which notice the review step shows.
  const detection = useMemo(() => detectPromotion(body, { hasImage: file !== null }), [body, file]);
  const promotionBlocker = promotionGate({
    detection,
    promote,
    acknowledgedRegular: ackRegular,
    packagesAvailable: promotionAvailable,
  });
  const blocker =
    postReadiness({
      body,
      audience,
      shopIds,
      promote,
      tierChosen: !promote || tier !== null,
      affordable,
    }) ?? promotionBlocker;

  useEffect(() => {
    setAckRegular(false);
  }, [body, file]);

  useEffect(() => {
    if (promote && !tierId && tiers.length > 0) setTierId(tiers[0]!.id);
  }, [promote, tierId, tiers]);

  const reset = () => {
    setStep("write");
    setBody("");
    setFile(null);
    setCrop(null);
    setAudience("ecosystem");
    setShopIds([]);
    setPromote(false);
    setTierId("");
    setPayWith("social");
    setAckRegular(false);
  };

  const close = (next: boolean) => {
    onOpenChange(next);
    if (!next) reset();
  };

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

  const toggleShop = (id: string) =>
    setShopIds((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]));

  const submit = async () => {
    if (blocker) {
      toast.error(blocker);
      return;
    }
    setPosting(true);
    try {
      let imagePath: string | null = null;
      if (file && crop) {
        imagePath = await uploadSocialImage({
          ecosystemId: state.ecosystem_id,
          userId,
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
        ...(audience === "shops" ? { shopIds } : {}),
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
      close(false);
      await onPosted();
    } catch (e) {
      toast.error("Could not publish", { description: (e as Error).message });
    } finally {
      setPosting(false);
    }
  };

  const stepIndex = STEPS.findIndex((s) => s.key === step);
  const next = () => {
    if (step === "write") {
      if (!body.trim()) {
        toast.error("Write something first");
        return;
      }
      setStep("audience");
    } else if (step === "audience") {
      if (audience === "shops" && shopIds.length === 0) {
        toast.error("Choose at least one shop to share with");
        return;
      }
      setStep(promotionAvailable ? "promote" : "review");
    } else if (step === "promote") {
      setStep("review");
    }
  };
  const back = () => {
    if (step === "review") setStep(promotionAvailable ? "promote" : "audience");
    else if (step === "promote") setStep("audience");
    else if (step === "audience") setStep("write");
  };

  const remaining =
    charge.currency === "points"
      ? Math.max(0, pointsBalance - charge.amount)
      : Math.max(0, state.balance - charge.amount);

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[92svh] gap-3 overflow-y-auto sm:max-w-lg">
        <DialogHeader className="space-y-2 text-left">
          <DialogTitle className="flex items-center gap-2 text-base">
            {step !== "write" ? (
              <Button variant="ghost" size="icon" className="-ml-2 size-8" onClick={back}>
                <ArrowLeft className="size-4" />
              </Button>
            ) : null}
            Create post
          </DialogTitle>
          <DialogDescription className="flex flex-wrap items-center gap-1.5 text-xs">
            {STEPS.filter((s) => s.key !== "promote" || promotionAvailable).map((s, i) => (
              <span
                key={s.key}
                className={
                  s.key === step
                    ? "rounded-full bg-primary px-2 py-0.5 font-semibold text-primary-foreground"
                    : "rounded-full bg-muted px-2 py-0.5 text-muted-foreground"
                }
              >
                {i + 1}. {s.label}
              </span>
            ))}
          </DialogDescription>
        </DialogHeader>

        {step === "write" ? (
          <div className="space-y-3">
            {/* Familiar composer header: who is posting, and where it goes. */}
            <div className="flex items-center gap-3">
              <MemberAvatar name={authorName} className="size-10" />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{authorName}</p>
                <button
                  type="button"
                  onClick={() => setStep("audience")}
                  className="mt-0.5 inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/60 px-2.5 py-1 text-xs font-medium text-muted-foreground"
                >
                  {audience === "general" ? (
                    <Globe2 className="size-3.5" aria-hidden />
                  ) : audience === "shops" ? (
                    <Store className="size-3.5" aria-hidden />
                  ) : (
                    <Users className="size-3.5" aria-hidden />
                  )}
                  <span className="max-w-40 truncate">
                    {audienceSummary(audience, shops, shopIds, ownShopName)}
                  </span>
                </button>
              </div>
            </div>

            <MentionInput
              value={body}
              onChange={setBody}
              maxLength={POST_MAX_CHARS}
              rows={6}
              placeholder="What's on your mind? Type @ to mention someone"
              className="min-h-36 resize-none border-0 bg-transparent px-0 text-lg shadow-none focus-visible:ring-0"
            />
            <p className="text-right text-xs text-muted-foreground">
              {body.length}/{POST_MAX_CHARS}
            </p>

            {file ? (
              <div className="space-y-2">
                <ImageCropper file={file} aspect={SOCIAL_IMAGE_ASPECT} onChange={setCrop} />
                <Button variant="ghost" size="sm" onClick={() => pickFile(null)}>
                  <X className="size-4" /> Remove photo
                </Button>
              </div>
            ) : (
              <>
                <Label
                  htmlFor="composerPhoto"
                  className="flex h-12 cursor-pointer items-center gap-2 rounded-2xl border border-border px-3 text-sm font-medium"
                >
                  <ImagePlus className="size-5 text-success" /> Add photo
                </Label>
                <Input
                  id="composerPhoto"
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
                />
              </>
            )}

            <ul className="space-y-1 rounded-2xl bg-muted/50 p-3 text-xs text-muted-foreground">
              {freePostDisclosure(state).map((line, i) => (
                <li key={line} className={i === 0 ? "font-medium text-foreground" : undefined}>
                  {line}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {step === "audience" ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Where should this be shared?</p>
            <div className="space-y-2">
              {(["general", "shops", "ecosystem"] as PostAudience[]).map((a) => (
                <button
                  key={a}
                  type="button"
                  onClick={() => setAudience(a)}
                  aria-pressed={audience === a}
                  className={
                    audience === a
                      ? "w-full rounded-2xl border-2 border-primary bg-primary/5 p-4 text-left"
                      : "w-full rounded-2xl border border-border p-4 text-left"
                  }
                >
                  <span className="flex items-center gap-2 text-sm font-semibold">
                    {a === "general" ? (
                      <Globe2 className="size-4 text-primary" aria-hidden />
                    ) : a === "shops" ? (
                      <Store className="size-4 text-primary" aria-hidden />
                    ) : (
                      <Users className="size-4 text-primary" aria-hidden />
                    )}
                    {a === "ecosystem" ? ownShopName : audienceLabel(a)}
                    {audience === a ? <Check className="ml-auto size-4 text-primary" /> : null}
                  </span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    {audienceHelp(a)}
                  </span>
                </button>
              ))}
            </div>

            {audience === "shops" ? (
              <div className="space-y-2 rounded-2xl border border-border p-3">
                <Label className="text-sm">Pick your shops</Label>
                {shops.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    You are not an approved member of any shop yet.
                  </p>
                ) : (
                  shops.map((s) => (
                    <button
                      key={s.ecosystem_id}
                      type="button"
                      onClick={() => toggleShop(s.ecosystem_id)}
                      aria-pressed={shopIds.includes(s.ecosystem_id)}
                      className={
                        shopIds.includes(s.ecosystem_id)
                          ? "flex h-12 w-full items-center gap-2 rounded-xl border-2 border-primary bg-primary/5 px-3 text-left text-sm font-medium"
                          : "flex h-12 w-full items-center gap-2 rounded-xl border border-border px-3 text-left text-sm"
                      }
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
          </div>
        ) : null}

        {step === "promote" ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3 rounded-2xl border border-border p-4">
              <div>
                <Label htmlFor="promoteToggle" className="flex items-center gap-2 text-sm">
                  <Megaphone className="size-4 text-primary" aria-hidden /> Promote this post
                </Label>
                <p className="mt-1 text-xs text-muted-foreground">
                  Off by default. Turning this on spends social credits — you confirm the exact
                  amount on the next step.
                </p>
              </div>
              <Switch id="promoteToggle" checked={promote} onCheckedChange={setPromote} />
            </div>

            {promote ? (
              <div className="space-y-2">
                {tiers.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setTierId(t.id)}
                    aria-pressed={tierId === t.id}
                    className={
                      tierId === t.id
                        ? "w-full rounded-2xl border-2 border-primary bg-primary/5 p-4 text-left"
                        : "w-full rounded-2xl border border-border p-4 text-left"
                    }
                  >
                    <span className="flex items-center gap-2 text-sm font-semibold">
                      {t.name}
                      {tierId === t.id ? <Check className="ml-auto size-4 text-primary" /> : null}
                    </span>
                    <span className="mt-1 block text-xs text-muted-foreground">
                      {t.currency !== "points" ? `${t.price_social} social credits` : ""}
                      {t.currency === "both" ? " or " : ""}
                      {t.currency !== "social" ? `${t.price_points} points` : ""} ·{" "}
                      {tierDuration(t.duration_hours)}
                      {t.description ? ` · ${t.description}` : ""}
                    </span>
                  </button>
                ))}
                {tier?.currency === "both" ? (
                  <div className="space-y-1.5">
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
          </div>
        ) : null}

        {step === "review" ? (
          <div className="space-y-3">
            <div className="rounded-2xl border border-border p-4 text-sm">
              <MentionText body={body} />
              {file ? <p className="mt-2 text-xs text-muted-foreground">1 photo attached</p> : null}
            </div>
            {!promote && detection.level !== "none" && promotionAvailable ? (
              <div className="space-y-3 rounded-2xl border-2 border-warning/60 bg-warning/5 p-4">
                <div className="flex items-start gap-2">
                  <Megaphone className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
                  <div className="space-y-1">
                    <p className="text-sm font-semibold">{PROMOTION_NOTICE}</p>
                    <p className="text-xs text-muted-foreground">
                      {detectionExplanation(detection)} Checking costs nothing — nothing is deducted
                      until you publish.
                    </p>
                  </div>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <Button
                    type="button"
                    className="h-11"
                    onClick={() => {
                      setPromote(true);
                      setStep("promote");
                    }}
                  >
                    Choose a promotion package
                  </Button>
                  {canPostAsRegular(detection) ? (
                    <Button
                      type="button"
                      variant={ackRegular ? "default" : "outline"}
                      className="h-11"
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
            <dl className="space-y-2 rounded-2xl border border-border p-4 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Audience</dt>
                <dd className="text-right font-medium">
                  {audienceSummary(audience, shops, shopIds, ownShopName)}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Promotion</dt>
                <dd className="text-right font-medium">
                  {promote ? (tier?.name ?? "Promoted") : "None"}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Cost</dt>
                <dd className="text-right font-medium">
                  {charge.free
                    ? "Free (uses 1 of today's free posts)"
                    : `${charge.amount} ${charge.currency === "points" ? "points" : "paid social credits"}`}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">
                  {charge.free ? "Free posts left after this" : "Paid balance after this"}
                </dt>
                <dd className="text-right font-medium">
                  {charge.free
                    ? Math.max(0, state.free_posts_left - 1)
                    : `${remaining} ${charge.currency === "points" ? "points" : "social credits"}`}
                </dd>
              </div>
            </dl>
            <p className="text-xs text-muted-foreground">
              {audience === "general"
                ? "This appears in your own shop right away. Every other shop's admin must approve it before it appears in their community."
                : audienceHelp(audience)}
            </p>
            <p className="text-xs text-muted-foreground">
              {promote
                ? `Only you pay this promotion, and promotions always cost paid social credits. Likes, replies and messages stay free.`
                : `Likes, replies and messages are always free. Only posts beyond your daily free allowance use paid social credits.`}
            </p>
            {!affordable ? (
              <p className="text-sm font-medium text-destructive">
                You do not have enough {charge.currency === "points" ? "points" : "social credits"}.
                Nothing has been deducted.
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="flex items-center gap-2 border-t border-border pt-3">
          <span className="flex flex-col gap-0.5 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <Coins className="size-4 text-success" aria-hidden />
              {state.purchased_balance} paid social credits
            </span>
            <span>
              {Math.max(0, state.free_posts_left)} free post
              {state.free_posts_left === 1 ? "" : "s"} left today
            </span>
          </span>
          {step === "review" ? (
            <Button
              className="ml-auto h-11"
              disabled={posting || blocker !== null}
              onClick={() => void submit()}
            >
              {posting ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
              {promote ? "Confirm & promote" : "Post"}
            </Button>
          ) : (
            <Button className="ml-auto h-11" onClick={next} disabled={stepIndex < 0}>
              Next
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
