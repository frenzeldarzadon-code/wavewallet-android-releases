/**
 * What a phone's lock screen says.
 *
 * The database already writes each alert with the facts of the event (who,
 * what, how much, which shop) — the push reuses that wording so the person
 * understands what happened WITHOUT opening the app. Nothing is invented:
 * every name, amount and status comes from the stored notification row.
 *
 * Safety: references, codes, long numbers, URLs and e-mail addresses are
 * scrubbed before anything reaches the lock screen; private message bodies
 * are never stored in notifications, so a chat push only names the sender.
 * When the person turned "Show details on the lock screen" off, every push
 * collapses to a neutral one-liner.
 */
import { isFinancialKind } from "@/lib/financial-notifications";

export interface PushText {
  title: string;
  body: string;
  /** Collapses repeated pushes of the same kind for the same place. */
  tag: string;
  /** Where a tap should land. */
  link: string;
}

export interface PushTextInput {
  kind: string;
  category?: string | null;
  title: string;
  body?: string | null;
  link?: string | null;
  /** Shop scope of a financial event; null means the global Universe wallet. */
  ecosystem_id?: string | null;
  /** Person's privacy switch; defaults to detailed. */
  show_details?: boolean | null;
}

const OPEN = "Open ONE WAVE to see the details.";

const GENERIC_TITLES: Record<string, string> = {
  cash_in: "Cash In update",
  purchase: "Purchase update",
  cashback: "Cashback received",
  transfer: "Coins received or sent",
  points: "Points update",
  reward_redemption: "Reward redemption update",
  refund: "Refund or reversal",
  withdrawal: "Cash Out update",
  wallet_adjustment: "Wallet update",
  dm_message: "New private message",
  friend_request: "New friend request",
  friend_accept: "Friend request accepted",
  follow: "New follower",
  social_gift: "You received a gift",
  social_like: "Someone reacted to your post",
  social_reply: "New reply to your post",
  social_mention: "You were mentioned",
  shop_invitation: "Shop invitation",
  shop_assignment: "Shop membership update",
  shop_admin_assigned: "Shop role update",
  membership_auto_approved: "Shop membership update",
  retail_order: "Order update",
  subscription: "Shop subscription update",
  test: "Test notification",
};

const MAX_TITLE = 60;
const MAX_BODY = 140;

