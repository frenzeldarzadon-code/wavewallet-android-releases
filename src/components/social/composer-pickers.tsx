/**
 * Pickers used by the Universe composer: location, feeling/activity, text
 * style and @/# tagging. Each is a small dialog that returns a value to the
 * composer — nothing here talks to the database except the @ search, which
 * reuses the existing handle search behind mentions.
 */
import { AtSign, Check, Hash, Loader2, LocateFixed, MapPin, Search, X } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { MemberAvatar } from "@/components/member-avatar";
import { MentionText } from "@/components/social/mention-text";
import { displayHandle } from "@/lib/profile";
import { searchHandles, type MentionSuggestion } from "@/lib/social";
import {
  ACTIVITIES,
  FEELINGS,
  LOCATION_LABEL_MAX,
  POST_STYLES,
  approximateCoordinate,
  feelingPhrase,
  postStyle,
  validateLocationLabel,
  type PostFeeling,
  type PostLocation,
} from "@/lib/post-meta";
import { cn } from "@/lib/utils";

// ------------------------------------------------------------------ location

export function LocationPicker({
  open,
  onOpenChange,
  value,
  suggestion,
  onChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: PostLocation | null;
  /** The member's own area (city, province) from their profile, when known. */
  suggestion: string | null;
  onChange: (next: PostLocation | null) => void;
}) {
  const [label, setLabel] = useState("");
  const [point, setPoint] = useState<{ lat: number; lng: number } | null>(null);
  const [locating, setLocating] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLabel(value?.label ?? "");
    setPoint(
      value && typeof value.lat === "number" && typeof value.lng === "number"
        ? { lat: value.lat, lng: value.lng }
        : null,
    );
  }, [open, value]);

  const locate = () => {
    if (!("geolocation" in navigator)) {
      toast.error("Your device does not share its location");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setPoint({
          lat: approximateCoordinate(pos.coords.latitude),
          lng: approximateCoordinate(pos.coords.longitude),
        });
        setLocating(false);
      },
      () => {
        setLocating(false);
        toast.error("Could not read your location", {
          description: "You can still type the place name.",
        });
      },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 },
    );
  };

  const problem = validateLocationLabel(label);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md rounded-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MapPin className="size-5 text-primary" /> Add location
          </DialogTitle>
          <DialogDescription>
            Name the place — a barangay, town or landmark. Your exact address is never shared.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="postLocation">Place</Label>
            <Input
              id="postLocation"
              value={label}
              maxLength={LOCATION_LABEL_MAX}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Poblacion, Sagada"
              className="h-11"
            />
          </div>
          {suggestion && suggestion !== label ? (
            <button
              type="button"
              onClick={() => setLabel(suggestion)}
              className="flex h-11 w-full items-center gap-2 rounded-xl border border-border px-3 text-left text-sm hover:bg-accent"
            >
              <MapPin className="size-4 text-primary" /> Use my area:{" "}
              <span className="truncate font-medium">{suggestion}</span>
            </button>
          ) : null}
          <div className="rounded-xl border border-border p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium">Approximate map point</p>
                <p className="text-xs text-muted-foreground">
                  Optional. Rounded to about 1 km so nobody can pinpoint you.
                </p>
              </div>
              {point ? (
                <Button variant="ghost" size="sm" onClick={() => setPoint(null)}>
                  <X className="size-4" /> Clear
                </Button>
              ) : (
                <Button variant="outline" size="sm" disabled={locating} onClick={locate}>
                  {locating ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <LocateFixed className="size-4" />
                  )}
                  Use device
                </Button>
              )}
            </div>
            {point ? (
              <p className="mt-2 text-xs text-muted-foreground">
                Attached: {point.lat.toFixed(2)}, {point.lng.toFixed(2)}
              </p>
            ) : null}
          </div>
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          {value ? (
            <Button
              variant="ghost"
              className="text-destructive sm:mr-auto"
              onClick={() => {
                onChange(null);
                onOpenChange(false);
              }}
            >
              Remove location
            </Button>
          ) : null}
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={problem !== null}
            onClick={() => {
              onChange({ label: label.trim(), ...(point ?? {}) });
              onOpenChange(false);
            }}
          >
            <Check className="size-4" /> Add
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------------------------------------------- feeling

