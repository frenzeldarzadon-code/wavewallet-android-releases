/**
 * One password policy for the whole platform.
 *
 * WaveWallet deliberately adds NO qualification requirements of its own: no
 * minimum length, no uppercase/lowercase/number/special-character rule. A
 * password only has to be non-empty, and a new password has to match its
 * confirmation.
 *
 * The single remaining constraint is the authentication provider's own hard
 * floor (6 characters), which no WaveWallet setting can override. It is shown
 * as a hint beside the field rather than as a checklist.
 *
 * Nothing here ever stores, transmits or logs a password — it only inspects
 * the string the person is typing, in their own browser.
 */

/** The authentication provider's unavoidable minimum. */
export const MIN_PASSWORD_LENGTH = 6;

export const PASSWORD_HINT = `Any password of at least ${MIN_PASSWORD_LENGTH} characters.`;

export function isStrongPassword(value: string): boolean {
  return passwordIssue(value) === null;
}

/** Why this password cannot be used, or null when it is fine. */
export function passwordIssue(value: string): string | null {
  if (!value) return "Enter a password.";
  if (value.length < MIN_PASSWORD_LENGTH)
    return `Password must contain at least ${MIN_PASSWORD_LENGTH} characters.`;
  return null;
}

/** Validates a new password plus its confirmation. Returns null when valid. */
export function newPasswordIssue(password: string, confirm: string): string | null {
  const issue = passwordIssue(password);
  if (issue) return issue;
  if (password !== confirm) return "The two passwords do not match.";
  return null;
}
