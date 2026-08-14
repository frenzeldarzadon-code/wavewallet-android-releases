import { describe, expect, it } from "vitest";
import {
  availableTiers,
  canAfford,
  chargeSummary,
  commentCharge,
  exchangeGain,
  postCharge,
  giftIssue,
  canGift,
  freePostDisclosure,
  LIKE_COST,
  DM_COST,
  relativeTime,
  sourceLabel,
  tierDuration,
  validateCommentBody,
  validateMessageBody,
  validatePostBody,
  type PromotionTier,
  audienceSummary,
  postReadiness,
  roleBadge,
  selectedShopNames,
  MAX_REPLY_DEPTH,
  canReplyTo,
  threadComments,
  type FeedComment,
} from "@/lib/social";

const tier = (over: Partial<PromotionTier> = {}): PromotionTier => ({
  id: "t1",
  name: "Featured",
  description: "",
  price_social: 30,
  price_points: 15,
  currency: "both",
  duration_hours: 48,
  priority: 5,
  eligibility: "all",
  active: true,
  sort_order: 1,
  is_default: false,
  ...over,
});

const state = {
  balance: 5,
  post_cost: 1,
  comment_cost: 0,
  credit_exchange_rate: 2,
  points_exchange_rate: 2,
  promotion_currency: "social" as const,
  promotion_cost_social: 20,
  promotion_cost_points: 20,
  free_posts_left: 0,
};

describe("post charges", () => {
  it("charges one social credit for a normal post", () => {
    expect(postCharge(state, false)).toEqual({ amount: 1, currency: "social", free: false });
  });

  it("charges the promotion fee in social credits by default", () => {
    expect(postCharge(state, true)).toEqual({ amount: 20, currency: "social", free: false });
  });

  it("charges points when the platform configures points promotions", () => {
    expect(postCharge({ ...state, promotion_currency: "points" }, true)).toEqual({
      amount: 20,
      currency: "points",
      free: false,
    });
  });

  it("never deducts both currencies for one promotion", () => {
    const charge = postCharge({ ...state, promotion_currency: "points" }, true);
    expect(charge.currency).toBe("points");
    expect(charge.amount).toBe(20);
  });
});

describe("comment charges", () => {
  it("is always free, on normal and promoted posts alike", () => {
    expect(commentCharge()).toBe(0);
  });
});

describe("affordability", () => {
  it("checks the social balance for social charges", () => {
    expect(canAfford(state, { amount: 20, currency: "social" }, 999)).toBe(false);
    expect(canAfford({ ...state, balance: 25 }, { amount: 20, currency: "social" }, 0)).toBe(true);
  });

  it("checks the points balance for points charges", () => {
    expect(canAfford(state, { amount: 20, currency: "points" }, 10)).toBe(false);
    expect(canAfford(state, { amount: 20, currency: "points" }, 40)).toBe(true);
  });

  it("always allows free actions", () => {
    expect(canAfford({ ...state, balance: 0 }, { amount: 0, currency: "social" }, 0)).toBe(true);
  });
});

describe("exchange", () => {
  it("gives two social credits per wallet credit", () => {
    expect(exchangeGain(state, "credit", 3)).toBe(6);
  });

  it("gives two social credits per point", () => {
    expect(exchangeGain(state, "points", 5)).toBe(10);
  });

  it("ignores negative and fractional amounts", () => {
    expect(exchangeGain(state, "credit", -4)).toBe(0);
    expect(exchangeGain(state, "credit", 2.9)).toBe(4);
  });
});

describe("disclosure copy", () => {
  it("states the exact deduction", () => {
    expect(chargeSummary(20, "social")).toContain("20 social credits");
    expect(chargeSummary(20, "points")).toContain("points");
  });

  it("states free actions plainly", () => {
    expect(chargeSummary(0, "social")).toContain("free");
  });
});

describe("validation", () => {
  it("rejects empty bodies", () => {
    expect(validatePostBody("  ")).not.toBeNull();
    expect(validateCommentBody("")).not.toBeNull();
    expect(validateMessageBody("")).not.toBeNull();
  });

  it("rejects oversized posts", () => {
    expect(validatePostBody("x".repeat(2001))).not.toBeNull();
    expect(validatePostBody("hello")).toBeNull();
  });
});