/** Removes anything that should never sit on a lock screen. */
export function scrub(text: string | null | undefined): string {
  if (!text) return "";
  return (
    text
      // "• reference CI-4F249FFBE4", "ref: WD-…", "reference number 123"
      .replace(
        /\s*[•|,;(-]?\s*\b(reference|ref\.?|reference no\.?|txn id|transaction id)\b\s*[:#]?\s*[A-Za-z0-9-]+\)?/gi,
        "",
      )
      // voucher / access codes
      .replace(/\b(code|voucher code|pin)\b\s*[:#]?\s*[A-Za-z0-9-]{4,}/gi, "$1 hidden")
      // urls and e-mails
      .replace(/https?:\/\/\S+/gi, "")
      .replace(/\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g, "")
      // account / phone numbers: 7+ digits in a row (amounts never get that long unformatted)
      .replace(/\b\d[\d ]{6,}\d\b/g, "••••")
      .replace(/\s{2,}/g, " ")
      .replace(/\s+([.,;:!?])/g, "$1")
      .replace(/[—–-]\s*$/, "")
      .trim()
  );
}

function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

function sentence(text: string): string {
  const t = text.trim();
  if (!t) return t;
  return /[.!?…]$/.test(t) ? t : `${t}.`;
}

/** "Cashback received — 27.60 Coins" -> { head: "Cashback received", tail: "27.60 Coins" } */
function splitDash(title: string): { head: string; tail: string } {
  const m = title.match(/^(.*?)\s+[—–-]\s+(.*)$/);
  return m ? { head: m[1]!.trim(), tail: m[2]!.trim() } : { head: title.trim(), tail: "" };
}

function firstName(body: string, pattern: RegExp): string | null {
  const m = body.match(pattern);
  const name = m?.[1]?.trim();
  return name && name.length <= 60 ? name : null;
}

function defaultLink(input: PushTextInput): string {
  if (input.link && input.link.startsWith("/")) return input.link;
  if (isFinancialKind(input.kind) || input.category === "financial") {
    // Global-wallet events live on the Universe wallet page; shop wallet
    // events have role-specific pages, so the inbox stays the safe landing.
    return input.ecosystem_id ? "/universe/notifications" : "/universe/wallet";
  }
  return "/universe/notifications";
}

function detailed(input: PushTextInput): { title: string; body: string } {
  const kind = input.kind;
  const title = scrub(input.title);
  const body = scrub(input.body);
  const { head, tail } = splitDash(title);

  switch (kind) {
    case "dm_message": {
      const who = firstName(body, /^(.+?) sent you a message/i);
      return who
        ? { title: `New message from ${who}`, body: "You have a new private message." }
        : { title: "New private message", body: "You have a new private message." };
    }
    case "friend_request": {
      const who = firstName(body, /^(.+?) wants to be friends/i);
      return {
        title: "New friend request",
        body: who ? `${who} wants to be your friend.` : sentence(body) || OPEN,
      };
    }
    case "friend_accept": {
      const who = firstName(body, /^(.+?) accepted your friend request/i);
      return {
        title: "Friend request accepted",
        body: who ? `${who} accepted your friend request.` : sentence(body) || OPEN,
      };
    }
    case "follow": {
      const who = firstName(body, /^(.+?) started following you/i);
      return {
        title: "New follower",
        body: who ? `${who} started following you.` : sentence(body) || OPEN,
      };
    }
    case "social_like": {
      const who = firstName(body, /^(.+?) liked your post/i);
      return {
        title: "Someone reacted to your post",
        body: who ? `${who} liked your post.` : sentence(body) || OPEN,
      };
    }
    case "social_reply": {
      const who = firstName(body, /^(.+?) replied to you/i);
      return {
        title: "New reply to your post",
        body: who ? `${who} replied to your post.` : sentence(body) || OPEN,
      };
    }
    case "social_mention": {
      const who = firstName(body, /^(.+?) mentioned you/i);
      return {
        title: "You were mentioned",
        body: who ? `${who} mentioned you in a post.` : sentence(body) || OPEN,
      };
    }
    case "social_gift": {
      // "Gift from Ana — 5 social credits on your post" (or the legacy
      // "5 paid social credits — Gift from Ana")
      const who = firstName(body, /Gift from (.+?)(?:\s+[—–-]|$)/i);
      const amount = body.match(/(\d[\d.,]*)\s+(?:paid\s+)?social credits/i)?.[1];
      const what = amount ? `a gift of ${amount} social credits` : "a gift";
      return {
        title: "You received a gift",
        body: who ? `${who} sent you ${what} on your post.` : `You received ${what} on your post.`,
      };
    }
    case "cash_in":
    case "withdrawal": {
      // "Cash In approved — 100.00 Coins credited" / body "PHP 100.00 • reference …"
      const amount = (tail || body)
        .replace(/\s*\b(credited|debited|released|held|refunded)\b.*$/i, "")
        .trim();
      const status = head.replace(/^cash (in|out)\s*/i, "").trim() || "update";
      const label = kind === "cash_in" ? "Cash In" : "Cash Out";
      const money = amount ? ` of ${amount}` : "";
      return {
        title: `${label} ${status}`,
        body: sentence(`Your ${label.toLowerCase()}${money} ${statusPhrase(status)}`),
      };
    }
    case "cashback": {
      // body: "Shop cashback — Sagada Wave PHP20 ×2 (69% remainder …)" → keep the product/shop part
      const source = body
        .replace(/^(shop|reseller|subreseller|member|retail|voucher)?\s*cashback\s*[—–-]\s*/i, "")
        .replace(/\s*\(.*\)\s*$/, "")
        .trim();
      const from = source ? ` from ${source}` : "";
      return {
        title: "Cashback received",
        body: sentence(`You received ${tail || "cashback"}${tail ? " cashback" : ""}${from}`),
      };
    }
    case "transfer":
    case "wallet_adjustment": {
      const fromMember = firstName(body, /Universe coins from (.+)$/i);
      const toMember = firstName(body, /Universe coins to (.+)$/i);
      const amount = tail.replace(/\s*Coins?$/i, "");
      if (fromMember)
        return { title: "You received coins", body: `${fromMember} sent you ${amount} coins.` };
      if (toMember)
        return { title: "Coins sent", body: `You sent ${amount} coins to ${toMember}.` };
      if (/added by the platform/i.test(head)) {
        return {
          title: "Credit received",
          body: `You received ${amount} coins from Super Admin${body ? ` — ${body}` : ""}.`,
        };
      }
      if (/^coins received/i.test(head))
        return {
          title: "Coins received",
          body: sentence(`You received ${amount} coins${body ? ` — ${body}` : ""}`),
        };
      if (/^coins sent/i.test(head))
        return {
          title: "Coins sent",
          body: sentence(`You sent ${amount} coins${body ? ` — ${body}` : ""}`),
        };
      return {
        title: head || GENERIC_TITLES[kind]!,
        body: sentence([tail, body].filter(Boolean).join(" — ")) || OPEN,
      };
    }
    case "purchase": {
      const voucher = /voucher/i.test(body);
      // body: "Self purchase — Voucher — Sagada Wave PHP20 ×2 — ₱40.00 − …" → keep the item name
      const parts = body
        .split(/\s*[—–]\s*/)
        .filter((p) => p && !/purchase$/i.test(p) && !/^voucher$/i.test(p) && !/[₱=]/.test(p));
      const item = parts[0] ?? "";
      return {
        title: voucher ? "Voucher purchased" : "Purchase completed",
        body: sentence(
          `Your ${voucher ? "voucher " : ""}purchase${item ? ` of ${item}` : ""}${tail ? ` (${tail})` : ""} was successful`,
        ),
      };
    }
    case "retail_order": {
      if (/^new retail order/i.test(head) || /^new retail order/i.test(title)) {
        return { title: "New customer order", body: sentence(body) || sentence(title) };
      }
      if (/delivered/i.test(title) || /delivered/i.test(body)) {
        return {
          title: "Product delivered",
          body: sentence(body) || "Your order has been delivered.",
        };
      }
      return { title: clip(title, MAX_TITLE) || "Order update", body: sentence(body) || OPEN };
    }
    case "test":
      return { title, body: body || OPEN };
    default:
      // points, refund, reward_redemption, shop_* and future kinds: the stored
      // wording already says what happened.
      return {
        title: title || GENERIC_TITLES[kind] || "New notification",
        body: sentence(body || tail) || OPEN,
      };
  }
}

function statusPhrase(status: string): string {
  const s = status.toLowerCase();
  if (/approved|credited|released|completed|paid/.test(s)) return `was ${s}`;
  if (/pending|review|waiting|processing/.test(s)) return `is ${s}`;
  if (/rejected|declined|cancel|failed|returned/.test(s)) return `was ${s}`;
  return `— ${status}`;
}

export function pushText(input: PushTextInput): PushText {
  const kind = input.kind;
  const link = defaultLink(input);
  const tagBase = link.split("?")[0] ?? "universe";
  const tag = `${kind}:${tagBase}`.replace(/[^A-Za-z0-9_:/-]/g, "").slice(0, 64);

  if (input.show_details === false) {
    const title =
      GENERIC_TITLES[kind] ??
      (isFinancialKind(kind) || input.category === "financial"
        ? "Wallet update"
        : "New notification");
    return { title, body: OPEN, tag, link };
  }

  const d = detailed(input);
  return {
    title: clip(d.title || "New notification", MAX_TITLE),
    body: clip(d.body || OPEN, MAX_BODY),
    tag,
    link,
  };
}
