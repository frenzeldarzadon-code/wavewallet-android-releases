import { describe, expect, it } from "vitest";
import { pushText, scrub } from "@/lib/push-text";

const t = (
  kind: string,
  title: string,
  body: string | null = null,
  extra: Record<string, unknown> = {},
) => pushText({ kind, title, body, ...extra });

describe("pushText — event-specific lock-screen wording", () => {
  it("post gift names the giver and the amount", () => {
    const p = t(
      "social_gift",
      "You received a gift",
      "Gift from Ana Reyes — 5 social credits on your post",
      {
        link: "/universe?post=abc",
      },
    );
    expect(p.title).toBe("You received a gift");
    expect(p.body).toBe("Ana Reyes sent you a gift of 5 social credits on your post.");
    expect(p.link).toBe("/universe?post=abc");
  });

  it("legacy gift wording still parses", () => {
    const p = t(
      "social_gift",
      "You received social credits",
      "5 paid social credits — Gift from Ana",
    );
    expect(p.body).toBe("Ana sent you a gift of 5 social credits on your post.");
  });

  it("friend request / accepted / follower", () => {
    expect(t("friend_request", "New friend request", "Ben Cruz wants to be friends").body).toBe(
      "Ben Cruz wants to be your friend.",
    );
    expect(
      t("friend_accept", "Friend request accepted", "Ben Cruz accepted your friend request").body,
    ).toBe("Ben Cruz accepted your friend request.");
    const f = t("follow", "New follower", "Ben Cruz started following you", {
      link: "/universe/u/ben",
    });
    expect(f.title).toBe("New follower");
    expect(f.body).toBe("Ben Cruz started following you.");
    expect(f.link).toBe("/universe/u/ben");
  });

  it("private message names the sender and never carries message text", () => {
    const p = t("dm_message", "New private message", "Carla Dee sent you a message", {
      link: "/universe/messages?thread=t1",
    });
    expect(p.title).toBe("New message from Carla Dee");
    expect(p.body).toBe("You have a new private message.");
    expect(p.link).toBe("/universe/messages?thread=t1");
  });

  it("post reactions, replies and mentions", () => {
    expect(t("social_like", "New like on your post", "Demo Reseller liked your post").title).toBe(
      "Someone reacted to your post",
    );
    expect(t("social_reply", "New reply", "Frenzel replied to you").body).toBe(
      "Frenzel replied to your post.",
    );
    expect(t("social_mention", "You were mentioned", "Frenzel mentioned you").body).toBe(
      "Frenzel mentioned you in a post.",
    );
  });

  it("retail orders: new order, status, delivered", () => {
    const n = t(
      "retail_order",
      "New retail order R-1042",
      "Ana placed a cash-on-delivery order worth 120 coins.",
    );
    expect(n.title).toBe("New customer order");
    expect(n.body).toBe("Ana placed a cash-on-delivery order worth 120 coins.");
    const s = t("retail_order", "Order R-1042 approved", "Your order is confirmed.");
    expect(s.title).toBe("Order R-1042 approved");
    expect(s.body).toBe("Your order is confirmed.");
    const d = t("retail_order", "Order R-1042 delivered", "Your order has been delivered.");
    expect(d.title).toBe("Product delivered");
  });

  it("cashback says how much and from where", () => {
    const p = t(
      "cashback",
      "Cashback received — 7.00 Coins",
      "Shop cashback — Sagada Wave PHP20 ×2",
      {
        category: "financial",
        ecosystem_id: null,
      },
    );
    expect(p.title).toBe("Cashback received");
    expect(p.body).toBe("You received 7.00 Coins cashback from Sagada Wave PHP20 ×2.");
    expect(p.link).toBe("/universe/wallet");
  });

  it("Super Admin credit and member-to-member coins", () => {
    expect(t("wallet_adjustment", "Coins added by the platform — 50.00", null).body).toBe(
      "You received 50.00 coins from Super Admin.",
    );
    const r = t(
      "wallet_adjustment",
      "Wallet credited — 38.00 Coins",
      "Credit transfer received — Universe coins from @ana",
    );
    expect(r.title).toBe("You received coins");
    expect(r.body).toBe("@ana sent you 38.00 coins.");
    const s = t(
      "wallet_adjustment",
      "Wallet debited — 38.00 Coins",
      "Credit transfer sent — Universe coins to @ben",
    );
    expect(s.body).toBe("You sent 38.00 coins to @ben.");
    expect(t("transfer", "Coins received — 10.00", null).body).toBe("You received 10.00 coins.");
  });

  it("cash in / cash out carry status and amount but never the reference", () => {
    const a = t(
      "cash_in",
      "Cash In approved — 100.00 Coins credited",
      "PHP 100.00 • reference CI-4F249FFBE4",
    );
    expect(a.title).toBe("Cash In approved");
    expect(a.body).toBe("Your cash in of 100.00 Coins was approved.");
    expect(a.body).not.toMatch(/CI-4F249/);
    const p = t("cash_in", "Cash In pending review", "PHP 100.00");
    expect(p.title).toBe("Cash In pending review");
    expect(p.body).toBe("Your cash in of PHP 100.00 is pending review.");
    const w = t(
      "withdrawal",
      "Cash Out released — PHP 49,500.00",
      "50,000.00 Coins • reference WD-CA9B32FF26",
    );
    expect(w.title).toBe("Cash Out released");
    expect(w.body).toBe("Your cash out of PHP 49,500.00 was released.");
    expect(w.body).not.toMatch(/WD-/);
  });

  it("voucher purchase never leaks a code", () => {
    const p = t(
      "purchase",
      "Purchase completed — 32.00 Coins",
      "Voucher — Sagada Wave PHP20 ×2 — code ABCD1234",
    );
    expect(p.title).toBe("Voucher purchased");
    expect(p.body).toContain("Sagada Wave PHP20");
    expect(p.body).not.toContain("ABCD1234");
  });

  it("shop events keep their stored wording", () => {
    const p = t(
      "shop_admin_assigned",
      "You now manage Guesang GigaFlex",
      "The platform owner assigned you as the shop admin of Guesang GigaFlex.",
    );
    expect(p.title).toBe("You now manage Guesang GigaFlex");
    expect(p.body).toMatch(/Guesang GigaFlex/);
  });

  it("unknown kinds fall back to the stored title and a safe body", () => {
    const p = t("something_new", "Something happened", null);
    expect(p.title).toBe("Something happened");
    expect(p.body).toBe("Open ONE WAVE to see the details.");
    expect(p.link).toBe("/universe/notifications");
  });

  it("privacy switch off collapses to neutral text", () => {
    const p = t("dm_message", "New private message", "Carla Dee sent you a message", {
      show_details: false,
    });
    expect(p.title).toBe("New private message");
    expect(p.body).toBe("Open ONE WAVE to see the details.");
    expect(p.body).not.toContain("Carla");
  });

  it("scrubs account numbers, urls, emails and references", () => {
    expect(scrub("Sent to 09171234567 via https://x.y/z ref: ABC123 a@b.co")).toBe(
      "Sent to •••• via",
    );
  });

  it("financial shop-wallet events land on the inbox, never a guessed role page", () => {
    expect(
      t("points", "Points earned — 4.00", "Sagada Wave PHP20", {
        category: "financial",
        ecosystem_id: "e1",
      }).link,
    ).toBe("/universe/notifications");
  });
});