describe("presentation helpers", () => {
  it("labels ledger sources", () => {
    expect(sourceLabel("daily_allowance")).toBe("Daily allowance");
    expect(sourceLabel("promotion")).toBe("Promotion");
    expect(sourceLabel("unknown_source")).toBe("unknown_source");
  });

  it("formats relative time", () => {
    const now = new Date("2026-01-10T12:00:00Z");
    expect(relativeTime("2026-01-10T11:59:40Z", now)).toBe("just now");
    expect(relativeTime("2026-01-10T11:30:00Z", now)).toBe("30m");
    expect(relativeTime("2026-01-10T09:00:00Z", now)).toBe("3h");
    expect(relativeTime("2026-01-08T12:00:00Z", now)).toBe("2d");
  });
});

describe("promotion tiers", () => {
  it("charges the tier price in the chosen currency", () => {
    expect(postCharge(state, true, tier(), "points")).toEqual({ amount: 15, currency: "points", free: false });
    expect(postCharge(state, true, tier(), "social")).toEqual({ amount: 30, currency: "social", free: false });
  });

  it("ignores the requested currency when the tier only accepts one", () => {
    expect(postCharge(state, true, tier({ currency: "points" }), "social")).toEqual({
      amount: 15,
      currency: "points",
      free: false,
    });
  });

  it("falls back to the shop promotion price when no tier is chosen", () => {
    expect(postCharge(state, true, null, "social")).toEqual({ amount: 20, currency: "social", free: false });
  });

  it("hides inactive and reseller-only tiers from ordinary members", () => {
    const tiers = [
      tier({ id: "a" }),
      tier({ id: "b", active: false }),
      tier({ id: "c", eligibility: "reseller" }),
    ];
    expect(availableTiers({ promotion_tiers: tiers, role: "customer" }).map((t) => t.id)).toEqual([
      "a",
    ]);
    expect(availableTiers({ promotion_tiers: tiers, role: "reseller" }).map((t) => t.id)).toEqual([
      "a",
      "c",
    ]);
  });

  it("describes durations in plain language", () => {
    expect(tierDuration(1)).toBe("1 hour");
    expect(tierDuration(24)).toBe("1 day");
    expect(tierDuration(72)).toBe("3 days");
  });
});

describe("universe composer flow", () => {
  const shops = [
    { ecosystem_id: "a", ecosystem_name: "Sagada Wave", is_current: true },
    { ecosystem_id: "b", ecosystem_name: "Banaue Net", is_current: false },
  ];

  it("names only shops the member is approved in", () => {
    expect(selectedShopNames(shops, ["b", "zzz"])).toEqual(["Banaue Net"]);
  });

  it("summarises each audience for the review step", () => {
    expect(audienceSummary("general", shops, [], "Sagada Wave")).toBe("General / All Shops");
    expect(audienceSummary("ecosystem", shops, [], "Sagada Wave")).toBe("Sagada Wave");
    expect(audienceSummary("shops", shops, ["a", "b"], "Sagada Wave")).toBe(
      "Sagada Wave, Banaue Net",
    );
  });

  const ready = {
    body: "Hello universe",
    audience: "ecosystem" as const,
    shopIds: [],
    promote: false,
    tierChosen: true,
    affordable: true,
  };

  it("allows a plain post with no promotion", () => {
    expect(postReadiness(ready)).toBeNull();
  });

  it("blocks a shop-targeted post with no shop chosen", () => {
    expect(postReadiness({ ...ready, audience: "shops" })).toMatch(/at least one shop/i);
  });

  it("blocks promotion without a chosen tier and without funds", () => {
    expect(postReadiness({ ...ready, promote: true, tierChosen: false })).toMatch(
      /promotion type/i,
    );
    expect(postReadiness({ ...ready, affordable: false })).toMatch(/enough/i);
  });

  it("keeps promotion free until it is switched on", () => {
    const state = {
      post_cost: 1,
      promotion_currency: "social" as const,
      promotion_cost_social: 20,
      promotion_cost_points: 200,
      free_posts_left: 0,
    };
    expect(postCharge(state, false)).toEqual({ amount: 1, currency: "social", free: false });
    expect(postCharge(state, true)).toEqual({ amount: 20, currency: "social", free: false });
  });

  it("badges operators only", () => {
    expect(roleBadge("super_admin")).toBe("Platform");
    expect(roleBadge("admin")).toBe("Shop admin");
    expect(roleBadge("customer")).toBeNull();
  });
});

