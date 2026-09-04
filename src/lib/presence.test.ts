import { describe, expect, it } from "vitest";
import { presenceLabel, presenceTone, sortByPresence } from "@/lib/presence";

const now = new Date("2026-09-04T12:00:00Z");
const ago = (mins: number) => new Date(now.getTime() - mins * 60_000).toISOString();

describe("presenceLabel — coarse, never exact", () => {
  it("server-decided online wins", () => {
    expect(presenceLabel({ online: true, lastSeenAt: ago(1) }, now)).toBe("Online");
  });
  it("recent offline shows minutes / hours / days", () => {
    expect(presenceLabel({ online: false, lastSeenAt: ago(1) }, now)).toBe("Online 1 min ago");
    expect(presenceLabel({ online: false, lastSeenAt: ago(2) }, now)).toBe("Online 2 min ago");
    expect(presenceLabel({ online: false, lastSeenAt: ago(60) }, now)).toBe("Online 1 hour ago");
    expect(presenceLabel({ online: false, lastSeenAt: ago(60 * 48) }, now)).toBe("Online 2 days ago");
  });
  it("never seen / very old → neutral wording (no fake Online)", () => {
    expect(presenceLabel({ online: false, lastSeenAt: null }, now)).toBe("Not seen recently");
    expect(presenceLabel({ online: false, lastSeenAt: ago(60 * 24 * 45) }, now)).toBe("Not seen recently");
  });
  it("tone follows recency", () => {
    expect(presenceTone({ online: true, lastSeenAt: ago(0) }, now)).toBe("online");
    expect(presenceTone({ online: false, lastSeenAt: ago(10) }, now)).toBe("recent");
    expect(presenceTone({ online: false, lastSeenAt: ago(600) }, now)).toBe("away");
    expect(presenceTone({ online: false, lastSeenAt: null }, now)).toBe("unknown");
  });
});

describe("sortByPresence — activity first, alphabet only as tie-breaker", () => {
  it("online → most recent → older → never; name last", () => {
    const list = [
      { sellerName: "Agusta", online: false, lastSeenAt: ago(60 * 24 * 3) },
      { sellerName: "Annie", online: false, lastSeenAt: null },
      { sellerName: "Zed", online: true, lastSeenAt: ago(0) },
      { sellerName: "Emily", online: false, lastSeenAt: ago(5) },
      { sellerName: "Donna", online: false, lastSeenAt: ago(5) },
      { sellerName: "Yara", online: true, lastSeenAt: ago(1) },
    ];
    expect(sortByPresence(list).map((s) => s.sellerName)).toEqual([
      "Zed", "Yara", "Donna", "Emily", "Agusta", "Annie",
    ]);
  });
  it("offline authorized sellers stay in the list, just lower", () => {
    const sorted = sortByPresence([
      { sellerName: "Offline", online: false, lastSeenAt: null },
      { sellerName: "Live", online: true, lastSeenAt: ago(0) },
    ]);
    expect(sorted).toHaveLength(2);
    expect(sorted[1]?.sellerName).toBe("Offline");
  });
});
