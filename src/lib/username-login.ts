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

export const USERNAME_RE = /^[a-z0-9][a-z0-9_.-]{2,31}$/;

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
    return "Usernames are 3–32 characters: letters, numbers, dot, dash or underscore.";
  }
  return null;
}

/**
 * The only password rule for this login method: it must not be empty.
 * Deliberately no complexity requirement.
 */
export function loginPasswordIssue(password: string, confirm?: string): string | null {
  if (!password) return "Enter a password.";
  if (confirm !== undefined && password !== confirm) return "The two passwords do not match.";
  return null;
}
