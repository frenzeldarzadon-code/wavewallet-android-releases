/**
 * Nearest-match ranking for the credit-transfer recipient picker.
 *
 * The database (`lookup_transfer_recipient`) decides *who* may appear: same
 * ecosystem, active, and allowed by the existing transfer rules. This module
 * only decides how the already-authorized matches are ordered and described,
 * so it is safe to test in isolation and can never widen visibility.
 */
import type { RecipientMatch } from "@/lib/wallet";

/** Shortest query the server will answer. */
export const MIN_RECIPIENT_QUERY = 2;

export const digitsOnly = (value: string) => value.replace(/[^0-9]/g, "");

const normalize = (value: string) => value.trim().toLowerCase();

/** Strips a leading @ so "@ana" and "ana" match the same handle. */
export const handleQuery = (value: string) => normalize(value).replace(/^@+/, "");

/**
 * Lower is closer. Exact handle/name match first, then prefix, then any
 * substring on name, handle, masked email or phone digits.
 */
export function recipientScore(match: RecipientMatch, query: string): number {
  const q = normalize(query);
  if (!q) return 99;
  const name = normalize(match.full_name);
  const handle = normalize(match.handle ?? "");
  const h = handleQuery(query);
  const digits = digitsOnly(query);
  const phoneDigits = digitsOnly(match.phone ?? "");

  if (handle && handle === h) return 0;
  if (name === q) return 1;
  if (digits.length >= 4 && phoneDigits.endsWith(digits)) return 2;
  if (name.startsWith(q)) return 3;
  if (handle && handle.startsWith(h)) return 4;
  if (name.includes(q)) return 5;
  if (handle && h && handle.includes(h)) return 6;
  if (normalize(match.masked_email ?? "").includes(q)) return 7;
  if (digits && phoneDigits.includes(digits)) return 8;
  return 9;
}

/** Closest matches first; ties keep alphabetical order for a stable list. */
export function rankRecipients(matches: RecipientMatch[], query: string): RecipientMatch[] {
  return [...matches].sort((a, b) => {
    const diff = recipientScore(a, query) - recipientScore(b, query);
    return diff !== 0 ? diff : a.full_name.localeCompare(b.full_name);
  });
}

/**
 * One line of identifying detail — handle, masked email and phone — so the
 * sender can tell two similarly named members apart without the app exposing
 * anything the database did not already return.
 */
export function recipientIdentityLine(match: RecipientMatch): string {
  return [match.handle ? `@${match.handle}` : null, match.masked_email, match.phone]
    .filter(Boolean)
    .join(" · ");
}
