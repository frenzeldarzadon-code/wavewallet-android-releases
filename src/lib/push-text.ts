/**
 * What a phone's lock screen is allowed to say.
 *
 * The in-app inbox keeps the fuller wording. The push itself is deliberately
 * short and never carries amounts, balances, message text or order contents:
 * "You have a new message" — the app opens to the details after sign-in.
 */
import { isFinancialKind } from "@/lib/financial-notifications";

export interface PushText {
  title: string;
  body: string;
  /** Collapses repeated pushes of the same kind for the same place. */
  tag: string;
}

const FINANCIAL_TITLES: Record<string, string> = {
  cash_in: "Cash In update",
  purchase: "Purchase update",
  cashback: "Cashback received",
  transfer: "Coins received or sent",
  points: "Points update",
  reward_redemption: "Reward redemption update",
  refund: "Refund or reversal",
  withdrawal: "Cash Out update",
  wallet_adjustment: "Wallet update",
};

const SOCIAL_TITLES: Record<string, string> = {
  dm_message: "New private message",
  friend_request: "New friend request",
  friend_accept: "Friend request accepted",
  follow: "New follower",
  social_gift: "You received a coin gift",
  social_like: "Someone liked your post",
  social_reply: "New reply",
  social_mention: "You were mentioned",
  shop_invitation: "Shop invitation",
  shop_assignment: "Shop role update",
  test: "Test notification",
};

const DETAILS = "Open ONE WAVE to see the details.";

/** Strips digits/amounts so a stored title can never leak a figure. */
function neutral(title: string): string {
  return title.replace(/[—–-]\s*[\d.,]+.*$/, "").replace(/\d[\d.,]*/g, "").trim();
}

export function pushText(input: {
  kind: string;
  category?: string | null;
  title: string;
  body?: string | null;
  link?: string | null;
}): PushText {
  const kind = input.kind;
  const tagBase = input.link && input.link.startsWith("/") ? input.link.split("?")[0] : "universe";
  const tag = `${kind}:${tagBase}`.replace(/[^A-Za-z0-9_:/-]/g, "").slice(0, 64);

  if (kind.startsWith("order_")) {
    return { title: "Order update", body: DETAILS, tag };
  }
  if (isFinancialKind(kind) || input.category === "financial") {
    return { title: FINANCIAL_TITLES[kind] ?? "Wallet update", body: DETAILS, tag };
  }
  const title = SOCIAL_TITLES[kind] ?? neutral(input.title) ?? "New notification";
  if (kind === "test") {
    return { title, body: input.body ?? DETAILS, tag };
  }
  return { title: title || "New notification", body: DETAILS, tag };
}
