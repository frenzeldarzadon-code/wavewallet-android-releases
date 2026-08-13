import { describe, expect, it } from "vitest";
import {
  MIN_RECIPIENT_QUERY,
  handleQuery,
  rankRecipients,
  recipientIdentityLine,
  recipientScore,
} from "@/lib/recipient-search";
import type { RecipientMatch } from "@/lib/wallet";

const member = (over: Partial<RecipientMatch>): RecipientMatch => ({
  id: crypto.randomUUID(),
  full_name: "Ana Cruz",
  handle: "anacruz",
  avatar_path: null,
  phone: "0917•••1234",
  masked_email: "a•••@mail.com",
  ...over,
});

describe("recipient nearest-match ranking", () => {
  it("needs at least two characters before searching", () => {
    expect(MIN_RECIPIENT_QUERY).toBe(2);
  });

  it("treats @handle and handle as the same query", () => {
    expect(handleQuery("@Ana")).toBe("ana");
    expect(handleQuery(" ana ")).toBe("ana");
  });

  it("puts an exact handle match ahead of a name match", () => {
    const byHandle = member({ full_name: "Zoe Reyes", handle: "ana" });
    const byName = member({ full_name: "Ana Cruz", handle: "acruz" });
    expect(recipientScore(byHandle, "@ana")).toBeLessThan(recipientScore(byName, "@ana"));
  });

  it("matches by name prefix, email and phone digits", () => {
    const m = member({ full_name: "Ana Cruz", handle: null, phone: "09171234567" });
    expect(recipientScore(m, "ana")).toBeLessThan(9);
    expect(recipientScore(m, "4567")).toBeLessThan(9);
    expect(recipientScore(member({ handle: null }), "mail.com")).toBeLessThan(9);
  });

  it("orders the closest matches first and keeps ties alphabetical", () => {
    const list = [
      member({ full_name: "Anabelle Diaz", handle: "belle" }),
      member({ full_name: "Ana Cruz", handle: "anacruz" }),
      member({ full_name: "Ana Bautista", handle: "ana" }),
    ];
    const ranked = rankRecipients(list, "ana");
    expect(ranked[0]?.handle).toBe("ana");
    expect(ranked.map((r) => r.full_name)).toHaveLength(3);
  });

  it("shows enough identity to disambiguate without unmasking contacts", () => {
    const line = recipientIdentityLine(member({}));
    expect(line).toContain("@anacruz");
    expect(line).toContain("•");
    expect(line).not.toContain("ana.cruz@mail.com");
  });

  it("still describes a member who never claimed a handle", () => {
    expect(recipientIdentityLine(member({ handle: null }))).toBe(
      "a•••@mail.com · 0917•••1234",
    );
  });
});
