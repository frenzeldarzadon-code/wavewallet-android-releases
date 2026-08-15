/**
 * Login identifiers for the one global WaveWallet account.
 *
 * A person signs up with an email, a mobile number, or both — at least one is
 * required. The authentication provider itself always works with an email
 * address, so a phone-only account gets a deterministic, non-deliverable
 * address derived from the normalised number. Nothing is ever looked up from
 * the database to resolve a login, so no identifier can be enumerated.
 */

import { newPasswordIssue } from "@/lib/password-policy";

/** Reserved domain for phone-only accounts. Mail is never sent here. */
export const PHONE_EMAIL_DOMAIN = "phone.wavewallet.local";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function looksLikeEmail(value: string): boolean {
  return EMAIL_RE.test(value.trim());
}

/** Digits only, so `0917 000 0000` and `+63 917 000 0000` never diverge. */
export function normalizePhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  // Philippine numbers are entered both as 09xx… and +639xx… — store one form.
  if (digits.length === 12 && digits.startsWith("63")) return `0${digits.slice(2)}`;
  if (digits.length === 10 && digits.startsWith("9")) return `0${digits}`;
  return digits;
}

export function isValidPhone(value: string): boolean {
  return normalizePhone(value).length >= 7;
}

/** Deterministic auth address for an account that has no email. */
export function syntheticEmailForPhone(phone: string): string {
  return `p${normalizePhone(phone)}@${PHONE_EMAIL_DOMAIN}`;
}

/** True when the stored address is a real, reachable mailbox. */
export function isRealEmail(email: string | null | undefined): boolean {
  const value = (email ?? "").trim().toLowerCase();
  return looksLikeEmail(value) && !value.endsWith(`@${PHONE_EMAIL_DOMAIN}`);
}

/**
 * Turns whatever the visitor typed into the address the auth provider expects.
 * Returns null when it is neither a usable email nor a usable phone number.
 */
export function resolveLoginEmail(identifier: string): string | null {
  const raw = identifier.trim();
  if (!raw) return null;
  if (looksLikeEmail(raw)) return raw.toLowerCase();
  if (isValidPhone(raw)) return syntheticEmailForPhone(raw);
  return null;
}

export interface GlobalSignupDraft {
  name: string;
  email: string;
  phone: string;
  password: string;
  confirm: string;
}

/** Client-side validation for the global signup form. Returns null when valid. */
export function validateGlobalSignup(d: GlobalSignupDraft): string | null {
  if (!d.name.trim()) return "Enter your full name.";
  const hasEmail = Boolean(d.email.trim());
  const hasPhone = Boolean(d.phone.trim());
  if (!hasEmail && !hasPhone) return "Enter an email address or a mobile number — at least one.";
  if (hasEmail && !looksLikeEmail(d.email)) return "Enter a valid email address.";
  if (hasPhone && !isValidPhone(d.phone)) return "Enter a valid mobile number.";
  return newPasswordIssue(d.password, d.confirm);
}

/** The address the account will actually authenticate with. */
export function signupAuthEmail(d: Pick<GlobalSignupDraft, "email" | "phone">): string {
  const email = d.email.trim().toLowerCase();
  if (email) return email;
  return syntheticEmailForPhone(d.phone);
}
