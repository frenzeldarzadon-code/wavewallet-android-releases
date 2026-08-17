/**
 * Server-side mirror of the Android GCash notification parser.
 *
 * The paired phone already parses each notification, but older builds may send
 * a notification whose amount or reference it could not read. The ingest route
 * re-reads the raw text with this parser so a real payment is never lost just
 * because the phone shipped with an older parser.
 *
 * This parser never decides anything financial — it only reads text.
 */

export const GCASH_PARSER_VERSION = "gcash-ph-v2";

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
  /you\s+have\s+received\s+php\s*[\d,]+(?:\.\d{1,2})?/i,
  /received\s+php\s*[\d,]+(?:\.\d{1,2})?\s+from/i,
  /express\s+send/i,
];

const AMOUNT = /received\s+PHP\s*([\d,]+(?:\.\d{1,2})?)/i;
const PH_NUMBER = /(?:^|[^\d])(09\d{9}|639\d{9}|\+639\d{9})(?!\d)/;
const REFERENCE = /\bref(?:erence)?\.?\s*(?:no\.?|number|#)?\s*[:.\-]?\s*([A-Za-z0-9-]{6,32})/i;
/** Everything between "from" and the message/balance/reference tail. */
const SENDER_SEGMENT = /\bfrom\s+([\s\S]+?)(?=\s*(?:w\/\s*msg|with\s+msg|your\s+new\s+balance|ref\b|reference\b)|\.?\s*$)/i;

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

  const amountRaw = AMOUNT.exec(body)?.[1] ?? null;
  const amount = amountRaw ? Number(amountRaw.replace(/,/g, "")) : NaN;
  const segment = SENDER_SEGMENT.exec(body)?.[1]?.trim() ?? null;
  const number = (segment ? PH_NUMBER.exec(segment)?.[1] : null) ?? PH_NUMBER.exec(body)?.[1] ?? null;
  const name =
    segment
      ?.replace(number ?? "", "")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/^[,\-.\s]+|[,\-\s]+$/g, "")
      .trim() || null;

  return {
    incoming: true,
    amountPhp: Number.isFinite(amount) && amount > 0 ? Number(amount.toFixed(2)) : null,
    senderNumber: number ? normalizePhMobile(number) : null,
    senderName: name && name.length <= 160 ? name : null,
    reference: REFERENCE.exec(body)?.[1] ?? null,
  };
}
