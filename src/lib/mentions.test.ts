import { describe, expect, it } from "vitest";
import {
  applyMention,
  extractMentions,
  mentionDraft,
  parseMentions,
  profilePath,
} from "@/lib/mentions";

describe("mention parsing", () => {
  it("turns @handles into clickable segments and keeps the rest as text", () => {
    const segs = parseMentions("hi @maria_dc welcome!");
    expect(segs.map((s) => s.kind)).toEqual(["text", "mention", "text"]);
    expect(segs[1]).toMatchObject({ kind: "mention", handle: "maria_dc" });
  });

  it("lowercases handles so links stay stable regardless of typing", () => {
    expect(extractMentions("Hello @Maria_DC and @maria_dc")).toEqual(["maria_dc"]);
  });

  it("never treats an email address as a mention", () => {
    expect(extractMentions("write to juan@sagada.com")).toEqual([]);
  });

  it("ignores too-short tokens", () => {
    expect(extractMentions("@ab is not a handle")).toEqual([]);
  });

  it("links to the public Universe profile", () => {
    expect(profilePath("@Maria")).toBe("/universe/u/maria");
  });
});

describe("mention autocomplete", () => {
  it("detects the handle being typed at the caret", () => {
    const text = "hey @mar";
    expect(mentionDraft(text, text.length)).toEqual({ query: "mar", start: 4 });
  });

  it("does not open inside an email", () => {
    const text = "juan@sag";
    expect(mentionDraft(text, text.length)).toBeNull();
  });

  it("closes once the caret leaves the token", () => {
    const text = "hey @maria posted";
    expect(mentionDraft(text, text.length)).toBeNull();
  });

  it("inserts the chosen handle with a trailing space", () => {
    const text = "hey @mar";
    const draft = mentionDraft(text, text.length)!;
    const res = applyMention(text, draft, "@Maria_DC");
    expect(res.text).toBe("hey @maria_dc ");
    expect(res.caret).toBe(res.text.length);
  });
});