describe("threaded replies", () => {
  const c = (id: string, parent: string | null, depth: number, at: string) =>
    ({
      id,
      author_id: "u",
      author_name: "Member",
      author_handle: "member",
      author_avatar: null,
      body: id,
      created_at: at,
      can_delete: false,
      parent_id: parent,
      depth,
    }) as FeedComment;

  it("stops at three levels", () => {
    expect(MAX_REPLY_DEPTH).toBe(3);
    expect(canReplyTo(1)).toBe(true);
    expect(canReplyTo(2)).toBe(true);
    expect(canReplyTo(3)).toBe(false);
  });

  it("places every reply directly under its parent", () => {
    const flat = [
      c("a", null, 1, "2026-01-01T00:00:00Z"),
      c("b", null, 1, "2026-01-01T00:02:00Z"),
      c("a1", "a", 2, "2026-01-01T00:01:00Z"),
      c("a1x", "a1", 3, "2026-01-01T00:01:30Z"),
    ];
    expect(threadComments(flat).map((x) => [x.id, x.depth])).toEqual([
      ["a", 1],
      ["a1", 2],
      ["a1x", 3],
      ["b", 1],
    ]);
  });

  it("keeps a reply visible when its parent is gone", () => {
    const flat = [c("orphan", "deleted", 2, "2026-01-01T00:00:00Z")];
    expect(threadComments(flat).map((x) => [x.id, x.depth])).toEqual([["orphan", 1]]);
  });
});

describe("free posts per day", () => {
  it("makes an ordinary post free while the daily allowance lasts", () => {
    expect(postCharge({ ...state, free_posts_left: 1 }, false)).toEqual({
      amount: 0,
      currency: "social",
      free: true,
    });
  });

  it("charges paid social credits once the allowance is used", () => {
    expect(postCharge({ ...state, free_posts_left: 0 }, false)).toEqual({
      amount: 1,
      currency: "social",
      free: false,
    });
  });

  it("never makes a promotion free, even with a free post left", () => {
    expect(postCharge({ ...state, free_posts_left: 5 }, true).amount).toBe(20);
  });

  it("follows the platform owner's configured allowance", () => {
    const three = freePostDisclosure({ free_posts_left: 3, free_posts_per_day: 3, post_cost: 1 });
    expect(three[0]).toBe("Free posts remaining today: 3 of 3");
    const none = freePostDisclosure({ free_posts_left: 0, free_posts_per_day: 1, post_cost: 2 });
    expect(none[1]).toMatch(/cost 2 paid social credits/);
    expect(none[2]).toMatch(/cannot be gifted/i);
  });

  it("keeps likes, replies and DMs free", () => {
    expect(LIKE_COST).toBe(0);
    expect(DM_COST).toBe(0);
    expect(commentCharge()).toBe(0);
  });
});

describe("social credit gifting", () => {
  it("refuses to gift when the member only holds promotional credits", () => {
    expect(giftIssue({ purchased_balance: 0, amount: 5, isSelf: false })).toMatch(
      /Free promotional credits cannot be gifted/,
    );
    expect(canGift({ purchased_balance: 0 }, false)).toBe(false);
  });

  it("refuses self-gifts", () => {
    expect(giftIssue({ purchased_balance: 50, amount: 5, isSelf: true })).toMatch(/yourself/);
    expect(canGift({ purchased_balance: 50 }, true)).toBe(false);
  });

  it("refuses amounts above the purchased balance", () => {
    expect(giftIssue({ purchased_balance: 3, amount: 4, isSelf: false })).toMatch(/only have 3/);
  });

  it("refuses zero, fractional and oversized gifts", () => {
    expect(giftIssue({ purchased_balance: 50, amount: 0, isSelf: false })).toBeTruthy();
    expect(giftIssue({ purchased_balance: 50, amount: 1.5, isSelf: false })).toMatch(/whole/);
    expect(giftIssue({ purchased_balance: 50_000, amount: 1001, isSelf: false })).toMatch(/at most/);
  });

  it("allows a gift funded entirely by purchased credits", () => {
    expect(giftIssue({ purchased_balance: 10, amount: 10, isSelf: false })).toBeNull();
    expect(canGift({ purchased_balance: 10 }, false)).toBe(true);
  });
});
