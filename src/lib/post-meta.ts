/**
 * Structured extras a Universe post may carry besides its text and photo.
 *
 * Everything here is presentation logic. The database function
 * `social_clean_post_meta` re-validates and trims the same shape on submit, so
 * nothing in this file is an authorization or integrity boundary.
 */

export interface PostLocation {
  /** Human place name, 2-80 chars. Never a street address. */
  label: string;
  /** Approximate map point (2 decimals ≈ 1 km) — only when the member opted in. */
  lat?: number;
  lng?: number;
}

export interface PostFeeling {
  kind: "feeling" | "activity";
  label: string;
  emoji: string;
}

export interface PostMeta {
  location?: PostLocation | undefined;
  feeling?: PostFeeling | undefined;
  /** One of POST_STYLES ids. Ignored when media is attached. */
  style?: string | undefined;
  /** Author invites readers to continue privately in the existing messenger. */
  dm_invite?: boolean | undefined;
}

export const LOCATION_LABEL_MAX = 80;

export const FEELINGS: readonly PostFeeling[] = [
  { kind: "feeling", label: "happy", emoji: "😊" },
  { kind: "feeling", label: "blessed", emoji: "🙏" },
  { kind: "feeling", label: "excited", emoji: "🤩" },
  { kind: "feeling", label: "grateful", emoji: "🥰" },
  { kind: "feeling", label: "proud", emoji: "😎" },
  { kind: "feeling", label: "relaxed", emoji: "😌" },
  { kind: "feeling", label: "motivated", emoji: "💪" },
  { kind: "feeling", label: "tired", emoji: "😴" },
  { kind: "feeling", label: "hungry", emoji: "🤤" },
  { kind: "feeling", label: "busy", emoji: "⏰" },
  { kind: "feeling", label: "thankful", emoji: "💙" },
  { kind: "feeling", label: "curious", emoji: "🤔" },
];

export const ACTIVITIES: readonly PostFeeling[] = [
  { kind: "activity", label: "selling load & vouchers", emoji: "📶" },
  { kind: "activity", label: "opening the shop", emoji: "🏪" },
  { kind: "activity", label: "restocking", emoji: "📦" },
  { kind: "activity", label: "delivering orders", emoji: "🛵" },
  { kind: "activity", label: "traveling", emoji: "✈️" },
  { kind: "activity", label: "eating", emoji: "🍽️" },
  { kind: "activity", label: "celebrating", emoji: "🎉" },
  { kind: "activity", label: "working", emoji: "💼" },
  { kind: "activity", label: "studying", emoji: "📚" },
  { kind: "activity", label: "listening to music", emoji: "🎧" },
  { kind: "activity", label: "watching a game", emoji: "🏀" },
  { kind: "activity", label: "looking for", emoji: "🔎" },
];

/** "feeling happy" / "selling load & vouchers" — the words shown after the author's name. */
export function feelingPhrase(f: PostFeeling): string {
  return f.kind === "feeling" ? `is feeling ${f.label}` : `is ${f.label}`;
}

export interface PostStyle {
  id: string;
  label: string;
  /** Utility class defined in styles.css; always pairs a background with a readable foreground. */
  className: string;
}

/** Text-only post backgrounds. `plain` means no styling at all. */
export const POST_STYLES: readonly PostStyle[] = [
  { id: "plain", label: "Plain", className: "" },
  { id: "wave", label: "Wave", className: "post-style-wave" },
  { id: "sunrise", label: "Sunrise", className: "post-style-sunrise" },
  { id: "forest", label: "Forest", className: "post-style-forest" },
  { id: "dusk", label: "Dusk", className: "post-style-dusk" },
  { id: "ink", label: "Ink", className: "post-style-ink" },
  { id: "paper", label: "Paper", className: "post-style-paper" },
];

/** A styled background only makes sense for short, text-only posts. */
export const STYLED_BODY_MAX = 280;

export function postStyle(id?: string | null): PostStyle | null {
  if (!id || id === "plain") return null;
  return POST_STYLES.find((s) => s.id === id) ?? null;
}

