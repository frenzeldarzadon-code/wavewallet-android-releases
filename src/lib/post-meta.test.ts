import { describe, expect, it } from "vitest";
import { extractHashtags, hashtagPath, parseMentions } from "@/lib/mentions";
import {
  ACTIVITIES,
  FEELINGS,
  compactMeta,
  composerHasContent,
  composerIsDirty,
  feelingPhrase,
  postLinkKey,
  readPostLink,
  readPostMeta,
  styleApplies,
  validateLocationLabel,
  validateVideoFile,
} from "@/lib/post-meta";

describe("hashtags", () => {
  it("parses #tags into clickable segments alongside mentions", () => {
    const segs = parseMentions("Fresh load today @maria_dc #sagada #WiFi_2026");
    expect(segs.filter((s) => s.kind === "hashtag").map((s) => (s as { tag: string }).tag)).toEqual(
      ["sagada", "wifi_2026"],
    );
    expect(segs.some((s) => s.kind === "mention")).toBe(true);
  });

  it("extracts unique lowercased tags and ignores mid-word or too-short tokens", () => {
    expect(extractHashtags("#Sagada #sagada abc#no #a")).toEqual(["sagada"]);
  });

  it("builds the Universe tag link", () => {
    expect(hashtagPath("#Sagada")).toBe("/universe/tag/sagada");
  });
});

describe("post style rules", () => {
  it("applies only to short text-only posts", () => {
    expect(styleApplies({ style: "wave", body: "hello", hasMedia: false })).toBe(true);
    expect(styleApplies({ style: "wave", body: "hello", hasMedia: true })).toBe(false);
    expect(styleApplies({ style: "wave", body: "x".repeat(281), hasMedia: false })).toBe(false);
    expect(styleApplies({ style: "plain", body: "hello", hasMedia: false })).toBe(false);
    expect(styleApplies({ style: "unknown", body: "hello", hasMedia: false })).toBe(false);
  });
});

describe("composer readiness", () => {
  it("allows text, photo or video alone", () => {
    expect(composerHasContent({ body: "  ", hasImage: false, hasVideo: false })).toBe(false);
    expect(composerHasContent({ body: "hi", hasImage: false, hasVideo: false })).toBe(true);
    expect(composerHasContent({ body: "", hasImage: true, hasVideo: false })).toBe(true);
    expect(composerHasContent({ body: "", hasImage: false, hasVideo: true })).toBe(true);
  });

  it("treats chosen extras as unsaved work", () => {
    expect(composerIsDirty({ body: "", hasImage: false, hasVideo: false, meta: {} })).toBe(false);
    expect(
      composerIsDirty({ body: "", hasImage: false, hasVideo: false, meta: { dm_invite: true } }),
    ).toBe(true);
  });
});

describe("meta compaction", () => {
  it("rounds coordinates to ~1 km and drops empty extras", () => {
    const out = compactMeta({
      location: { label: "  Poblacion, Sagada ", lat: 17.083412, lng: 120.901234 },
      feeling: FEELINGS[0]!,
      style: "plain",
      dm_invite: false,
    });
    expect(out).toEqual({
      location: { label: "Poblacion, Sagada", lat: 17.08, lng: 120.9 },
      feeling: FEELINGS[0]!,
    });
  });

  it("reads tolerant of unexpected shapes", () => {
    expect(readPostMeta(null)).toEqual({});
    expect(readPostMeta({ location: { label: "Baguio" }, style: "ink", dm_invite: true })).toEqual({
      location: { label: "Baguio" },
      style: "ink",
      dm_invite: true,
    });
  });

  it("phrases feelings and activities differently", () => {
    expect(feelingPhrase(FEELINGS[0]!)).toBe("is feeling happy");
    expect(feelingPhrase(ACTIVITIES[0]!)).toBe("is selling load & vouchers");
  });
});

describe("validation", () => {
  it("guards location labels", () => {
    expect(validateLocationLabel("a")).not.toBeNull();
    expect(validateLocationLabel("Sagada")).toBeNull();
    expect(validateLocationLabel("x".repeat(81))).not.toBeNull();
  });

  it("accepts only supported videos under 25 MB", () => {
    expect(validateVideoFile({ type: "video/mp4", size: 1024 })).toBeNull();
    expect(validateVideoFile({ type: "video/avi", size: 1024 })).not.toBeNull();
    expect(validateVideoFile({ type: "video/mp4", size: 26 * 1024 * 1024 })).not.toBeNull();
  });
});

describe("post links (Link / Recommend)", () => {
  const shop = "0f8fad5b-d9cb-469f-a165-70867728950e";
  const prod = "7C9E6679-7425-40DE-944B-E07FC1F90AE7";

  it("reads a shop link and normalises the id", () => {
    expect(readPostLink({ kind: "shop", shop_id: shop.toUpperCase() })).toEqual({
      kind: "shop",
      shop_id: shop,
    });
  });

  it("reads a product link only with a valid kind and ids", () => {
    expect(
      readPostLink({ kind: "product", shop_id: shop, product_id: prod, product_kind: "retail" }),
    ).toEqual({
      kind: "product",
      shop_id: shop,
      product_id: prod.toLowerCase(),
      product_kind: "retail",
    });
    expect(
      readPostLink({ kind: "product", shop_id: shop, product_id: "nope", product_kind: "retail" }),
    ).toBeNull();
    expect(
      readPostLink({ kind: "product", shop_id: shop, product_id: prod, product_kind: "food" }),
    ).toBeNull();
    expect(readPostLink({ kind: "shop", shop_id: "not-a-uuid" })).toBeNull();
    expect(readPostLink("shop")).toBeNull();
  });

  it("keeps a valid link through compactMeta and readPostMeta, dropping junk", () => {
    const link = { kind: "shop" as const, shop_id: shop };
    expect(compactMeta({ link })).toEqual({ link });
    expect(compactMeta({ link: { kind: "shop", shop_id: "x" } as never })).toEqual({});
    expect(readPostMeta({ link, extra: 1 })).toEqual({ link });
  });

  it("makes the composer dirty and builds stable keys", () => {
    expect(
      composerIsDirty({
        body: "",
        hasImage: false,
        hasVideo: false,
        meta: { link: { kind: "shop", shop_id: shop } },
      }),
    ).toBe(true);
    expect(postLinkKey({ kind: "shop", shop_id: shop })).toBe(`shop:${shop}`);
    expect(
      postLinkKey({ kind: "product", shop_id: shop, product_id: prod, product_kind: "voucher" }),
    ).toBe(`product:voucher:${prod}`);
  });
});
