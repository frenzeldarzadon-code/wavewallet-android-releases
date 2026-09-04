/**
 * Receiver-side field extraction for payment notifications.
 *
 * The listener phone sits on the platform's RECEIVING account, so every
 * notification it forwards is the payee's view of a transfer: "You have
 * received ₱X from Y", "Received by …", "Ref. No. …". This module keeps the
 * whole text and pulls out every meaningful field it can recognise — never a
 * fixed whitelist that throws the rest away. Anything not present stays absent.
 *
 * It reads text only. Nothing here decides whether money moves.
 */

export type NotificationDetails = {
  /** Always "receiver": the notification is the payee's view. */
  viewpoint: "receiver";
  /** The forwarded text, verbatim. */
  raw_text: string;
  amount_php?: number;
  fee_php?: number;
  /** Remaining / available balance printed in the notification. */
  balance_php?: number;
  reference?: string;
  /** Who the money came FROM ("from Juan D."). */
  sender_name?: string;
  /** Sending mobile / account number as printed. */
  sender_number?: string;
  /** Masked sending account, e.g. "****1234". */
  sender_account_masked?: string;
  /** The account the money was RECEIVED BY, when the notification prints it. */
  receiving_account?: string;
  /** Name of the receiving account holder / merchant, when printed. */
  receiving_name?: string;
  /** Any date / time text printed in the notification, as printed. */
  time_text?: string;
  /** "Send Money", "InstaPay", "QR Ph", "Bank transfer"… as printed. */
  transfer_method?: string;
  /** Free-form message / note the payer attached, when printed. */
  message?: string;
  /** Every "Label: value" pair that appeared in the text. */
  labeled_fields?: Record<string, string>;
};

const money = (s: string | undefined): number | undefined => {
  if (!s) return undefined;
  const n = Number(s.replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 ? n : undefined;
};

const clean = (s: string | undefined): string | undefined => {
  const v = (s ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.,;]+$/, "");
  return v ? v : undefined;
};

const AMOUNT = String.raw`(?:PHP|Php|₱|P)\s?([0-9][0-9,]*(?:\.[0-9]{1,2})?)`;

/**
 * Extracts everything recognisable from a payment notification. Provider
 * agnostic: patterns are label-based ("from", "Ref", "to", "balance"), not
 * tied to one app's wording.
 */
export function extractNotificationFields(text: string | null | undefined): NotificationDetails {
  const raw = (text ?? "").replace(/\s+/g, " ").trim();
  const out: { [K in keyof NotificationDetails]: NotificationDetails[K] | undefined } & {
    viewpoint: "receiver";
    raw_text: string;
  } = { viewpoint: "receiver", raw_text: raw };
  if (!raw) return { viewpoint: "receiver", raw_text: raw };

  // Amount received: the first money value that follows "received" / "receive",
  // else the first money value at all.
  const received = raw.match(new RegExp(String.raw`receiv\w*\s+(?:of\s+)?${AMOUNT}`, "i"));
  const anyAmount = raw.match(new RegExp(AMOUNT));
  out.amount_php = money(received?.[1]) ?? money(anyAmount?.[1]);

  const fee = raw.match(new RegExp(String.raw`(?:fee|charge)[^0-9₱P]{0,20}${AMOUNT}`, "i"));
  out.fee_php = money(fee?.[1]);

  const balance = raw.match(
    new RegExp(
      String.raw`(?:available|new|remaining|current)?\s*balance(?:\s+is)?[^0-9₱P]{0,20}${AMOUNT}`,
      "i",
    ),
  );
  out.balance_php = money(balance?.[1]);

  const ref = raw.match(
    /(?:ref\.?(?:erence)?(?:\s*(?:no|number|#)\.?)?|transaction\s*(?:id|no)\.?|trace\s*no\.?)\s*[:#]?\s*([A-Z0-9][A-Z0-9-]{4,})/i,
  );
  out.reference = clean(ref?.[1]);

  // "from <name> <number>" / "from <name>." — the payer as the receiver sees them.
  // Stops at a connecting word or a sentence break, not at the dot of an initial ("JUAN D.").
  const from = raw.match(
    /\bfrom\s+(.+?)(?=\s+(?:with|to|via|ref|reference|your|on|at)\b|\.\s+[A-Z][a-z]|\.$|!|$)/i,
  );
  if (from) {
    const chunk = clean(from[1]) ?? "";
    const num = chunk.match(/(?:\+?63|0)9\d{2}[\s-]?\d{3}[\s-]?\d{4}/);
    const masked = chunk.match(/(?:\*{2,}|x{2,}|•{2,})\s?\d{3,4}/i);
    if (num) out.sender_number = num[0].replace(/[\s-]/g, "");
    if (masked) out.sender_account_masked = masked[0].replace(/\s/g, "");
    const name = clean(chunk.replace(num?.[0] ?? "", "").replace(masked?.[0] ?? "", ""));
    if (name && !/^\d+$/.test(name)) out.sender_name = name;
  }

  // "to your account ****0072" / "received by 0917…" / "to <name> (…)".
  const to = raw.match(
    /(?:received\s+by|credited\s+to|to\s+your\s+(?:account|wallet|number)|sent\s+to|paid\s+to|to\s+account)\s*[:#]?\s*([^\s.,;]+(?:\s[^\s.,;]+)?)/i,
  );
  if (to) {
    const chunk = clean(to[1]) ?? "";
    const acct = chunk.match(/(?:(?:\*{2,}|x{2,}|•{2,})\s?\d{3,4}|(?:\+?63|0)9\d{9}|\d{6,})/i);
    if (acct) out.receiving_account = acct[0].replace(/\s/g, "");
    else out.receiving_name = chunk;
  }

  const time = raw.match(
    /\b(?:on|at)\s+((?:\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}-\d{2}-\d{2}|[A-Z][a-z]{2,8}\.?\s+\d{1,2},?\s+\d{4})(?:[ ,]+(?:at\s+)?\d{1,2}:\d{2}(?::\d{2})?\s*(?:[AaPp][Mm])?)?|\d{1,2}:\d{2}(?::\d{2})?\s*(?:[AaPp][Mm])?)/,
  );
  out.time_text = clean(time?.[1]);

  const method = raw.match(
    /\b(express\s+send|send\s+money|instapay|pesonet|qr\s*ph|bank\s+transfer|cash\s*in|pay\s*bills|gcash\s*padala)\b/i,
  );
  out.transfer_method = clean(method?.[1]);

  const message = raw.match(/\b(?:message|note|memo)\s*[:-]\s*["“]?([^"”.]{1,160})/i);
  out.message = clean(message?.[1]);

  // Keep every "Label: value" pair too, so nothing readable is lost.
  const labeled: Record<string, string> = {};
  const label = String.raw`[A-Z][A-Za-z]*(?:\s[A-Za-z]+){0,2}`;
  for (const m of raw.matchAll(
    new RegExp(String.raw`\b(${label})\s*:\s*([^:]{1,80})(?=\s+${label}\s*:|\.\s|$)`, "g"),
  )) {
    const key = clean(m[1])?.toLowerCase();
    const val = clean(m[2]);
    if (key && val) labeled[key] = val;
  }
  if (Object.keys(labeled).length > 0) out.labeled_fields = labeled;

  // Drop undefined keys so the stored JSON only contains what was present.
  return Object.fromEntries(
    Object.entries(out).filter(([, v]) => v !== undefined),
  ) as NotificationDetails;
}
