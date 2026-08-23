/**
 * Server-side mirror of the Android GCash notification parser.
 *
 * The paired phone already parses each notification, but older builds may send
 * a notification whose amount or reference it could not read. The ingest route
 * re-reads the raw text with this parser so a real payment is never lost just
 * because the phone shipped with an older parser.
 *
 * v3 adds bank-to-GCash wording (InstaPay / PESONet / "credited to your GCash
 * account"), reads bank reference numbers, and can carry a bank account number
 * as the sending account when the payer is not a mobile wallet.
 *
 * This parser never decides anything financial — it only reads text.
 */

export const GCASH_PARSER_VERSION = "gcash-ph-v3";

export type GcashNotification = {
  incoming: boolean;
  amountPhp: number | null;
  senderNumber: string | null;
  senderName: string | null;
  reference: string | null;
};

/** Phrases that mean this is NOT an incoming payment. Checked first. */
const REJECT = [
  /you\s+have\s+sent/i,
  /you\s+sent/i,
  /sent\s+php/i,
  /payment\s+sent/i,
  /cash\s*out/i,
  /has\s+been\s+debited/i,
  /debited\s+from/i,
  /your\s+(?:instapay|pesonet|fund)\s+transfer/i,
  /transfer(?:red)?\s+to\s+(?:account|[A-Z*]{2,})/i,
  /paid\s+php/i,
  /refund/i,
  /bills?\s+payment/i,
  /gcredit/i,
  /ginvest/i,
  /promo|voucher|discount|win\s+up\s+to|limited\s+time/i,
  /reminder|verify\s+your/i,
];

/** Phrases that positively identify an incoming payment. */
const INCOMING = [
  /you\s+have\s+received\s+money\s+in\s+gcash/i,
  /you\s+(?:have\s+)?received\s+php\s*[\d,]+(?:\.\d{1,2})?/i,
  /received\s+php\s*[\d,]+(?:\.\d{1,2})?\s+(?:from|via|through)/i,
  /express\s+send/i,
  // Bank -> GCash (InstaPay / PESONet) credit wording.
  /credited\s+to\s+your\s+gcash/i,
  /has\s+been\s+credited/i,
  /credited\s+with\s+php/i,
  /(?:instapay|pesonet)\b/i,
  /(?:bank\s+transfer|fund\s+transfer)\s+(?:received|credit)/i,
];

/** Amount candidates, most specific first. Balances are never read as amounts. */
const AMOUNTS = [
  /(?:received|credited\s+with|credit\s+of)\s*(?:PHP|Php|₱)\s*([\d,]+(?:\.\d{1,2})?)/i,
  /(?:PHP|₱)\s*([\d,]+(?:\.\d{1,2})?)\s+(?:has\s+been\s+|was\s+)?(?:credited|received)/i,
  /(?:amount|amt)\s*[:\-]?\s*(?:PHP|₱)\s*([\d,]+(?:\.\d{1,2})?)/i,
];
const PH_NUMBER = /(?:^|[^\d])(09\d{9}|639\d{9}|\+639\d{9})(?!\d)/;
/** A bank account number when the payer is not a mobile wallet. */
const ACCOUNT_NUMBER = /(?:^|[^\d])(\d{8,19})(?!\d)/;
const REFERENCE =
  /\b(?:ref(?:erence)?|transaction|trace|txn)\.?\s*(?:no\.?|number|id|#)?\s*[:.\-]?\s*([A-Za-z0-9-]{6,32})/i;
/** Everything between "from" and the message/balance/reference tail. */
const SENDER_SEGMENT =
  /\bfrom\s+([\s\S]+?)(?=\s*(?:w\/\s*msg|with\s+msg|your\s+new\s+balance|new\s+balance|via\b|ref\b|reference\b|transaction\b|trace\b)|\.?\s*$)/i;

export function normalizePhMobile(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("639")) return `0${digits.slice(2)}`;
  if (digits.length === 11 && digits.startsWith("09")) return digits;
  if (digits.length === 10 && digits.startsWith("9")) return `0${digits}`;
  return digits || null;
}

/** Reads one GCash notification. Whitespace, line breaks and title/body split are normalised. */
export function parseGcashNotification(
  title: string | null | undefined,
  text?: string | null,
): GcashNotification {
  const body = [title, text]
    .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  const empty: GcashNotification = {
    incoming: false,
    amountPhp: null,
    senderNumber: null,
    senderName: null,
    reference: null,
  };
  if (!body) return empty;
  if (REJECT.some((r) => r.test(body))) return empty;
  if (!INCOMING.some((r) => r.test(body))) return empty;

  let amountRaw: string | null = null;
  for (const re of AMOUNTS) {
    const hit = re.exec(body)?.[1];
    if (hit) {
      amountRaw = hit;
      break;
    }
  }
  const amount = amountRaw ? Number(amountRaw.replace(/,/g, "")) : NaN;
  const reference = REFERENCE.exec(body)?.[1] ?? null;
  const segment = SENDER_SEGMENT.exec(body)?.[1]?.trim() ?? null;
  const mobile = (segment ? PH_NUMBER.exec(segment)?.[1] : null) ?? PH_NUMBER.exec(body)?.[1] ?? null;
  // A bank payer has an account number, not a mobile number. Only the "from"
  // segment is trusted for this, and never the reference number itself.
  const account =
    !mobile && segment
      ? (ACCOUNT_NUMBER.exec(segment)?.[1] ?? null)
      : null;
  const payer = mobile ?? (account && account !== reference ? account : null);
  const name =
    segment
      ?.replace(payer ?? "", "")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/^[,\-.\s]+|[,\-\s]+$/g, "")
      .trim() || null;

  return {
    incoming: true,
    amountPhp: Number.isFinite(amount) && amount > 0 ? Number(amount.toFixed(2)) : null,
    senderNumber: mobile ? normalizePhMobile(mobile) : payer,
    senderName: name && name.length <= 160 ? name : null,
    reference,
  };
}
