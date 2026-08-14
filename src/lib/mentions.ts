/**
 * @handle mentions for Universe posts, comments and replies.
 *
 * Everything here is presentation logic: parsing text into segments, working
 * out what the member is typing so the picker can suggest handles, and
 * splicing a chosen handle back into the text. Handle ownership and uniqueness
 * are enforced by the database.
 */

/** Same shape the database accepts: 3-20 lowercase letters, digits, dot, underscore. */
const HANDLE_BODY = "[a-z0-9_.]{3,20}";
const MENTION_RE = new RegExp(`@(${HANDLE_BODY})`, "gi");

export type TextSegment =
  | { kind: "text"; text: string }
  | { kind: "mention"; text: string; handle: string };

/** Splits a body into plain text and @mention segments, in order. */
export function parseMentions(body: string): TextSegment[] {
  const segments: TextSegment[] = [];
  const re = new RegExp(MENTION_RE.source, "gi");
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(body)) !== null) {
    const before = body.slice(last, match.index);
    // A handle only starts at a word boundary, so emails never become mentions.
    const prev = match.index === 0 ? "" : body[match.index - 1]!;
    if (prev && !/[\s(<[{]/.test(prev)) {
      last = match.index;
      continue;
    }
    if (before) segments.push({ kind: "text", text: before });
    segments.push({
      kind: "mention",
      text: match[0],
      handle: (match[1] ?? "").toLowerCase(),
    });
    last = match.index + match[0].length;
  }
  const rest = body.slice(last);
  if (rest) segments.push({ kind: "text", text: rest });
  return segments;
}

/** Unique, lowercased handles mentioned in a body. */
export function extractMentions(body: string): string[] {
  const out: string[] = [];
  for (const s of parseMentions(body)) {
    if (s.kind === "mention" && !out.includes(s.handle)) out.push(s.handle);
  }
  return out;
}

export interface MentionDraft {
  /** Text typed after the @, lowercased. May be empty right after typing "@". */
  query: string;
  /** Index of the @ character in the source text. */
  start: number;
}

/**
 * The mention the caret currently sits inside, or null. Used to open the
 * autocomplete only while an @token is actively being typed.
 */
export function mentionDraft(text: string, caret: number): MentionDraft | null {
  const upto = text.slice(0, Math.max(0, Math.min(caret, text.length)));
  const at = upto.lastIndexOf("@");
  if (at === -1) return null;
  const prev = at === 0 ? "" : upto[at - 1]!;
  if (prev && !/[\s(<[{]/.test(prev)) return null;
  const query = upto.slice(at + 1);
  if (query.length > 20) return null;
  if (query && !/^[a-zA-Z0-9_.]+$/.test(query)) return null;
  return { query: query.toLowerCase(), start: at };
}

/** Replaces the active @token with the chosen handle and a trailing space. */
export function applyMention(
  text: string,
  draft: MentionDraft,
  handle: string,
): { text: string; caret: number } {
  const end = draft.start + 1 + draft.query.length;
  const inserted = `@${handle.replace(/^@+/, "").toLowerCase()} `;
  const next = text.slice(0, draft.start) + inserted + text.slice(end);
  return { text: next, caret: draft.start + inserted.length };
}

/** Universe profile path for a handle — the one place that builds the link. */
export function profilePath(handle: string): string {
  return `/universe/u/${handle.replace(/^@+/, "").toLowerCase()}`;
}