export function FeelingPicker({
  open,
  onOpenChange,
  value,
  onChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: PostFeeling | null;
  onChange: (next: PostFeeling | null) => void;
}) {
  const [query, setQuery] = useState("");
  useEffect(() => {
    if (open) setQuery("");
  }, [open]);
  const filter = (list: readonly PostFeeling[]) =>
    list.filter((f) => f.label.toLowerCase().includes(query.trim().toLowerCase()));

  const grid = (list: readonly PostFeeling[]) => (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {filter(list).map((f) => {
        const active = value?.kind === f.kind && value.label === f.label;
        return (
          <button
            key={`${f.kind}-${f.label}`}
            type="button"
            aria-pressed={active}
            onClick={() => {
              onChange(f);
              onOpenChange(false);
            }}
            className={cn(
              "flex h-12 items-center gap-2 rounded-xl border px-3 text-left text-sm",
              active ? "border-primary bg-primary/5 font-semibold" : "border-border hover:bg-accent",
            )}
          >
            <span className="text-xl" aria-hidden>
              {f.emoji}
            </span>
            <span className="truncate">{f.label}</span>
          </button>
        );
      })}
      {filter(list).length === 0 ? (
        <p className="col-span-full text-sm text-muted-foreground">Nothing matches that.</p>
      ) : null}
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] max-w-md overflow-y-auto rounded-2xl">
        <DialogHeader>
          <DialogTitle>How are you feeling?</DialogTitle>
          <DialogDescription>
            Shown after your name, e.g. “{feelingPhrase(FEELINGS[0]!)}”.
          </DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search"
            className="h-11 pl-9"
          />
        </div>
        <Tabs defaultValue={value?.kind === "activity" ? "activity" : "feeling"}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="feeling">Feelings</TabsTrigger>
            <TabsTrigger value="activity">Activities</TabsTrigger>
          </TabsList>
          <TabsContent value="feeling" className="mt-3">
            {grid(FEELINGS)}
          </TabsContent>
          <TabsContent value="activity" className="mt-3">
            {grid(ACTIVITIES)}
          </TabsContent>
        </Tabs>
        {value ? (
          <DialogFooter>
            <Button
              variant="ghost"
              className="text-destructive"
              onClick={() => {
                onChange(null);
                onOpenChange(false);
              }}
            >
              Remove
            </Button>
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

// --------------------------------------------------------------------- style

/** The styled text card — used for the live preview and in the feed. */
export function StyledPostBody({
  body,
  styleId,
  className,
}: {
  body: string;
  styleId: string;
  className?: string;
}) {
  const style = postStyle(styleId);
  const long = body.trim().length > 120;
  return (
    <div
      className={cn(
        "flex min-h-44 items-center justify-center rounded-2xl px-6 py-8 text-center shadow-[var(--shadow-card)]",
        style?.className,
        className,
      )}
    >
      <MentionText
        body={body}
        className={cn("font-semibold leading-snug", long ? "text-lg" : "text-2xl")}
        linkClassName="text-current underline decoration-current/50"
      />
    </div>
  );
}

export function StylePicker({
  open,
  onOpenChange,
  body,
  value,
  onChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  body: string;
  value: string;
  onChange: (next: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => {
    if (open) setDraft(value);
  }, [open, value]);
  const preview = body.trim() || "Your text will look like this";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md rounded-2xl">
        <DialogHeader>
          <DialogTitle>Post style</DialogTitle>
          <DialogDescription>
            A background for short text posts. It is skipped automatically when a photo or video is
            attached or the text is long.
          </DialogDescription>
        </DialogHeader>
        {postStyle(draft) ? (
          <StyledPostBody body={preview} styleId={draft} />
        ) : (
          <div className="flex min-h-44 items-center justify-center rounded-2xl border border-dashed border-border px-6 text-center">
            <MentionText body={preview} className="text-base" />
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          {POST_STYLES.map((s) => (
            <button
              key={s.id}
              type="button"
              aria-label={s.label}
              aria-pressed={draft === s.id}
              title={s.label}
              onClick={() => setDraft(s.id)}
              className={cn(
                "flex size-11 items-center justify-center rounded-full border-2 text-xs font-bold",
                s.className || "bg-card text-foreground",
                draft === s.id ? "border-primary ring-2 ring-primary/30" : "border-border",
              )}
            >
              {s.id === "plain" ? "Aa" : draft === s.id ? <Check className="size-4" /> : ""}
            </button>
          ))}
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              onChange(draft);
              onOpenChange(false);
            }}
          >
            <Check className="size-4" /> Use style
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ----------------------------------------------------------------------- tags

export function TagPicker({
  open,
  onOpenChange,
  onMention,
  onHashtag,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Inserts "@handle " into the text. */
  onMention: (handle: string) => void;
  /** Inserts "#tag " into the text. */
  onHashtag: (tag: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [tag, setTag] = useState("");
  const [rows, setRows] = useState<MentionSuggestion[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (open) {
      setQuery("");
      setTag("");
      setRows([]);
    }
  }, [open]);

  useEffect(() => {
    const q = query.trim().replace(/^@/, "");
    if (!q) {
      setRows([]);
      return;
    }
    let active = true;
    setSearching(true);
    const timer = setTimeout(() => {
      void searchHandles(q).then((r) => {
        if (!active) return;
        setRows(r);
        setSearching(false);
      });
    }, 180);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query]);

  const cleanTag = tag.trim().replace(/^#+/, "").replace(/[^A-Za-z0-9_]/g, "").toLowerCase();
  const tagOk = cleanTag.length >= 2 && cleanTag.length <= 40;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md rounded-2xl">
        <DialogHeader>
          <DialogTitle>Tag people or topics</DialogTitle>
          <DialogDescription>
            Mention a Universe member with @ or add a searchable #hashtag.
          </DialogDescription>
        </DialogHeader>
        <Tabs defaultValue="mention">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="mention" className="gap-1.5">
              <AtSign className="size-4" /> Mention
            </TabsTrigger>
            <TabsTrigger value="hashtag" className="gap-1.5">
              <Hash className="size-4" /> Hashtag
            </TabsTrigger>
          </TabsList>
          <TabsContent value="mention" className="mt-3 space-y-2">
            <div className="relative">
              <AtSign className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search by name or @handle"
                className="h-11 pl-9"
              />
            </div>
            <ul className="max-h-64 space-y-1 overflow-y-auto">
              {rows.map((s) => (
                <li key={s.user_id}>
                  <button
                    type="button"
                    className="flex h-12 w-full items-center gap-2 rounded-xl px-2 text-left hover:bg-accent"
                    onClick={() => {
                      onMention(s.handle);
                      onOpenChange(false);
                    }}
                  >
                    <MemberAvatar path={s.avatar_path} name={s.full_name} className="size-8" />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{s.full_name}</span>
                      <span className="block truncate text-xs text-primary">
                        {displayHandle(s.handle)}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
              {query.trim() && !searching && rows.length === 0 ? (
                <li className="px-2 py-3 text-sm text-muted-foreground">No member matches.</li>
              ) : null}
              {searching ? (
                <li className="flex items-center gap-2 px-2 py-3 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" /> Searching…
                </li>
              ) : null}
            </ul>
          </TabsContent>
          <TabsContent value="hashtag" className="mt-3 space-y-2">
            <div className="relative">
              <Hash className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={tag}
                maxLength={41}
                onChange={(e) => setTag(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && tagOk) {
                    onHashtag(cleanTag);
                    onOpenChange(false);
                  }
                }}
                placeholder="e.g. sagada"
                className="h-11 pl-9"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Letters, numbers and underscores only. Hashtags become clickable and searchable.
            </p>
            <Button
              className="h-11 w-full"
              disabled={!tagOk}
              onClick={() => {
                onHashtag(cleanTag);
                onOpenChange(false);
              }}
            >
              <Hash className="size-4" /> Add #{cleanTag || "hashtag"}
            </Button>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
