import { describe, expect, it } from "vitest";
import {
  EMPTY_RELATIONSHIP,
  followActionLabel,
  friendActionKind,
  friendActionLabel,
} from "@/lib/universe-social";
import { readFileSync } from "node:fs";
import {
  NOTIFICATION_CATEGORIES,
  notificationLink,
  toggleCategory,
  unreadCount,
  type Notification,
} from "@/lib/notifications";
import { deletionSummary, type DeletionCheck } from "@/lib/platform-users";

const notification = (over: Partial<Notification> = {}): Notification => ({
  id: "n1",
  kind: "social_like",
  title: "Someone liked your post",
  body: null,
  link: "/universe",
  read_at: null,
  created_at: new Date().toISOString(),
  ...over,
});

describe("friend and follow states", () => {
  it("starts with no relationship", () => {
    expect(EMPTY_RELATIONSHIP.friend_status).toBe("none");
    expect(EMPTY_RELATIONSHIP.following).toBe(false);
  });

  it("labels each friend state", () => {
    expect(friendActionLabel("none")).toBe("Add friend");
    expect(friendActionLabel("requested")).toBe("Request sent");
    expect(friendActionLabel("incoming")).toBe("Accept request");
    expect(friendActionLabel("friends")).toBe("Friends");
  });

  it("labels the follow toggle", () => {
    expect(followActionLabel(false)).toBe("Follow");
    expect(followActionLabel(true)).toBe("Following");
  });

  it("never sends a duplicate request while one is pending", () => {
    expect(friendActionKind("none")).toBe("send");
    expect(friendActionKind("requested")).toBe("none");
    expect(friendActionKind("incoming")).toBe("accept");
    expect(friendActionKind("friends")).toBe("remove");
  });
});

describe("community post actions", () => {
  const menuSource = readFileSync("src/components/social/post-member-menu.tsx", "utf8");
  const feedSource = readFileSync("src/components/social/social-page.tsx", "utf8");

  it("keeps other-member Follow, Message, and Gift actions visible", () => {
    expect(menuSource).toContain('following ? "Unfollow" : "Follow"');
    expect(menuSource).toContain(">Message</span>");
    expect(menuSource).toContain(">Gift</span>");
    expect(menuSource).not.toContain(">Gift Social Credit<");
    expect(menuSource).not.toContain(">Send coins<");
  });

  it("uses the existing direct-thread and Universe wallet flows", () => {
    expect(feedSource).toContain("await openThread(post.author_id)");
    expect(feedSource).toContain("<UniverseSendCoinsSheet");
    expect(feedSource).toContain("initialRecipient={coinsRecipient}");
  });

  it("keeps Delete post permission-driven", () => {
    expect(feedSource).toContain("post.can_delete ? { onDelete }");
  });
});

describe("notifications", () => {
  it("counts only unread rows", () => {
    expect(unreadCount([notification(), notification({ id: "n2", read_at: "2026-01-01" })])).toBe(
      1,
    );
  });

  it("covers every promised category", () => {
    const kinds = NOTIFICATION_CATEGORIES.map((c) => c.kind);
    for (const kind of [
      "social_like",
      "social_reply",
      "social_mention",
      "dm_message",
      "friend_request",
      "friend_accept",
      "follow",
      "social_gift",
      "cashback",
      "shop_invitation",
      "shop_assignment",
    ]) {
      expect(kinds).toContain(kind);
    }
  });

  it("only follows in-app links", () => {
    expect(notificationLink(notification({ link: "/universe/messages" }))).toBe(
      "/universe/messages",
    );
    expect(notificationLink(notification({ link: "https://evil.example" }))).toBe("/universe");
    expect(notificationLink(notification({ link: null }))).toBe("/universe");
  });

  it("toggles a category without duplicating it", () => {
    let disabled = toggleCategory([], "follow", false);
    expect(disabled).toEqual(["follow"]);
    disabled = toggleCategory(disabled, "follow", false);
    expect(disabled).toEqual(["follow"]);
    expect(toggleCategory(disabled, "follow", true)).toEqual([]);
  });
});

describe("account deletion safety", () => {
  const base: DeletionCheck = {
    eligible: true,
    credit_total: 0,
    points_total: 0,
    social_purchased: 0,
    reason: "No credits, points or pending money.",
  };

  it("explains why an empty account may go", () => {
    expect(deletionSummary(base)).toContain("No credits");
  });

  it("explains what blocks a funded account", () => {
    expect(
      deletionSummary({
        ...base,
        eligible: false,
        credit_total: 120,
        reason: "They still hold 120 credits.",
      }),
    ).toBe("They still hold 120 credits.");
  });
});
