/**
 * Username + password sign-in — an ADDITIONAL way into WaveWallet.
 *
 * A login username is a dedicated name: never an email address, never a phone
 * number. It is unique platform-wide and always compared in lower case. No
 * password is ever stored, echoed or logged by this module; the authentication
 * provider keeps only a salted hash.
 */

/** Shape of a login username as shown to an admin. */
export interface LoginCredential {
  user_id: string;
  username: string;
  updated_at: string;
}

/** 1–32 characters: lower case letters, numbers, dot, dash or underscore. */
export const USERNAME_RE = /^[a-z0-9][a-z0-9_.-]{0,31}$/;

/**
 * The authentication provider enforces a hard minimum password length that no
 * WaveWallet setting can override. It is shown beside the field BEFORE the
 * person submits, never as a surprise error afterwards.
 */
export const MIN_LOGIN_PASSWORD_LENGTH = 6;
export const LOGIN_PASSWORD_HINT = `Password must contain at least ${MIN_LOGIN_PASSWORD_LENGTH} characters.`;
export const LOGIN_USERNAME_HINT =
  "Lower case letters, numbers, dot, dash or underscore. No spaces, no email address, no phone number.";

/** Lower-cased, trimmed and stripped of a leading `@` people often type. */
export function normalizeLoginUsername(value: string): string {
  return value.trim().replace(/^@+/, "").toLowerCase();
}

/** Why this username cannot be used, or null when it is fine. */
export function loginUsernameIssue(value: string): string | null {
  const name = normalizeLoginUsername(value);
  if (!name) return "Enter a username.";
  if (name.includes("@")) return "A username is not an email address.";
  if (/^[0-9+][0-9\s()-]{6,}$/.test(name)) return "A username is not a phone number.";
  if (!USERNAME_RE.test(name)) {
    return `Usernames are 1–32 characters. ${LOGIN_USERNAME_HINT}`;
  }
  return null;
}

/**
 * WaveWallet adds NO complexity requirement to this credential path — the only
 * rule is the unavoidable provider minimum, surfaced up front.
 */
export function loginPasswordIssue(password: string, confirm?: string): string | null {
  if (!password) return "Enter a password.";
  if (password.length < MIN_LOGIN_PASSWORD_LENGTH) return LOGIN_PASSWORD_HINT;
  if (confirm !== undefined && password !== confirm) return "The two passwords do not match.";
  return null;
}