/**
 * Whether the styled background should render. Media always wins: a photo or
 * video is never drawn on top of a colour card, and long text stays plain so
 * it remains readable.
 */
export function styleApplies(input: {
  style?: string | null | undefined;
  body: string;
  hasMedia: boolean;
}): boolean {
  if (input.hasMedia) return false;
  if (!postStyle(input.style)) return false;
  const len = input.body.trim().length;
  return len > 0 && len <= STYLED_BODY_MAX;
}

export function validateLocationLabel(label: string): string | null {
  const l = label.trim();
  if (l.length < 2) return "Enter a place name (at least 2 characters)";
  if (l.length > LOCATION_LABEL_MAX)
    return `Keep the place name under ${LOCATION_LABEL_MAX} characters`;
  return null;
}

/** Rounds to 2 decimals (~1 km) so a post never carries a precise position. */
export function approximateCoordinate(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Drops empty extras so the database receives only what the member chose. */
export function compactMeta(meta: PostMeta): PostMeta {
  const out: PostMeta = {};
  if (meta.location && meta.location.label.trim().length >= 2) {
    out.location = {
      label: meta.location.label.trim().slice(0, LOCATION_LABEL_MAX),
      ...(typeof meta.location.lat === "number" && typeof meta.location.lng === "number"
        ? {
            lat: approximateCoordinate(meta.location.lat),
            lng: approximateCoordinate(meta.location.lng),
          }
        : {}),
    };
  }
  if (meta.feeling && meta.feeling.label.trim()) out.feeling = meta.feeling;
  const style = postStyle(meta.style);
  if (style) out.style = style.id;
  if (meta.dm_invite) out.dm_invite = true;
  return out;
}

/** A post is publishable when it has text, a photo or a video. */
export function composerHasContent(input: {
  body: string;
  hasImage: boolean;
  hasVideo: boolean;
}): boolean {
  return input.body.trim().length > 0 || input.hasImage || input.hasVideo;
}

/** True when closing the composer would throw away something the member did. */
export function composerIsDirty(input: {
  body: string;
  hasImage: boolean;
  hasVideo: boolean;
  meta: PostMeta;
}): boolean {
  return composerHasContent(input) || Object.keys(compactMeta(input.meta)).length > 0;
}

export const ACCEPTED_VIDEO_TYPES = ["video/mp4", "video/webm", "video/quicktime"];
export const MAX_VIDEO_BYTES = 25 * 1024 * 1024;

export function validateVideoFile(file: { type: string; size: number }): string | null {
  if (!ACCEPTED_VIDEO_TYPES.includes(file.type)) return "Use an MP4, WEBM or MOV video.";
  if (file.size > MAX_VIDEO_BYTES) return "That video is larger than 25 MB.";
  return null;
}

/** Safe extension for a validated video — derived from the type, never the name. */
export function videoExtension(type: string): string {
  if (type === "video/webm") return "webm";
  if (type === "video/quicktime") return "mov";
  return "mp4";
}

/** Reads the extras a feed row carries, tolerating anything unexpected. */
export function readPostMeta(raw: unknown): PostMeta {
  if (!raw || typeof raw !== "object") return {};
  const m = raw as Record<string, unknown>;
  const out: PostMeta = {};
  const loc = m["location"];
  if (loc && typeof loc === "object" && typeof (loc as PostLocation).label === "string") {
    const l = loc as PostLocation;
    out.location = {
      label: l.label,
      ...(typeof l.lat === "number" && typeof l.lng === "number" ? { lat: l.lat, lng: l.lng } : {}),
    };
  }
  const f = m["feeling"];
  if (f && typeof f === "object" && typeof (f as PostFeeling).label === "string") {
    const ff = f as PostFeeling;
    out.feeling = {
      kind: ff.kind === "activity" ? "activity" : "feeling",
      label: ff.label,
      emoji: typeof ff.emoji === "string" ? ff.emoji : "",
    };
  }
  if (typeof m["style"] === "string") out.style = m["style"];
  if (m["dm_invite"] === true) out.dm_invite = true;
  return out;
}
